#ifndef SOCKETS_REWRITEJOB_H
#define SOCKETS_REWRITEJOB_H

#include <cstdio>
#include <cstdlib>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>

#include <string>
#include <vector>
#include <cassert>
#include <thread>
#include <functional>

class RewriteJob {
  int client_fd = 0;
  FILE *fp = nullptr;
public:
  typedef std::function<std::string(const std::string&)> Rewrite;
private:
  Rewrite rewrite_logic;
  void sendMessage(std::string msg);

public:
  RewriteJob() = default;
  explicit RewriteJob(int client_fd, Rewrite rewrite_logic);
  ~RewriteJob();
  void run();
};


#endif //SOCKETS_REWRITEJOB_H
