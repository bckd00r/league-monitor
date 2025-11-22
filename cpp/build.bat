@echo off
echo Building League Monitor C++ Project...
echo.

if not exist build mkdir build
cd build

REM Use Visual Studio 18 2026
echo Configuring CMake for Visual Studio 18 2026...
cmake .. -G "Visual Studio 18 2026" -A x64
if %ERRORLEVEL% NEQ 0 (
    echo CMake configuration failed!
    echo.
    echo Please ensure you have:
    echo - Visual Studio 2026 installed with C++ development tools
    echo - CMake 3.15 or higher
    pause
    exit /b 1
)

echo.
echo Building project...
cmake --build . --config Release
if %ERRORLEVEL% NEQ 0 (
    echo Build failed!
    pause
    exit /b 1
)

echo.
echo Build successful! Binaries are in build\bin\Release\
pause

