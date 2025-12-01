"""League of Legends utilities."""

import json
import os
import re
import sys
from typing import Optional

import yaml

from . import process_manager
from .logger import Logger

_logger = Logger("LeagueUtils")

# Process names
LEAGUE_CLIENT_PROCESS = "LeagueClient"
LEAGUE_CLIENT_UX_PROCESS = "LeagueClientUx"
RIOT_CLIENT_PROCESS = "RiotClientServices"

LEAGUE_GAME_PROCESSES = [
    "League of Legends",
    "League Of Legends",
]

# All League-related processes for counting
ALL_LEAGUE_PROCESSES = [
    "LeagueClient",
    "LeagueClientUx",
    "LeagueClientUxRender",
]


def get_league_install_path() -> Optional[str]:
    """Get League of Legends installation path from YAML settings (same as C# version)."""
    if sys.platform == "darwin":
        # macOS paths
        paths = [
            "/Applications/League of Legends.app",
            os.path.expanduser("~/Applications/League of Legends.app"),
        ]
        for path in paths:
            if os.path.exists(path):
                _logger.info(f"Found League installation: {path}")
                return path
    else:
        # Windows - Read from Riot's YAML config (same as C# version)
        try:
            program_data = os.environ.get("PROGRAMDATA", r"C:\ProgramData")
            yaml_path = os.path.join(
                program_data, "Riot Games", "Metadata", "league_of_legends.live",
                "league_of_legends.live.product_settings.yaml"
            )

            if os.path.exists(yaml_path):
                with open(yaml_path, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f)

                install_path = data.get("product_install_full_path")
                if install_path and os.path.exists(install_path):
                    _logger.info(f"Found League installation via YAML: {install_path}")
                    return install_path

        except Exception as e:
            _logger.warn(f"Failed to read YAML config: {e}")

        # Fallback to default paths
        default_paths = [
            r"C:\Riot Games\League of Legends",
            r"D:\Riot Games\League of Legends",
        ]
        for path in default_paths:
            if os.path.exists(path):
                _logger.info(f"Using default Windows path: {path}")
                return path

    _logger.error("Could not find League of Legends installation")
    return None


def get_riot_client_path() -> Optional[str]:
    """Get Riot Client executable path from RiotClientInstalls.json (same as C# version)."""
    if sys.platform == "darwin":
        # macOS
        paths = [
            "/Applications/Riot Client.app",
            os.path.expanduser("~/Applications/Riot Client.app"),
        ]
        for path in paths:
            if os.path.exists(path):
                _logger.info(f"Found Riot Client: {path}")
                return path
    else:
        # Windows - Read from RiotClientInstalls.json (same as C# version)
        program_data = os.environ.get("PROGRAMDATA", r"C:\ProgramData")
        installs_path = os.path.join(program_data, "Riot Games", "RiotClientInstalls.json")

        if os.path.exists(installs_path):
            try:
                with open(installs_path, "r", encoding="utf-8") as f:
                    content = f.read().strip()

                # Clean content: remove BOM, handle trailing commas (same as C#)
                content = content.lstrip('\ufeff')
                content = re.sub(r',\s*}', '}', content)
                content = re.sub(r',\s*]', ']', content)

                data = json.loads(content)

                # Try different paths (same order as C#)
                for key in ["rc_default", "rc_live", "rc_beta"]:
                    path = data.get(key)
                    if path and os.path.exists(path):
                        _logger.info(f"Found Riot Client: {path}")
                        return path

            except Exception as e:
                _logger.warn(f"Failed to parse RiotClientInstalls.json: {e}")

        # Fallback
        default_path = r"C:\Riot Games\Riot Client\RiotClientServices.exe"
        if os.path.exists(default_path):
            _logger.info(f"Using default Riot Client path: {default_path}")
            return default_path

    _logger.error("Could not find Riot Client")
    return None


def launch_league_client() -> bool:
    """Launch League Client via Riot Client."""
    client_path = get_riot_client_path()
    if not client_path:
        _logger.error("Cannot launch client: path not found")
        return False

    if sys.platform == "darwin":
        # macOS: launch via Riot Client app
        args = ["--launch-product=league_of_legends", "--launch-patchline=live"]
        return process_manager.launch_app(client_path, args)
    else:
        # Windows
        args = ["--launch-product=league_of_legends", "--launch-patchline=live"]
        return process_manager.launch_app(client_path, args)


def is_league_client_running() -> bool:
    """Check if League Client is running."""
    return process_manager.is_process_running(LEAGUE_CLIENT_PROCESS)


def is_league_game_running() -> bool:
    """Check if League game is running."""
    return process_manager.is_any_process_running(LEAGUE_GAME_PROCESSES)


def get_league_process_count() -> int:
    """Get count of League-related processes."""
    return process_manager.get_process_count(ALL_LEAGUE_PROCESSES)


def kill_league_client() -> None:
    """Kill League Client and related processes."""
    process_manager.kill_process_by_name(LEAGUE_CLIENT_PROCESS)
    process_manager.kill_process_by_name(RIOT_CLIENT_PROCESS)
    if sys.platform == "darwin":
        process_manager.kill_process_by_name("Riot Client")


def kill_league_game() -> int:
    """Kill League game process."""
    killed = 0
    for name in LEAGUE_GAME_PROCESSES:
        killed += process_manager.kill_process_by_name(name)
    return killed
