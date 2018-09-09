#include "RewriteServer.h"

#include <iostream>

class JSFlowRewriter : public RewriteServer {
public:
  JSFlowRewriter() : RewriteServer(getenv("JSFLOW_REWRITER")) {
  }

  std::string rewrite(const std::string& msg) override {
    std::cout << msg << std::endl;
    return "alert(\"Hello world!\");\n" + msg;
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
