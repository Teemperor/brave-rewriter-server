#!/bin/bash

export JSFLOW_REWRITER=/tmp/mysocket
set -e
./serv &

./client
./client
./client
