#!/bin/bash

echo "Building League Monitor C++ Project..."
echo

mkdir -p build
cd build

cmake .. -DCMAKE_BUILD_TYPE=Release
if [ $? -ne 0 ]; then
    echo "CMake configuration failed!"
    exit 1
fi

make -j$(nproc)
if [ $? -ne 0 ]; then
    echo "Build failed!"
    exit 1
fi

echo
echo "Build successful! Binaries are in build/bin/"
cd ..

