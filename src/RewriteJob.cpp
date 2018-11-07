#include "RewriteJob.h"

#include <iostream>

RewriteJob::RewriteJob(int ClientFD,
                       Rewrite rewrite)
    : ClientFileDescriptor(ClientFD), RewriteLogic(rewrite) {
  FilePointer = fdopen(ClientFD, "r");
}

RewriteJob::~RewriteJob() {
  close(ClientFileDescriptor);
}

void RewriteJob::run() {
  std::string Got;
  int c;
  while ((c = fgetc(FilePointer)) != EOF) {
    if (c == 0)
      break;
    Got.push_back((char)c);
  }

  sendMessage(RewriteLogic(Got));
}

void RewriteJob::sendMessage(std::string Message) {
  while (true) {
    auto BytesSend = send(ClientFileDescriptor, Message.c_str(), Message.size() + 1U, 0);
    if (BytesSend == -1) {
      std::cerr << "Failed to send message " << std::endl;
      return;
    }
    if (BytesSend == Message.size() + 1U)
      return;
    Message = Message.substr(BytesSend);
  }
}
