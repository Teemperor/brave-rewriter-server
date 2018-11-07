
find_package(Threads)

add_library(serv_logic RewriteJob.cpp RewriteJob.h RewriteServer.cpp
    RewriteServer.h JavaScriptEscaper.cpp JavaScriptEscaper.h)
target_link_libraries(serv_logic ${CMAKE_THREAD_LIBS_INIT})
target_include_directories(serv_logic PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")