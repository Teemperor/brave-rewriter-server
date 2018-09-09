#include <iostream>
#include "RewriteJob.h"

RewriteJob::RewriteJob(int client_fd,
                       Rewrite rewrite_logic)
    : client_fd(client_fd), rewrite_logic(rewrite_logic) {
  fp = fdopen(client_fd, "r");
}

RewriteJob::~RewriteJob() {
  close(client_fd);
}

void RewriteJob::run() {
  std::string got;
  int c;
  while ((c = fgetc(fp)) != EOF) {
    if (c == 0)
      break;
    got.push_back((char)c);
  }
  std::cout << got << std::endl;

  sendMessage(rewrite_logic(got));
}

void RewriteJob::sendMessage(std::string msg) {
  while (true) {
    auto bytes_send = send(client_fd, msg.c_str(), msg.size() + 1U, 0);
    if (bytes_send == -1) {
      std::cerr << "Failed to send message " << std::endl;
      return;
    }
    if (bytes_send == msg.size() + 1U)
      return;
    msg = msg.substr(bytes_send);
  }
}
