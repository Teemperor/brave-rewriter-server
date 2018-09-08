#include <iostream>
#include "RewriteServer.h"

int main(int argc, char **argv) {
  RewriteServer server("/tmp/mysocket");
  for (int i = 0; i < 3; ++i)
    server.step();
  sleep(1);
  std::cerr << "Server exiting" << std::endl;
}
