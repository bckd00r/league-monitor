# Building the C++ League Monitor

## Prerequisites

### Windows
- Visual Studio 2017 or later (with C++ tools)
- CMake 3.15 or later
- Git (for FetchContent)

### macOS
- Xcode Command Line Tools
- CMake 3.15 or later
- Git

### Linux
- GCC 7+ or Clang 5+
- CMake 3.15 or later
- Git
- OpenSSL development libraries

## Build Steps

### 1. Navigate to cpp directory
```bash
cd cpp
```

### 2. Create build directory
```bash
mkdir build
cd build
```

### 3. Configure CMake

**Windows (Visual Studio 2026):**
```cmd
cmake .. -G "Visual Studio 18 2026" -A x64
```

For other Visual Studio versions, use the appropriate generator:
- Visual Studio 2022: `-G "Visual Studio 17 2022" -A x64`
- Visual Studio 2019: `-G "Visual Studio 16 2019" -A x64`
- Or omit `-G` flag to auto-detect

**Windows (MinGW):**
```cmd
cmake .. -G "MinGW Makefiles"
```

**macOS/Linux:**
```bash
cmake .. -DCMAKE_BUILD_TYPE=Release
```

### 4. Build

**Windows (Visual Studio):**
```cmd
cmake --build . --config Release
```

**macOS/Linux:**
```bash
make -j$(nproc)
```

## Output

Binaries will be in `build/bin/`:
- `controller.exe` (Windows) or `controller` (macOS/Linux)
- `follower.exe` (Windows) or `follower` (macOS/Linux)

## Dependencies

The project uses CMake's FetchContent to automatically download:
- nlohmann/json (header-only, JSON parsing)
- websocketpp (header-only, WebSocket client)
- yaml-cpp (YAML parsing for League installation detection)

These will be downloaded during the CMake configuration step.

## Troubleshooting

### CMake can't find dependencies
- Ensure you have an internet connection (dependencies are downloaded)
- Check if Git is installed and accessible

### Build errors on Windows
- Ensure you have the Windows SDK installed
- Make sure you're building in Release mode

### Build errors on Linux
- Install OpenSSL: `sudo apt-get install libssl-dev` (Ubuntu/Debian)
- Install pthread: Usually already installed, but verify

### WebSocket connection issues
- Ensure the relay server (TypeScript) is running
- Check firewall settings
- Verify the relay server host and port in config.json

