# League Monitor - C# Client

A Windows WPF application for League of Legends client monitoring and synchronization.

## Overview

This is the C# version of the League Monitor client. It can run as either a **Controller** or **Follower**, connecting to the existing TypeScript relay server.

## Features

- **Modern WPF UI** with dark theme
- **Mode Selection** at startup (Controller/Follower)
- **Windows API** for process management (no taskkill commands)
- **VGC Service Monitoring** using Windows Service API
- **Auto-reconnect** to relay server
- **IP-based auto-join** for followers

## Architecture

```plaintext
LeagueMonitor/
├── Configuration/
│   └── AppConfig.cs           # Configuration management
├── Core/
│   ├── Logger.cs              # Thread-safe logging with UI binding
│   ├── ProcessManager.cs      # Windows API process management
│   ├── LeagueUtils.cs         # League installation detection
│   └── VanguardService.cs     # VGC service monitoring
├── Network/
│   ├── MessageTypes.cs        # Relay protocol messages
│   └── RelayClient.cs         # WebSocket client
├── Services/
│   ├── ControllerService.cs   # Controller mode logic
│   └── FollowerService.cs     # Follower mode logic
├── ViewModels/
│   └── MainViewModel.cs       # MVVM ViewModel
└── Views/
    └── MainWindow.xaml        # Main UI
```

## Requirements

- .NET 8.0 SDK
- Windows 10/11
- Visual Studio 2022 (recommended) or VS Code with C# extension

## Building

```powershell
# Navigate to csharp directory
cd csharp

# Restore packages
dotnet restore

# Build
dotnet build

# Run
dotnet run --project LeagueMonitor
```

Or open `LeagueMonitor.sln` in Visual Studio and press F5.

## Configuration

Edit `appsettings.json` to configure:

```json
{
  "Relay": {
    "Host": "37.59.96.187",
    "Port": 8080
  },
  "Controller": {
    "MonitorInterval": 5000,
    "KillGameProcess": true,
    "RestartCooldown": 30000,
    "ProcessCountThreshold": 8
  },
  "Follower": {
    "RestartDelay": 30000,
    "StartCooldown": 30000,
    "GameCheckInterval": 5000,
    "GameRunningCheckInterval": 120000,
    "GameRunningRestartCooldown": 600000
  }
}
```

## Usage

### Controller Mode

1. Start the application
2. Click "Start as Controller"
3. A session token will be generated and displayed
4. Share the token with followers (or they can auto-join by IP)

### Follower Mode

1. Start the application
2. (Optional) Enter the session token from controller
3. Click "Start as Follower"
4. If no token is provided, it will attempt to auto-join by IP

## Relay Server

The relay server remains in TypeScript. Start it with:

```bash
# From the root league-monitor directory
npm run relay
```

## Key Differences from TypeScript Version

| Feature | TypeScript | C# |
|---------|------------|-----|
| Process Management | tasklist, wmic, PowerShell | Windows API (P/Invoke) |
| VGC Service Check | sc queryex command | ServiceController API |
| UI | Console | WPF with MVVM |
| Mode Selection | Command-line | GUI at startup |
| Configuration | config.json | appsettings.json |

## License

MIT
