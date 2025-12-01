#!/bin/bash

# Alternative build script using PyInstaller (cross-platform)

set -e

echo "========================================"
echo "League Monitor - PyInstaller Build"
echo "========================================"

# Create virtual environment if not exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt
pip install pyinstaller

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf build dist

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    echo "Building for macOS..."
    pyinstaller \
        --name "League Monitor" \
        --windowed \
        --onedir \
        --icon "assets/icon.icns" \
        --add-data "config.yaml:." \
        --hidden-import "PIL._tkinter_finder" \
        --collect-all customtkinter \
        league_monitor/__main__.py
    
    echo ""
    echo "App location: dist/League Monitor.app"
    
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    # Windows
    echo "Building for Windows..."
    pyinstaller \
        --name "LeagueMonitor" \
        --windowed \
        --onefile \
        --icon "assets/icon.ico" \
        --add-data "config.yaml;." \
        --hidden-import "PIL._tkinter_finder" \
        --collect-all customtkinter \
        league_monitor/__main__.py
    
    echo ""
    echo "Exe location: dist/LeagueMonitor.exe"
    
else
    # Linux
    echo "Building for Linux..."
    pyinstaller \
        --name "league-monitor" \
        --windowed \
        --onefile \
        --add-data "config.yaml:." \
        --hidden-import "PIL._tkinter_finder" \
        --collect-all customtkinter \
        league_monitor/__main__.py
    
    echo ""
    echo "Binary location: dist/league-monitor"
fi

echo ""
echo "========================================"
echo "Build complete!"
echo "========================================"

# Deactivate virtual environment
deactivate
