#include "RewriteServer.h"

#include <iostream>

#include <sstream>
#include <fstream>
#include <algorithm>
#include "DataPath.h"

class JSFlowRewriter : public RewriteServer {
  std::string jsflow_prefix = R"js(
jsflow = { console : {} };
)js";
  std::string jsflow_source;
  std::string jsflow_init = R"js(
jsflow.monitor = new jsflow.Monitor(window);
jsflow.monitor.log   = console.log;
jsflow.monitor.print = console.log;
jsflow.monitor.error = console.log;
jsflow.monitor.warn  = console.log;
)js";
public:
  JSFlowRewriter() : RewriteServer(getenv("JSFLOW_REWRITER")) {
    std::string jsflow_path = SourcePath + "/jsflow.js";
    std::ifstream t(jsflow_path);
    if (!t.good()) {
      std::cerr << "Couldn't load jsflow under " << jsflow_path << std::endl;
    }
    std::stringstream buffer;
    buffer << t.rdbuf();
    jsflow_source = buffer.str();
  }

  void replaceAll(std::string& str, const std::string& from, const std::string& to) {
    if(from.empty())
      return;
    size_t start_pos = 0;
    while((start_pos = str.find(from, start_pos)) != std::string::npos) {
      str.replace(start_pos, from.length(), to);
      start_pos += to.length(); // In case 'to' contains 'from', like replacing 'x' with 'yx'
    }
  }

  std::string escape(const std::string &in) {
    std::string result = in;
    replaceAll(result, "\"", "\\\"");
    replaceAll(result, "\n", "\\n");
    return result;
  }

  std::string rewrite(const std::string& original_msg) override {
    std::string uid;
    if (original_msg.find(' ') != std::string::npos) {
      uid = original_msg.substr(0, original_msg.find(' '));
    }
    std::string msg = original_msg.substr(uid.size() + 1);

    std::string cpy = msg;
    if (cpy.length() > 2240)
      cpy = cpy.substr(0, 2240);
    std::cout << "=========" << uid << "\n" << cpy << std::endl;
    if (msg.find("OUR SCRIPT") == std::string::npos)
      return msg;
    if (msg.find("DevToolsAPI.dispatchMessage") == 0)
      return msg;

    std::string result;

    result.append(jsflow_prefix);
    result.append(jsflow_source);
    result.append(jsflow_init);
    result.append("\njsflow.monitor.execute(\"");
    std::string escaped = escape(msg);
    result.append(escaped);
    result.append("\");");

    //jsflow_source.clear();
    //jsflow_init.clear();

    //std::cout << "=========" << result << std::endl;
    return result;
  }
};

int main(int argc, char **argv) {
  if (getenv("JSFLOW_REWRITER") == nullptr) {
    std::cerr << "JSFLOW_REWRITER variable not set!\n";
    std::cerr << "Run 'export JSFLOW_REWRITER=/an/absolute/path' in both this"
                 " terminal and the one running brave (with the same path"
                 " value for both)";
    return 1;
  }
  JSFlowRewriter server;
  for(;;) {
    server.step();
  }
}
