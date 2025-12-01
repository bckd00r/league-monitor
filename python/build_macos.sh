#!/bin/bash

# Build script for macOS .app bundle

set -e

echo "========================================"
echo "League Monitor - macOS Build Script"
echo "========================================"

# Check if we're on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "Error: This script must be run on macOS"
    exit 1
fi

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
pip install py2app

# Create assets directory if not exists
if [ ! -d "assets" ]; then
    mkdir -p assets
    echo "Note: Place your icon.icns file in the assets directory"
fi

# Create default icon if not exists
if [ ! -f "assets/icon.icns" ]; then
    echo "Creating placeholder icon..."
    # Create a simple placeholder (will use default icon)
    touch assets/icon.icns
fi

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf build dist

# Build the app
echo "Building .app bundle..."
python setup.py py2app

echo ""
echo "========================================"
echo "Build complete!"
echo "========================================"
echo ""
echo "App location: dist/League Monitor.app"
echo ""
echo "To install, drag the app to /Applications"
echo ""

# Deactivate virtual environment
deactivate
