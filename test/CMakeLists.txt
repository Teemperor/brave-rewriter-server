
add_executable(serv server.cpp)
target_link_libraries(serv serv_logic)
target_include_directories(serv PUBLIC ../src/)

add_executable(client client.cpp)
