#ifndef SOCKETS_REWRITESERVER_H
#define SOCKETS_REWRITESERVER_H

#include <unistd.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>

#include <string>

class RewriteServer {
  std::string addr;
  sockaddr_un server_sock = {};
  int socket_fd;
public:
  explicit RewriteServer(const std::string &addr);
  ~RewriteServer();
  void step();
  virtual std::string rewrite(const std::string& msg) = 0;
};


#endif //SOCKETS_REWRITESERVER_H
