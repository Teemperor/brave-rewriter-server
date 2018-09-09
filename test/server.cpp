#include <iostream>
#include "RewriteServer.h"

class ParanthesisRewriter : public RewriteServer {
public:
  ParanthesisRewriter() : RewriteServer(getenv("JSFLOW_REWRITER")) {

  }

  std::string rewrite(const std::string& msg) override {
    return "(" + msg + ")";
  }
};

int main(int argc, char **argv) {
  if (getenv("JSFLOW_REWRITER") == nullptr) {
    std::cerr << "JSFLOW_REWRITER variable not set!\n";
    abort();
  }
  ParanthesisRewriter server;
  for (int i = 0; i < 3; ++i)
    server.step();
  sleep(1);
  std::cerr << "Server exiting" << std::endl;
}
