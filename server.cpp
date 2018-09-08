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
  void sendMessage(const std::string &msg) {
    auto bytes_send = send(client_fd, msg.c_str(), msg.size(), 0);
    assert(bytes_send == msg.size());
  }

public:
  RewriteJob() = default;
  explicit RewriteJob(int client_fd) : client_fd(client_fd) {
  }
  ~RewriteJob() {
    close(client_fd);
  }
  void run() {
    FILE *fp = fdopen(client_fd, "r");

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
};

class RewriteServer {
  std::string addr;
  sockaddr_un server_sock;
  int socket_fd;
public:
  explicit RewriteServer(const std::string &addr) : addr(addr) {
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
  }
  ~RewriteServer() {
    close(socket_fd);
  }

  void run() {
    /*
     * Listen on the socket.
     */
    if (listen(socket_fd, 5) < 0) {
      perror("server: listen");
      exit(1);
    }

    while (true) {
      socklen_t fromlen;
      sockaddr_un client_sock;
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
  }
};

int main(int argc, char **argv) {
  RewriteServer server("mysocket");
  server.run();
}
