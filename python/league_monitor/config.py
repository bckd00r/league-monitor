"""Configuration management."""

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml


@dataclass
class RelayConfig:
    """Relay server configuration."""
    host: str = "37.59.96.187"
    port: int = 8080

    @property
    def url(self) -> str:
        return f"ws://{self.host}:{self.port}"


@dataclass
class ControllerConfig:
    """Controller mode configuration."""
    process_count_threshold: int = 7
    check_interval: float = 2.0
    restart_cooldown: float = 5.0


@dataclass
class FollowerConfig:
    """Follower mode configuration."""
    start_delay: float = 2.0
    check_interval: float = 5.0


@dataclass
class AppConfig:
    """Application configuration."""
    relay: RelayConfig = field(default_factory=RelayConfig)
    controller: ControllerConfig = field(default_factory=ControllerConfig)
    follower: FollowerConfig = field(default_factory=FollowerConfig)

    @classmethod
    def load(cls, config_path: str | None = None) -> "AppConfig":
        """Load configuration from YAML file."""
        if config_path is None:
            # Look for config in current directory or package directory
            paths = [
                Path("config.yaml"),
                Path(__file__).parent.parent / "config.yaml",
            ]
            for path in paths:
                if path.exists():
                    config_path = str(path)
                    break

        config = cls()

        if config_path and os.path.exists(config_path):
            try:
                with open(config_path, "r") as f:
                    data = yaml.safe_load(f) or {}

                if "relay" in data:
                    config.relay = RelayConfig(**data["relay"])
                if "controller" in data:
                    config.controller = ControllerConfig(**data["controller"])
                if "follower" in data:
                    config.follower = FollowerConfig(**data["follower"])

            except Exception as e:
                print(f"Warning: Failed to load config: {e}")

        return config


# Global config instance
_config: AppConfig | None = None


def get_config() -> AppConfig:
    """Get global configuration instance."""
    global _config
    if _config is None:
        _config = AppConfig.load()
    return _config
