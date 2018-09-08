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

class RewriteJob {
  int client_fd = 0;
  FILE *fp = nullptr;
  void sendMessage(const std::string &msg);

public:
  RewriteJob() = default;
  explicit RewriteJob(int client_fd);
  ~RewriteJob();
  void run();
};


#endif //SOCKETS_REWRITEJOB_H
