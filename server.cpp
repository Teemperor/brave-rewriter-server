#include <cstdio>
#include <cstdlib>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>

#define NSTRS 3            /* no. of strings  */

/*
 * Strings we send to the client.
 */
const char *strs[NSTRS] = {"This is the first string from the server.\n",
                     "This is the second string from the server.\n",
                     "This is the third string from the server.\n"};

int main() {
  const char *address = "mysocket";
  sockaddr_un server_sock, client_sock;

  /*
   * Get a socket to work with.  This socket will
   * be in the UNIX domain, and will be a
   * stream socket.
   */
  int socket_fd;
  if ((socket_fd = socket(AF_UNIX, SOCK_STREAM, 0)) < 0) {
    perror("server: socket");
    std::exit(1);
  }

  /*
   * Create the address we will be binding to.
   */
  server_sock.sun_family = AF_UNIX;
  strcpy(server_sock.sun_path, address);

  /*
   * Try to bind the address to the socket.  We
   * unlink the name first so that the bind won't
   * fail.
   *
   * The third argument indicates the "length" of
   * the structure, not just the length of the
   * socket name.
   */
  unlink(address);
  socklen_t len = sizeof(server_sock.sun_family) + strlen(server_sock.sun_path);

  if (bind(socket_fd, reinterpret_cast<sockaddr*>(&server_sock), len) < 0) {
    perror("server: bind");
    exit(1);
  }

  /*
   * Listen on the socket.
   */
  if (listen(socket_fd, 5) < 0) {
    perror("server: listen");
    exit(1);
  }

  /*
   * Accept connections.  When we accept one, ns
   * will be connected to the client.  fsaun will
   * contain the address of the client.
   */
  socklen_t fromlen;
  int client_fd;
  if ((client_fd = accept(socket_fd, reinterpret_cast<sockaddr*>(&client_sock), &fromlen)) < 0) {
    perror("server: accept");
    exit(1);
  }

  /*
   * We'll use stdio for reading the socket.
   */
  FILE *fp = fdopen(client_fd, "r");

  /*
   * First we send some strings to the client.
   */
  for (int i = 0; i < NSTRS; i++)
    send(client_fd, strs[i], strlen(strs[i]), 0);

  /*
   * Then we read some strings from the client and
   * print them out.
   */
  for (int i = 0; i < NSTRS; i++) {
    char c;
    while ((c = fgetc(fp)) != EOF) {
      putchar(c);

      if (c == '\n')
        break;
    }
  }

  /*
   * We can simply use close() to terminate the
   * connection, since we're done with both sides.
   */
  close(socket_fd);
}
