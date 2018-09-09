
add_executable(serv server.cpp)
target_link_libraries(serv serv_logic)

add_executable(client client.cpp)

configure_file(test.sh "${CMAKE_CURRENT_BINARY_DIR}/test.sh" COPYONLY)
add_test(client-server bash -x test.sh
    WORKING_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}")