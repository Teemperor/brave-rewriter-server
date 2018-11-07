#include "RewriteServer.h"

#include <iostream>

#include <sstream>
#include <fstream>
#include <algorithm>
#include <unordered_map>
#include <JavaScriptEscaper.h>
#include "DataPath.h"

class JSFlowRewriter : public RewriteServer {

  /// Source code we inject before we include the JSFlow source code.
  std::string JSFlowPrefix =
R"js(
jsflow = { console : {} };
)js";

  std::string JSFlowSource;

  /// Initializes JSFlow.
  std::string JSFlowInitializers =
R"js(
jsflow.monitor = new jsflow.Monitor(window);
jsflow.monitor.log   = console.log;
jsflow.monitor.print = console.log;
jsflow.monitor.error = console.log;
jsflow.monitor.warn  = console.log;
)js";

  /// This is the string that should be injected by Chrome in a fresh V8 instance
  /// when it's used for actual website rendering. If we find this string,
  /// consider the corresponding V8 instance valid for our rewriting purposes.
  std::string ValidV8Needle = "!function(e){var t={};function r(n){if(t[n])"
                              "return t[n].exports;var o=t[n]={i:n,l:!1,export";

  /// Represents a V8 instance in Chrome that is communicating with us.
  struct V8Instance {
    /// Whether the V8 instance is used for a website, and not just some
    /// internal V8 instance used for the dev tools, etc..
    bool Valid;
  };

  /// Maps UIDs to known V8 instances.
  std::unordered_map<std::string, V8Instance> V8InstancesByUID;

  void loadJSFlowSourceCode() {
    std::string jsflow_path = SourcePath + "/jsflow.js";
    std::ifstream t(jsflow_path);
    if (!t.good()) {
      std::cerr << "Couldn't load jsflow under " << jsflow_path << std::endl;
      exit(1);
    }
    std::stringstream buffer;
    buffer << t.rdbuf();
    JSFlowSource = buffer.str();
  }

public:
  JSFlowRewriter() : RewriteServer(getenv("JSFLOW_REWRITER")) {
    loadJSFlowSourceCode();
  }


  std::string escape(const std::string &Inpupt) {
    return JavaScriptEscaper::escape(Inpupt);
  }

  // This is the callback we get from the RewriteServer where can rewrite the
  // message we received.
  std::string rewrite(const std::string& OriginalMsg) override {
    // First extract the v8 UID from the message. The UID is a unique string
    // that we prepend to every message and which identifiers the V8 instance
    // that sent the message.
    std::string uid;
    if (OriginalMsg.find(' ') != std::string::npos) {
      uid = OriginalMsg.substr(0, OriginalMsg.find(' '));
    } else {
      // If we don't have the message in the form
      //      'UID SUFFIX'
      // e.g. '134524 some source code'
      // than our code for sending the JS source code here didn't include an
      // UID string for us.
      std::cerr << "Malformed message?\n" << OriginalMsg << std::endl;
      return OriginalMsg;
    }

    // Get rid of the UID string that we injected at the start of the message.
    // There is a space behind the UID, so that's why we start at size + 1.
    std::string Msg = OriginalMsg.substr(uid.size() + 1);

    // Check if the V8 instance we got is actually used for a website and not
    // for some internal Brave website.
    bool IsNewV8Instance = (V8InstancesByUID.count(uid) == 0);
    if (IsNewV8Instance) {
      V8InstancesByUID[uid] = {(Msg.rfind(ValidV8Needle, 0) == 0)};
    }

    // If the V8 instance isn't valid, then we don't need to rewrite.
    if (!V8InstancesByUID[uid].Valid)
      return Msg;

    // Print the first 200 characters to stdout. This is just for debugging
    // purposes.
    std::string Copy = Msg;
    if (Copy.length() > 200)
      Copy = Copy.substr(0, 200);
    std::cout << "=========" << uid << "\n" << Copy << std::endl;


    std::string Result;

    // If this is a V8 instance we haven't encountered before, we have to inject
    // the JSFlow source code and initializers.
    if (IsNewV8Instance) {
      Result.append(JSFlowPrefix);
      Result.append(JSFlowSource);
      Result.append(JSFlowInitializers);
    }

    // Now we escape the original source code and let our JSFlow instance
    // execute it.
    Result.append("\njsflow.monitor.execute(\"");
    std::string escaped = escape(Msg);
    Result.append(escaped);
    Result.append("\");");

    return Result;
  }
};

int main(int argc, char **argv) {
  if (getenv("JSFLOW_REWRITER") == nullptr) {
    std::cerr << "JSFLOW_REWRITER variable not set!\n";
    std::cerr << "Run 'export JSFLOW_REWRITER=/an/absolute/path' in both this"
                 " terminal and the one running brave (with the same path"
                 " for both brave and the rewriter).\n";
    return 1;
  }
  // Initialize and run our rewriter service.
  JSFlowRewriter Server;
  for(;;) {
    Server.step();
  }
}
