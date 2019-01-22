#include "RewriteServer.h"

#include <iostream>

#include <sstream>
#include <fstream>
#include <algorithm>
#include <unordered_map>
#include <JavaScriptEscaper.h>
#include <vector>

#include "DataPath.h"


class TextBox {
  std::ostream& getStream() { return std::cerr; }

public:
  TextBox() {
    printColor(Magenta, "┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n");
    printColor(Magenta, "┃          New Message          ┃\n");
    printColor(Magenta, "\n");
  }
  ~TextBox() {
    printColor(Magenta, "\n");
    printColor(Magenta, "┃        End Of Message         ┃\n");
    printColor(Magenta, "┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n");
  }

  std::string shorten(const std::string &S, unsigned Limit) const {
    if (S.size() <= Limit) {
      return S;
    }
    Limit /= 2;
    return S.substr(0, Limit) + "[...]" + S.substr(S.size() - Limit, Limit);
  }

  template<typename T>
  TextBox &operator<<(const T &t) {
    getStream() << t;
    return *this;
  }

  const char *Red = "\x1b[31m";
  const char *Green = "\x1b[32m";
  const char *Yellow = "\x1b[33m";
  const char *Blue = "\x1b[34m";
  const char *Magenta = "\x1b[35m";
  const char *Cyan = "\x1b[36m";
  const char *Reset = "\x1b[0m";

  void printColor(const char *Color, const std::string &S) {
    if (getenv("JSFLOW_NO_COLOR"))
      *this << S;
    else
      *this << Color << S << Reset;
  }
};

class JSFlowRewriter : public RewriteServer {

  /// Source code we inject before we include the JSFlow source code.
  std::string JSFlowPrefix =
R"js(
)js";

  std::string JSFlowSource;

  /// Initializes JSFlow.
  std::string JSFlowInitializers =
R"js(
jsflow.monitor = window.jsflow;
jsflow.monitor.log   = console.log;
jsflow.monitor.print = console.log;
jsflow.monitor.error = console.log;
jsflow.monitor.warn  = console.log;
)js";

  /// We have to filter certain V8 contexts from being rewritten. This defines
  /// a list of code prefixes for the specific Code that Chrome will inject
  /// as the first source code into these contexts. If we find a new V8 context
  /// and the first code in this V8 context starts with one of these prefixes,
  /// we should not rewrite it.
  std::vector<std::string> IgnoreNeedles = {
      "(function() { // Copyright (c) 2012 The Chromium Authors. All rights reserved.",

      "// Copyright (c) 2013 The Chromium Authors. All rights reserved.",

      "!function(e){var t={};function n(r){if(t[r])return t[r].exports;var o=t[r]={i:r,l:!1,export",

      "/******/ (function(modules) { // webpackBootstrap",

      "!function(e){var t={};function r(n){if(t[n])return t[n].exports;var o=t[n]",

      "// Copyright (c) 2013 The Chromium Authors. All rights reserved.",

      "// Copyright 2014 The Chromium Authors. All rights reserved.",

      "!function(e){var t={};function o(n){if(t[n])return t[n]",

      "const lightGridColor = \"rgba(0,0,0,0.2)\";\n"
      "const darkGridColor = \"rgba(0,0,0,0.7)\";\n"
      "const transparentColor = \"rgba(0, 0, 0, 0)\";\n"
      "const gridBackgroundColor = \"rgba(255, 255, 255, 0.8)\";\n"
      "\n"
      "function drawPausedInDebuggerMessage(message)\n"
      "{\n",

      "/*\nCopyright 2014 Mozilla Foundation\n\nLicensed under the Apache Lice"
      "nse, Version 2.0 (the \"License\");\nyou may not use this file except in"
      " compliance with the License.\nYou may obtain a copy of the License at\n"
      "\n    http://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by a"
      "pplicable law or agreed to in writing, software\ndistributed under the L"
      "icense is distributed on an \"AS IS\" BASIS,\nWITHOUT WARRANTIES OR COND"
      "ITIONS OF ANY KIND, either express or implied.\nSee the License for the "
      "specific language governing permissions and\nlimitations under the Licen"
      "se.\n*/\n\n\'use strict\';\n\nvar VIEWER_URL = chrome.extension.getURL("
      "\'content/web/viewer.html\');\n\nfunction getViewerURL(pdf_url) {\n  ret"
      "urn VIEWER_URL + \'?file=\' + encodeURIComponent(pdf_url);\n}\n\nif (CSS"
      ".supports(\'animation\', \'0s\')) {\n  document.addEventListener(\'anima"
      "tionstart\',",

      "(function(require, requireNative, loadScript, exports, console, privates"
      ", apiBridge, bindingUtil, getInternalApi, $Array, $Function, $JSON",
  };

  /// Represents a V8 instance in Chrome that is communicating with us.
  struct V8Context {
    /// Whether the V8 instance is used for a website, and not just some
    /// internal V8 instance used for the dev tools, etc..
    bool ShouldRewrite = false;
    bool InitializedJSFlow = false;
    std::string Name;
  };

  /// Maps UIDs to known V8 instances.
  std::unordered_map<std::string, V8Context> V8InstancesByUID;

  void loadJSFlowSourceCode() {
    std::string jsflow_path = SourcePath + "/jsflow.js";
    std::ifstream t(jsflow_path);
    if (!t.good()) {
      std::cerr << "Couldn't load jsflow under " << jsflow_path << "\n";
      exit(1);
    }
    std::stringstream buffer;
    buffer << t.rdbuf();
    JSFlowSource = buffer.str();
  }

  /// Utility function to check if S has the given prefix.
  bool strStartsWith(const std::string &S, const std::string &Prefix) {
    return S.rfind(Prefix, 0) == 0;
  }

