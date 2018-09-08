#include "RewriteServer.h"

int main(int argc, char **argv) {
  RewriteServer server("mysocket");
  server.run();
}
