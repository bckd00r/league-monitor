# League Client Monitor - Multi-PC Sync System

A TypeScript-based system for monitoring and synchronizing League of Legends client across multiple computers.

## Architecture

- **Controller (Mac)**: Monitors LeagueClient, auto-restarts when closed, kills game process, broadcasts restart events
- **Client (PC 2)**: Listens for restart events and launches client after delay

## Features

### Controller (Mac - Primary Computer)
- Monitors LeagueClient process every 5 seconds
- Auto-restarts LeagueClient if it closes
- Instantly kills "League of Legends" game process if detected
- Broadcasts restart events to connected clients via WebSocket

### Client (Secondary Computer)
- Connects to controller via WebSocket
- Waits 30 seconds after receiving restart event
- Launches LeagueClient automatically

## Installation

```bash
cd league-monitor
npm install
```

## Configuration

### Controller (Mac)
Edit `src/controller/index.ts`:
```typescript
const config: ControllerConfig = {
  port: 8080,                 // WebSocket server port
  monitorInterval: 5000       // Check every 5 seconds
};
```

### Client (PC 2)
Edit `src/client/index.ts`:
```typescript
const config: ClientConfig = {
  serverHost: '192.168.1.100',  // Mac's IP address
  serverPort: 8080,
  restartDelay: 30000            // 30 seconds delay
};
```

## Usage

### On Mac (Controller)
```bash
npm run controller
```

Or for development with auto-reload:
```bash
npm run dev:controller
```

### On PC 2 (Client)
```bash
npm run client
```

Or for development:
```bash
npm run dev:client
```

## Build

```bash
npm run build
```

Compiled files will be in `dist/` directory.

## How It Works

1. **Controller starts** and begins monitoring LeagueClient
2. **Client connects** to controller via WebSocket
3. **If LeagueClient closes** on controller:
   - Controller auto-restarts LeagueClient
   - Controller broadcasts restart event
   - Client receives event and waits 30 seconds
   - Client launches its own LeagueClient
4. **If game starts** on controller:
   - Controller kills game process immediately
   - LeagueClient continues running

## Network Requirements

- Both computers must be on the same network
- Controller's IP address must be accessible from client
- Port 8080 (or configured port) must be open

## Platform Support

- **Controller**: Designed for macOS (can work on Windows with limitations)
- **Client**: Works on both Windows and macOS

## Process Names

- **LeagueClient**: The client application
- **League of Legends**: The actual game (gets killed on controller)

## Troubleshooting

### Client can't connect
- Check if Mac's IP address is correct
- Verify firewall settings allow port 8080
- Ensure both machines are on same network

### Client not auto-starting
- Verify League installation path
- Check RiotClientInstalls.json exists
- Ensure sufficient permissions

### Game keeps starting on Mac
- Check monitor interval (may need to be more frequent)
- Verify process names match your system
