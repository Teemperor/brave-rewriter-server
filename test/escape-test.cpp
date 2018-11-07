
#include <cassert>
#include "../src/JavaScriptEscaper.h"

int main(int argc, char **argv) {
  assert(JavaScriptEscaper::escape("") == "");
  assert(JavaScriptEscaper::escape("foo") == "foo");

  assert(JavaScriptEscaper::escape("\"foo\"") == "\\\"foo\\\"");
  assert(JavaScriptEscaper::escape("\"\"foo\"") == "\\\"\\\"foo\\\"");

  assert(JavaScriptEscaper::escape("a\n") == "a\\n");
  assert(JavaScriptEscaper::escape("\na") == "\\na");
  assert(JavaScriptEscaper::escape("\n") == "\\n");
  assert(JavaScriptEscaper::escape("\n\n") == "\\n\\n");
}
