# League Client Monitor

A TypeScript-based multi-computer synchronization system for League of Legends client management using session tokens and a central relay server.

## 🎯 Overview

This system allows you to synchronize League of Legends client behavior across multiple computers. When the client restarts on one machine (controller), all connected machines (followers) automatically restart their clients after a configurable delay.

## 🏗️ Architecture

```
┌─────────────┐          ┌─────────────┐          ┌─────────────┐
│   Mac       │          │     VPS     │          │   Windows   │
│ (Controller)│◄────────►│Relay Server │◄────────►│  (Follower) │
│             │ WebSocket│             │ WebSocket│             │
└─────────────┘          └─────────────┘          └─────────────┘
```

### Components

**Relay Server (VPS or Local)**
- Central hub for session management
- Session token generation and validation
- Message routing between controller and followers
- Runs on any Node.js-compatible server

**Controller (Primary Machine)**
- Monitors LeagueClient process (every 5 seconds)
- Auto-restarts client when it closes
- Kills game process instantly if detected
- Creates session and broadcasts events to followers
- Responds to status requests

**Follower (Secondary Machine)**
- Connects using session token from controller
- Syncs initial state with controller on join
- Receives restart notifications
- Launches client with configurable delay (default: 30s)

## ✨ Features

- **Session Token Authentication**: Secure, unique tokens for each session
- **Auto-Discovery**: Followers sync with controller's current state on join
- **Cross-Platform**: Works on macOS and Windows
- **Auto-Reconnect**: Clients automatically reconnect if connection drops
- **Heartbeat System**: Keeps connections alive
- **Game Process Killer**: Prevents accidental game launches on controller
- **Flexible Deployment**: Run relay server locally or on VPS

## 📦 Installation

```bash
cd league-monitor
npm install
```

## 🚀 Quick Start

### 1. Setup Configuration

Copy the example config:
```bash
cp config.example.json config.json
```

Edit `config.json` and update the relay server host:
```json
{
  "controller": {
    "relayServerHost": "your-vps-ip",
    "relayServerPort": 8080,
    ...
  },
  "follower": {
    "relayServerHost": "your-vps-ip",
    "relayServerPort": 8080,
    ...
  }
}
```

### 2. Start Relay Server

**On VPS (recommended):**
```bash
ssh root@your-vps-ip
cd /opt/league-monitor
npm install
pm2 start npm --name relay-server -- run relay
```

**Or locally:**
```bash
npm run relay
```

### 3. Start Controller (Mac)

Run:
```bash
npm run controller
```

Copy the session token from output:
```
============================================================
SESSION TOKEN: abc123def456789
Share this token with follower clients to connect
============================================================
```

### 4. Start Follower (Windows)

Run with token:
```bash
npm run follower abc123def456789
```

## 📋 Configuration

### Relay Server
- **Port**: 8080 (default)
- **Host**: 0.0.0.0 (all interfaces)

### Controller
- **Monitor Interval**: 5000ms (5 seconds)
- **Auto-restart**: Enabled
- **Game process kill**: Enabled

### Follower
- **Restart Delay**: 30000ms (30 seconds)
- **Auto-sync on join**: Enabled

## 🔧 Commands

```bash
# Relay server (VPS or local)
npm run relay

# Controller (Mac - creates session)
npm run controller

# Follower (Windows - joins session)
npm run follower <session-token>

# Development mode (auto-reload)
npm run dev:relay
npm run dev:controller
npm run dev:follower
```

## 📖 How It Works

### Initial Connection
1. Controller connects to relay server
2. Relay generates unique session token
3. Controller shares token with follower
4. Follower joins session using token
5. Follower requests current status
6. Controller responds with LeagueClient state
7. Follower syncs to match controller's state

### Client Restart Flow
1. LeagueClient closes on controller
2. Controller auto-restarts LeagueClient
3. Controller sends restart event to relay
4. Relay broadcasts to all followers in session
5. Followers wait configured delay (30s)
6. Followers launch their LeagueClient

### Status Sync
- Follower joins → requests status
- Controller responds with current state
- If client running → follower starts client
- If client stopped → follower waits

## 🌐 VPS Deployment

Quick VPS setup:
```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install PM2
npm install -g pm2

# Deploy and start
cd /opt/league-monitor
npm install
pm2 start npm --name relay-server -- run relay
pm2 save
pm2 startup

# Open firewall
ufw allow 8080/tcp
```

## 🔍 Troubleshooting

### "Session token is required"
Provide token as command argument:
```bash
npm run follower your-token-here
```

### "Failed to connect to relay server"
- Check if relay server is running
- Verify VPS IP address is correct
- Ensure port 8080 is open on firewall
- Test with: `curl http://your-vps-ip:8080/health`

### "Session not found"
- Ensure controller is running
- Verify token is correct (copy-paste without spaces)
- Check if session expired (24h timeout)

### Client not auto-starting
- Check League installation path
- Verify RiotClientInstalls.json exists
- Ensure sufficient permissions

## 📄 License

MIT

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
