"""Logging utilities."""

import sys
from datetime import datetime
from enum import Enum
from typing import TextIO


class LogLevel(Enum):
    """Log levels."""
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARN = "WARN"
    ERROR = "ERROR"
    SUCCESS = "SUCCESS"


# ANSI color codes
COLORS = {
    LogLevel.DEBUG: "\033[90m",     # Gray
    LogLevel.INFO: "\033[97m",      # White
    LogLevel.WARN: "\033[93m",      # Yellow
    LogLevel.ERROR: "\033[91m",     # Red
    LogLevel.SUCCESS: "\033[92m",   # Green
}
RESET = "\033[0m"


class Logger:
    """Simple logger with colored output."""

    def __init__(self, name: str, output: TextIO = sys.stdout):
        self._name = name
        self._output = output
        self._use_colors = hasattr(output, "isatty") and output.isatty()

    def _log(self, level: LogLevel, message: str) -> None:
        """Log a message."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        
        if self._use_colors:
            color = COLORS.get(level, "")
            formatted = f"{color}[{timestamp}] [{self._name}] [{level.value}] {message}{RESET}"
        else:
            formatted = f"[{timestamp}] [{self._name}] [{level.value}] {message}"

        print(formatted, file=self._output, flush=True)

    def debug(self, message: str) -> None:
        self._log(LogLevel.DEBUG, message)

    def info(self, message: str) -> None:
        self._log(LogLevel.INFO, message)

    def warn(self, message: str) -> None:
        self._log(LogLevel.WARN, message)

    def error(self, message: str, exc: Exception | None = None) -> None:
        if exc:
            message = f"{message}: {exc}"
        self._log(LogLevel.ERROR, message)

    def success(self, message: str) -> None:
        self._log(LogLevel.SUCCESS, message)
