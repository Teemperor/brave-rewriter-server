#include "JavaScriptEscaper.h"

std::string JavaScriptEscaper::escape(const std::string &Input) {
  std::string Result;
  Result.reserve(Input.size() + 64u);
  const std::string SimpleEscapeCharacters = "\"'\\";
  for (char c : Input) {
    // 'simple' escaped characters are only prepended with a backslash.
    if (SimpleEscapeCharacters.find(c) != SimpleEscapeCharacters.npos) {
      Result.push_back('\\');
      Result.push_back(c);
    } else if (c == '\n') {
      // Newline is translated into a backslash and a 'n' character (\n).
      Result.push_back('\\');
      Result.push_back('n');
    } else if (c == '\r') {
      // Carriage return is translated into a backslash and a 'r' character (\r).
      Result.push_back('\\');
      Result.push_back('r');
    } else {
      // All other characters stay untouched.
      Result.push_back(c);
    }
  }
  return Result;
}
