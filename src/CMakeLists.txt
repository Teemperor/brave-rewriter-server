
find_package(Threads)

add_library(serv_logic RewriteJob.cpp RewriteJob.h RewriteServer.cpp RewriteServer.h)
target_link_libraries(serv_logic ${CMAKE_THREAD_LIBS_INIT})
