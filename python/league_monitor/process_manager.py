"""Cross-platform process management."""

import subprocess
import sys
from typing import List

import psutil

from .logger import Logger

_logger = Logger("ProcessManager")


def is_process_running(process_name: str) -> bool:
    """Check if a process is running by name."""
    try:
        process_name_lower = process_name.lower()
        for proc in psutil.process_iter(["name"]):
            try:
                name = proc.info["name"]
                if name and name.lower() == process_name_lower:
                    return True
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return False
    except Exception as e:
        _logger.error("Failed to check process", e)
        return False


def is_any_process_running(process_names: List[str]) -> bool:
    """Check if any of the given processes is running."""
    return any(is_process_running(name) for name in process_names)


def get_process_count(process_names: List[str]) -> int:
    """Get count of running processes matching any of the given names."""
    try:
        names_lower = {name.lower() for name in process_names}
        count = 0
        for proc in psutil.process_iter(["name"]):
            try:
                name = proc.info["name"]
                if name and name.lower() in names_lower:
                    count += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return count
    except Exception as e:
        _logger.error("Failed to get process count", e)
        return 0


def get_process_pids(process_name: str) -> List[int]:
    """Get all PIDs for a process name."""
    pids = []
    try:
        process_name_lower = process_name.lower()
        for proc in psutil.process_iter(["name", "pid"]):
            try:
                name = proc.info["name"]
                if name and name.lower() == process_name_lower:
                    pids.append(proc.info["pid"])
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except Exception as e:
        _logger.error("Failed to get process PIDs", e)
    return pids


def kill_process(pid: int) -> bool:
    """Kill a process by PID."""
    try:
        proc = psutil.Process(pid)
        proc.terminate()
        proc.wait(timeout=5)
        _logger.info(f"Killed process with PID: {pid}")
        return True
    except psutil.NoSuchProcess:
        _logger.info(f"Process {pid} already terminated")
        return True
    except psutil.TimeoutExpired:
        try:
            proc.kill()
            _logger.info(f"Force killed process with PID: {pid}")
            return True
        except Exception as e:
            _logger.error(f"Failed to force kill process {pid}", e)
            return False
    except Exception as e:
        _logger.error(f"Failed to kill process {pid}", e)
        return False


def kill_process_by_name(process_name: str) -> int:
    """Kill all processes by name. Returns count of killed processes."""
    pids = get_process_pids(process_name)
    killed = 0
    for pid in pids:
        if kill_process(pid):
            killed += 1
    return killed


def launch_app(app_path: str, args: List[str] | None = None) -> bool:
    """Launch an application."""
    try:
        cmd = [app_path] + (args or [])
        
        if sys.platform == "darwin":
            # macOS: use 'open' command for .app bundles
            if app_path.endswith(".app"):
                cmd = ["open", "-a", app_path]
                if args:
                    cmd.extend(["--args"] + args)
        
        subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True
        )
        _logger.success(f"Launched application: {app_path}")
        return True
    except Exception as e:
        _logger.error(f"Failed to launch {app_path}", e)
        return False
