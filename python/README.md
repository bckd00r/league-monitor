# League Monitor - Python Client

Cross-platform League of Legends client monitor with modern GUI.

## Features

- **Modern GUI**: Dark-themed interface with CustomTkinter
- **Controller Mode**: Monitors LeagueClient, restarts if closed, notifies followers when ready
- **Follower Mode**: Receives commands from controller, starts LeagueClient on demand
- **Auto-reconnect**: Automatic reconnection to relay server
- **IP-based auto-join**: Followers can join without token
- **Cross-platform**: Works on macOS and Windows

## Requirements

- Python 3.10+
- macOS 10.15+ or Windows 10+

## Installation

```bash
cd python
pip install -r requirements.txt
```

## Usage

### GUI Mode (Default)

```bash
python -m league_monitor
```

### Terminal Mode

```bash
# Controller
python -m league_monitor --mode controller --no-gui

# Follower
python -m league_monitor --mode follower --no-gui

# Follower with token
python -m league_monitor --mode follower --token ABC123 --no-gui
```

## Building Standalone App

### macOS (.app bundle)

```bash
chmod +x build_macos.sh
./build_macos.sh
```

Output: `dist/League Monitor.app`

### Windows (.exe)

```powershell
.\build_windows.ps1
```

Output: `dist\LeagueMonitor.exe`

### Cross-platform (PyInstaller)

```bash
chmod +x build_pyinstaller.sh
./build_pyinstaller.sh
```

## Configuration

Edit `config.yaml`:

```yaml
relay:
  host: "37.59.96.187"
  port: 8080

controller:
  process_count_threshold: 7
  check_interval: 2.0

follower:
  start_delay: 2.0
```

## Project Structure

```plaintext
python/
├── league_monitor/
│   ├── __init__.py
│   ├── __main__.py           # Entry point
│   ├── config.py             # Configuration
│   ├── logger.py             # Logging
│   ├── process_manager.py    # Process management
│   ├── league_utils.py       # League utilities
│   ├── relay_client.py       # WebSocket client
│   ├── controller.py         # Controller service
│   ├── follower.py           # Follower service
│   └── gui.py                # GUI application
├── assets/
│   ├── icon.icns             # macOS icon
│   └── icon.ico              # Windows icon
├── config.yaml
├── requirements.txt
├── setup.py                  # py2app setup
├── build_macos.sh            # macOS build script
├── build_windows.ps1         # Windows build script
└── README.md
```
