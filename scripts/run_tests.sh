#!/bin/bash

set -e

export CC="$1"
export CXX="$2"

mkdir -p build
cd build

cmake ..
make -j2
ctest -VV -j1