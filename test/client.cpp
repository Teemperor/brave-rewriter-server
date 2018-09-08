#include <cstdio>
#include <cstdlib>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>

#include <string>
#include <iostream>

std::string sendAndReceiveMsg(std::string msg) {
  const char *address = "/tmp/mysocket";
  sockaddr_un server_sock = {};

  int socket_fd = socket(PF_UNIX, SOCK_STREAM, 0);
  if (socket_fd < 0) {
    perror("client: socket");
    exit(1);
  }

  server_sock.sun_family = PF_UNIX;
  strcpy(server_sock.sun_path, address);

  socklen_t len = sizeof(server_sock.sun_family) + strlen(server_sock.sun_path);

  if (connect(socket_fd, reinterpret_cast<sockaddr*>(&server_sock), len) < 0)
    return msg;

  FILE *fp = fdopen(socket_fd, "r");

  while (true) {
    auto bytes_send = send(socket_fd, msg.data(), msg.size() + 1U, 0);
    if (bytes_send == -1) {
      std::cerr << "Failed to send message " << std::endl;
      break;
    }
    if (bytes_send == msg.size() + 1U)
      break;
    msg = msg.substr(bytes_send);
  }

  std::string result;
  int c;
  while ((c = fgetc(fp)) != EOF) {
    if (c == '\0')
      break;
    result.push_back((char)c);
  }

  close(socket_fd);
  return result;
}

int main(int argc, char **argv) {
  sleep(2);
  std::string msg = "fooo bar" + std::to_string(getpid());
  auto res = sendAndReceiveMsg(msg);
  msg = "(" + msg + ")";
  std::cerr << msg << "=" << res << std::endl;
  if (msg == res)
    return 0;
  std::cerr << "Got wrong result?" << std::endl;
  return 1;
}
