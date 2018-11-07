#ifndef SOCKETS_REWRITESERVER_H
#define SOCKETS_REWRITESERVER_H

#include <unistd.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>

#include <string>

class RewriteServer {
  std::string Address;
  sockaddr_un ServerSock = {};
  int SocketFileDescriptor;
  bool UseAsyncReplies = false;
public:
  explicit RewriteServer(const std::string &Addr);
  ~RewriteServer();
  void step();
  virtual std::string rewrite(const std::string& Message) = 0;
};


#endif //SOCKETS_REWRITESERVER_H
