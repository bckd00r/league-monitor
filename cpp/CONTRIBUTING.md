# Contributing to League Monitor C++

## Building the Project

### Prerequisites
- CMake 3.15 or higher
- C++17 compatible compiler
- Git (for FetchContent dependencies)

### Windows
```cmd
cd cpp
build.bat
```

Or manually:
```cmd
mkdir build
cd build
cmake .. -G "Visual Studio 17 2022" -A x64
cmake --build . --config Release
```

### macOS/Linux
```bash
cd cpp
chmod +x build.sh
./build.sh
```

Or manually:
```bash
mkdir build
cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(nproc)
```

## Project Structure

```
cpp/
├── include/           # Header files
│   ├── shared/
│   └── controller/
├── src/              # Source files
│   ├── shared/
│   ├── controller/
│   └── client/
├── CMakeLists.txt    # Main build file
├── build.bat         # Windows build script
├── build.sh          # Unix build script
└── README.md         # Documentation
```

## Code Style

- Use C++17 features
- Follow RAII principles
- Use smart pointers (unique_ptr, shared_ptr)
- Prefer const correctness
- Use namespaces (league_monitor)
- Platform-specific code should use #ifdef guards

## Testing

Currently manual testing. Automated tests to be added.

## Dependencies

All dependencies are automatically downloaded via CMake FetchContent:
- nlohmann/json (header-only)
- websocketpp (header-only)
- yaml-cpp

