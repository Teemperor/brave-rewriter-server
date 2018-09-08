#include <cstdio>
#include <cstdlib>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>

#define NSTRS 3            /* no. of strings  */

/*
 * Strings we send to the server.
 */
const char *strs[NSTRS] = {"This is the first string from the client.\n",
                     "This is the second string from the client.\n",
                     "This is the third string from the client.\n"};

int main(int argc, char **argv) {
  const char *address = "/tmp/mysocket";
  sockaddr_un saun;

  /*
   * Get a socket to work with.  This socket will
   * be in the UNIX domain, and will be a
   * stream socket.
   */
  int s;
  if ((s = socket(PF_UNIX, SOCK_STREAM, 0)) < 0) {
    perror("client: socket");
    exit(1);
  }

  /*
   * Create the address we will be connecting to.
   */
  saun.sun_family = PF_UNIX;
  strcpy(saun.sun_path, address);

  /*
   * Try to connect to the address.  For this to
   * succeed, the server must already have bound
   * this address, and must have issued a listen()
   * request.
   *
   * The third argument indicates the "length" of
   * the structure, not just the length of the
   * socket name.
   */
  int len = sizeof(saun.sun_family) + strlen(saun.sun_path);

  if (connect(s, reinterpret_cast<sockaddr*>(&saun), len) < 0) {
    perror("client: connect");
    exit(1);
  }

  /*
   * We'll use stdio for reading
   * the socket.
   */
  FILE *fp = fdopen(s, "r");

  /*
   * First we read some strings from the server
   * and print them out.
   */
  for (int i = 0; i < NSTRS; i++) {
    int c;
    while ((c = fgetc(fp)) != EOF) {
      putchar(c);

      if (c == '\n')
        break;
    }
  }

  /*
   * Now we send some strings to the server.
   */
  for (int i = 0; i < NSTRS; i++)
    send(s, strs[i], strlen(strs[i]), 0);

  /*
   * We can simply use close() to terminate the
   * connection, since we're done with both sides.
   */
  close(s);
}
