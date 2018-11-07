#include "RewriteServer.h"

#include "RewriteJob.h"

#include <thread>

RewriteServer::RewriteServer(const std::string &Addr) : Address(Addr) {
  if ((SocketFileDescriptor = socket(AF_UNIX, SOCK_STREAM, 0)) < 0) {
    perror("server: socket");
    std::exit(1);
  }
  /*
   * Create the address we will be binding to.
   */
  ServerSock.sun_family = AF_UNIX;
  strcpy(ServerSock.sun_path, Addr.c_str());

  unlink(Addr.c_str());
  // length of the whole structure, i.e. member + strlen.
  socklen_t len = sizeof(ServerSock.sun_family) + strlen(ServerSock.sun_path);

  if (bind(SocketFileDescriptor, reinterpret_cast<sockaddr*>(&ServerSock), len) < 0) {
    perror("server: bind");
    exit(1);
  }
  if (listen(SocketFileDescriptor, 5) < 0) {
    perror("server: listen");
    exit(1);
  }
}

RewriteServer::~RewriteServer() {
  close(SocketFileDescriptor);
}


void RewriteServer::step() {
  socklen_t FromLength;
  sockaddr_un ClientSocket= {};
  int ClientFileDescriptor = accept(SocketFileDescriptor, reinterpret_cast<sockaddr*>(&ClientSocket), &FromLength);
  if (ClientFileDescriptor < 0) {
    perror("server: accept");
    exit(1);
  }

  auto Reply = [ClientFileDescriptor, this](){
    RewriteJob job(ClientFileDescriptor, [this](const std::string &Message){
      return rewrite(Message);
    });
    job.run();
  };
  if (UseAsyncReplies) {
    // Spawn a new thread and instantly detach it.
    // TODO: This 
    auto T = new std::thread(Reply);
    T->detach();
  } else {
    Reply();
  }
}
