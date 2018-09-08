cmake_minimum_required(VERSION 3.0)
project(sockets)

find_package(Threads)

add_executable(serv server.cpp)
target_link_libraries(serv ${CMAKE_THREAD_LIBS_INIT})

add_executable(client client.cpp)
