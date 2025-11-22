# Quick Start Guide

## Prerequisites

- CMake 3.15+
- C++17 compiler
- Git (for dependencies)

## Build

### Windows
```cmd
cd cpp
build.bat
```

### macOS/Linux
```bash
cd cpp
chmod +x build.sh
./build.sh
```

## Run

### 1. Start Relay Server (TypeScript - in parent directory)
```bash
cd ..
npm run relay
```

### 2. Start Controller
```bash
cd cpp
./build/bin/controller  # or build\bin\Release\controller.exe on Windows
```

### 3. Start Follower
```bash
cd cpp
./build/bin/follower [session-token]  # Optional: omit token for auto-join by IP
```

## Configuration

Edit `cpp/config.json` to configure:
- Relay server host/port
- Monitor intervals
- Restart delays

Binaries will be in `cpp/build/bin/` (or `cpp/build/bin/Release/` on Windows).

