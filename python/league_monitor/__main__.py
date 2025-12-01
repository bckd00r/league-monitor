"""Entry point for League Monitor."""

import argparse
import asyncio
import signal
import sys

from .config import get_config
from .controller import ControllerService
from .follower import FollowerService
from .logger import Logger

_logger = Logger("Main")


def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="League Monitor - Client synchronization tool"
    )
    parser.add_argument(
        "--mode",
        "-m",
        choices=["controller", "follower", "gui"],
        default="gui",
        help="Run mode: controller, follower, or gui (default: gui)"
    )
    parser.add_argument(
        "--token",
        "-t",
        default=None,
        help="Session token (follower mode only, optional for auto-join)"
    )
    parser.add_argument(
        "--config",
        "-c",
        default=None,
        help="Path to config.yaml file"
    )
    parser.add_argument(
        "--no-gui",
        action="store_true",
        help="Run in terminal mode without GUI"
    )
    return parser.parse_args()


async def run_controller() -> None:
    """Run controller mode."""
    service = ControllerService()
    
    # Handle shutdown signals
    loop = asyncio.get_event_loop()
    
    def shutdown():
        _logger.info("Shutdown signal received...")
        asyncio.create_task(service.stop())
    
    if sys.platform != "win32":
        loop.add_signal_handler(signal.SIGINT, shutdown)
        loop.add_signal_handler(signal.SIGTERM, shutdown)
    
    try:
        await service.start()
    except KeyboardInterrupt:
        await service.stop()


async def run_follower(token: str | None) -> None:
    """Run follower mode."""
    service = FollowerService()
    
    # Handle shutdown signals
    loop = asyncio.get_event_loop()
    
    def shutdown():
        _logger.info("Shutdown signal received...")
        asyncio.create_task(service.stop())
    
    if sys.platform != "win32":
        loop.add_signal_handler(signal.SIGINT, shutdown)
        loop.add_signal_handler(signal.SIGTERM, shutdown)
    
    try:
        await service.start(token)
    except KeyboardInterrupt:
        await service.stop()


def main() -> None:
    """Main entry point."""
    args = parse_args()
    
    # GUI mode (default)
    if args.mode == "gui" or (not args.no_gui and args.mode not in ["controller", "follower"]):
        from .gui import run_gui
        run_gui()
        return
    
    # Terminal mode
    config = get_config()
    _logger.info(f"Relay server: {config.relay.host}:{config.relay.port}")
    
    _logger.info("=" * 50)
    _logger.info("League Monitor - Python Client")
    _logger.info("=" * 50)
    
    try:
        if args.mode == "controller":
            _logger.info("Starting in CONTROLLER mode...")
            asyncio.run(run_controller())
        else:
            _logger.info("Starting in FOLLOWER mode...")
            asyncio.run(run_follower(args.token))
    except KeyboardInterrupt:
        _logger.info("Interrupted by user")
    except Exception as e:
        _logger.error("Fatal error", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
