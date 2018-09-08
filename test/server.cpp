#include "RewriteServer.h"

int main(int argc, char **argv) {
  RewriteServer server("/tmp/mysocket");
  server.run();
}