public:
  JSFlowRewriter() : RewriteServer(getenv("JSFLOW_REWRITER")) {
    loadJSFlowSourceCode();
  }

  std::string escape(const std::string &Inpupt) {
    return JavaScriptEscaper::escape(Inpupt);
  }

  /// Returns true if this is a valid V8 context by looking at the first code
  /// that was passed into the context. Valid means that we should inject
  /// JSFlow into it and rewrite code.
  bool isValidV8Context(const std::string &FirstMessageInContext) {
    for (const auto &N : IgnoreNeedles)
      if (strStartsWith(FirstMessageInContext, N))
        return false;
    return true;
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
      std::cerr << "Malformed message?\n" << OriginalMsg << "\n";
      return OriginalMsg;
    }

    // Get rid of the UID string that we injected at the start of the message.
    // There is a space behind the UID, so that's why we start at size + 1.
    std::string Msg = OriginalMsg.substr(uid.size() + 1);

    if (strStartsWith(Msg, "1") || strStartsWith(Msg, "document.URL") || strStartsWith(Msg, "lnum.value >= rnum.value")) {
      return Msg;
    }

    TextBox info;

    // Check if the V8 instance we got is actually used for a website and not
    // for some internal Brave website.
    if (V8InstancesByUID.count(uid) == 0) {
      info.printColor(info.Green, "Found new V8 context: ");
      V8Context NewInstance;
      NewInstance.ShouldRewrite = isValidV8Context(Msg);
      if (NewInstance.ShouldRewrite)
        info.printColor(info.Green, "VALID CONTEXT\n");
      else
        info.printColor(info.Red, "INVALID CONTEXT\n");
      NewInstance.Name = "Ctxt" + std::to_string(V8InstancesByUID.size());
      V8InstancesByUID[uid] = NewInstance;
    }

    V8Context &CurrentInstance = V8InstancesByUID[uid];
    info.printColor(info.Yellow, "Current V8 context: " + CurrentInstance.Name + "\n");

    info.printColor(info.Blue, "Code before rewriting: ");
    info << info.shorten(Msg, 200) << "\n";
    info.printColor(info.Blue, "######### END OF CODE ###########\n\n");

    // If the V8 instance isn't valid, then we don't need to rewrite.
    if (!CurrentInstance.ShouldRewrite) {
      info.printColor(info.Yellow, "Skipping because marked invalid\n");
      return Msg;
    }


    std::string Result;

    // If this is a V8 instance we haven't encountered before, we have to inject
    // the JSFlow source code and initializers.
    if (!CurrentInstance.InitializedJSFlow) {
      info.printColor(info.Green, "Injecting JSFlow\n");
      CurrentInstance.InitializedJSFlow = true;
      Result.append(JSFlowPrefix);
      Result.append(JSFlowSource);
      Result.append(JSFlowInitializers);
    }

    // Now we escape the original source code and let our JSFlow instance
    // execute it.
    if (getenv("JSFLOW_RETURN_VALUE"))
      Result.append("console.log(");

    Result.append("jsflow.monitor.execute(\"");
    std::string escaped = escape(Msg);
    Result.append(escaped);
    Result.append("\")");

    if (getenv("JSFLOW_RETURN_VALUE"))
      Result.append(");");

    info.printColor(info.Blue, "Code rewritten to: \n");
    info << info.shorten(Result, 100) << "\n";
    info.printColor(info.Blue, "######### END OF CODE ###########\n\n");

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
