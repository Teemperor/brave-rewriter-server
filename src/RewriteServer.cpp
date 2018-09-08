#include "RewriteServer.h"

RewriteServer::RewriteServer(const std::string &addr) : addr(addr) {
  if ((socket_fd = socket(AF_UNIX, SOCK_STREAM, 0)) < 0) {
    perror("server: socket");
    std::exit(1);
  }
  /*
   * Create the address we will be binding to.
   */
  server_sock.sun_family = AF_UNIX;
  strcpy(server_sock.sun_path, addr.c_str());

  unlink(addr.c_str());
  // length of the whole structure, i.e. member + strlen.
  socklen_t len = sizeof(server_sock.sun_family) + strlen(server_sock.sun_path);

  if (bind(socket_fd, reinterpret_cast<sockaddr*>(&server_sock), len) < 0) {
    perror("server: bind");
    exit(1);
  }
  if (listen(socket_fd, 5) < 0) {
    perror("server: listen");
    exit(1);
  }
}

RewriteServer::~RewriteServer() {
  close(socket_fd);
}


void RewriteServer::step() {
  socklen_t fromlen;
  sockaddr_un client_sock= {};
  int client_fd = accept(socket_fd, reinterpret_cast<sockaddr*>(&client_sock), &fromlen);
  if (client_fd < 0) {
    perror("server: accept");
    exit(1);
  }

  auto t = new std::thread([client_fd](){
    RewriteJob job(client_fd);
    job.run();
  });
  t->detach();
}
