# League Monitor - C++ Implementation

C++ version of the League of Legends client monitoring system. The relay server remains in TypeScript (Node.js), while the controller and follower clients are implemented in C++.

## Architecture

```
┌─────────────┐          ┌─────────────┐          ┌─────────────┐
│   Mac/Win   │          │     VPS     │          │   Windows   │
│ (Controller)│◄────────►│Relay Server │◄────────►│  (Follower) │
│    (C++)    │ WebSocket│  (Node.js)  │ WebSocket│    (C++)    │
└─────────────┘          └─────────────┘          └─────────────┘
```

## Prerequisites

- CMake 3.15 or higher
- C++17 compatible compiler (GCC 7+, Clang 5+, MSVC 2017+)
- Windows: Visual Studio 2017+ or MinGW-w64
- macOS: Xcode Command Line Tools
- Linux: g++ or clang++

## Dependencies

The project uses CMake's FetchContent to automatically download:
- nlohmann/json (header-only)
- websocketpp (header-only)  
- yaml-cpp

Optional manual dependencies (if FetchContent fails):
- OpenSSL (for WebSocket)
- Boost (alternative to native async)

## Building

```bash
cd cpp
mkdir build
cd build
cmake ..
cmake --build . --config Release
```

### Windows (Visual Studio)
```cmd
cd cpp
mkdir build
cd build
cmake .. -G "Visual Studio 17 2022"
cmake --build . --config Release
```

### macOS/Linux
```bash
cd cpp
mkdir build
cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(nproc)
```

## Usage

### Controller
```bash
./bin/controller
```

### Follower
```bash
./bin/follower [session-token]
```

If no token is provided, the follower will attempt to auto-join by IP address.

## Configuration

Place `config.json` in the same directory as the executables:

```json
{
  "relay": {
    "port": 8080,
    "host": "0.0.0.0"
  },
  "controller": {
    "relayServerHost": "localhost",
    "relayServerPort": 8080,
    "monitorInterval": 5000,
    "killGameProcess": true
  },
  "follower": {
    "relayServerHost": "localhost",
    "relayServerPort": 8080,
    "restartDelay": 30000
  }
}
```

## Project Structure

```
cpp/
├── CMakeLists.txt          # Main CMake build file
├── include/                # Header files
│   └── shared/
│       ├── types.h
│       ├── logger.h
│       ├── config.h
│       ├── process_utils.h
│       └── league_utils.h
├── src/                    # Source files
│   ├── shared/
│   │   ├── logger.cpp
│   │   ├── config.cpp
│   │   ├── process_utils.cpp
│   │   └── league_utils.cpp
│   ├── controller/
│   │   ├── main.cpp
│   │   ├── client_monitor.cpp
│   │   └── session_client.cpp
│   └── client/
│       └── main.cpp
└── README.md
```

## Features

- Cross-platform process management (Windows/macOS/Linux)
- WebSocket client for relay server communication
- JSON configuration parsing
- YAML file parsing for League installation detection
- Automatic process monitoring and restart
- VGC service monitoring (Windows only)
- Game process detection and termination

## Notes

- The relay server remains in TypeScript (see parent directory)
- Controller and Follower are fully implemented in C++
- All TypeScript logic has been ported to C++ equivalent

## License

MIT

