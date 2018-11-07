#ifndef SOCKETS_REWRITEJOB_H
#define SOCKETS_REWRITEJOB_H

#include <unistd.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>

#include <string>
#include <functional>

class RewriteJob {
  int ClientFileDescriptor = 0;
  FILE *FilePointer = nullptr;
public:
  typedef std::function<std::string(const std::string&)> Rewrite;
private:
  Rewrite RewriteLogic;
  void sendMessage(std::string Message);

public:
  RewriteJob() = default;
  explicit RewriteJob(int ClientFD, Rewrite rewrite);
  ~RewriteJob();
  void run();
};


#endif //SOCKETS_REWRITEJOB_H
