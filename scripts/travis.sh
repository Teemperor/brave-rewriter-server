

if [ $TRAVIS_OS_NAME = "linux" ]; then
  curl -s https://raw.githubusercontent.com/mikkeloscar/arch-travis/master/arch-travis.sh | bash
else
  ./scripts/run_tests.sh clang clang++
fi