# Build script for Windows .exe

Write-Host "========================================"
Write-Host "League Monitor - Windows Build Script"
Write-Host "========================================"

# Create virtual environment if not exists
if (-not (Test-Path "venv")) {
    Write-Host "Creating virtual environment..."
    python -m venv venv
}

# Activate virtual environment
.\venv\Scripts\Activate.ps1

# Install dependencies
Write-Host "Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt
pip install pyinstaller

# Create assets directory if not exists
if (-not (Test-Path "assets")) {
    New-Item -ItemType Directory -Path "assets" | Out-Null
    Write-Host "Note: Place your icon.ico file in the assets directory"
}

# Clean previous builds
Write-Host "Cleaning previous builds..."
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue build, dist

# Build the exe
Write-Host "Building .exe..."
pyinstaller `
    --name "LeagueMonitor" `
    --windowed `
    --onefile `
    --add-data "config.yaml;." `
    --hidden-import "PIL._tkinter_finder" `
    --collect-all customtkinter `
    league_monitor/__main__.py

Write-Host ""
Write-Host "========================================"
Write-Host "Build complete!"
Write-Host "========================================"
Write-Host ""
Write-Host "Exe location: dist\LeagueMonitor.exe"
Write-Host ""

# Deactivate virtual environment
deactivate
