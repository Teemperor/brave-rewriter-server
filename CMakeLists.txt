cmake_minimum_required(VERSION 3.0)
project(sockets)

add_subdirectory(src/)

find_package(Threads)

add_executable(serv server.cpp)
target_include_directories(serv PUBLIC src/)
target_link_libraries(serv serv_logic)

add_executable(client client.cpp)
