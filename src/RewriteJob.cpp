#include "RewriteJob.h"

RewriteJob::RewriteJob(int client_fd) : client_fd(client_fd) {
  fp = fdopen(client_fd, "r");
}

RewriteJob::~RewriteJob() {
  close(client_fd);
}

void RewriteJob::run() {
  std::vector<std::string> messages = {
      "This is the first string from the server.\n",
      "This is the second string from the server.\n",
      "This is the third string from the server.\n"
  };
  for (auto &msg : messages)
    sendMessage(msg);

  for (int i = 0; i < 3; i++) {
    int c;
    while ((c = fgetc(fp)) != EOF) {
      putchar(c);

      if (c == '\n')
        break;
    }
  }
}

void RewriteJob::sendMessage(const std::string &msg) {
  auto bytes_send = send(client_fd, msg.c_str(), msg.size(), 0);
  assert(bytes_send == msg.size());
}
