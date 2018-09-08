#!/bin/bash

set -e
./serv &

./client
./client
./client
