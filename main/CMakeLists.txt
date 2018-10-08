
configure_file(DataPath.h.in "${CMAKE_CURRENT_BINARY_DIR}/DataPath.h" @ONLY)

add_executable(jsflow-rewriter jsflow-rewriter.cpp DataPath.h.in)
target_include_directories(jsflow-rewriter PRIVATE "${CMAKE_CURRENT_BINARY_DIR}")
target_link_libraries(jsflow-rewriter serv_logic)