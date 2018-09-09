cmake_minimum_required(VERSION 3.0)
project(sockets)

enable_testing()
set (CMAKE_CXX_STANDARD 11)

add_subdirectory(src/)
add_subdirectory(test/)
add_subdirectory(main/)