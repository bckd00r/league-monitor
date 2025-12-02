"""Controller service - monitors League Client and broadcasts commands."""

import asyncio
import sys
from typing import Optional

from .config import get_config
from .league_utils import (
    get_league_process_count,
    is_league_client_running,
    kill_league_client,
    launch_league_client,
)
from .logger import Logger
from .relay_client import ClientRole, RelayClient


class ControllerService:
    """Controller service - monitors League Client and notifies followers."""

    def __init__(self):
        self._logger = Logger("Controller")
        self._config = get_config().controller
        self._relay_client = RelayClient(ClientRole.CONTROLLER)
        
        self._running = False
        self._is_restarting_client = False
        self._immediate_start_sent = False
        self._last_process_count = 0
        self._session_token: Optional[str] = None
        
        self._setup_event_handlers()

    def _setup_event_handlers(self) -> None:
        """Setup relay client event handlers."""
        
        @self._relay_client.on_connected
        def on_connected():
            self._logger.success("Connected to relay server")

        @self._relay_client.on_disconnected
        def on_disconnected():
            self._logger.warn("Disconnected from relay server")

        @self._relay_client.on_session_created
        def on_session_created(token: str):
            self._session_token = token
            self._logger.success("=" * 60)
            self._logger.success(f"SESSION TOKEN: {token}")
            self._logger.success("Share this token with follower clients to connect")
            self._logger.success("=" * 60)

        @self._relay_client.on_joined
        def on_joined(token: str, info: dict):
            self._session_token = token

        @self._relay_client.on_status_request
        def on_status_request() -> dict:
            is_running = is_league_client_running()
            process_count = get_league_process_count()
            self._logger.info(f"Status check: LeagueClient is {'RUNNING' if is_running else 'NOT RUNNING'}, Process count: {process_count}")
            return {"clientRunning": is_running, "processCount": process_count}

    async def start(self) -> None:
        """Start controller service."""
        if self._running:
            return

        self._logger.info("Starting League Client Controller...")
        self._running = True

        # Start relay client connection
        relay_task = asyncio.create_task(self._relay_client.connect())

        # Wait for connection
        await asyncio.sleep(2)

        # Initial check - ensure LeagueClient is running
        await self._ensure_client_running()

        # Start monitoring tasks
        monitor_task = asyncio.create_task(self._monitor_loop())
        heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        self._logger.success("Controller is running!")

        try:
            await asyncio.gather(relay_task, monitor_task, heartbeat_task)
        except asyncio.CancelledError:
            pass
        finally:
            self._running = False

    async def stop(self) -> None:
        """Stop controller service."""
        self._logger.info("Stopping controller...")
        self._running = False
        await self._relay_client.disconnect()
        self._logger.info("Controller stopped")

    async def _monitor_loop(self) -> None:
        """Main monitoring loop."""
        # macOS: threshold = 2, Windows: threshold from config (default 7)
        if sys.platform == "darwin":
            threshold = 2
            delay_before_send = 15.0  # 5 seconds delay for macOS
            self._logger.info(f"macOS detected: using threshold={threshold}, delay={delay_before_send}s")
        else:
            threshold = self._config.process_count_threshold
            delay_before_send = 0.0
            self._logger.info(f"Windows detected: using threshold={threshold}")

        while self._running:
            try:
                await asyncio.sleep(self._config.check_interval)

                # Check process count
                process_count = get_league_process_count()
                
                if process_count != self._last_process_count:
                    self._last_process_count = process_count
                    self._logger.info(f"Process count: {process_count}")

                # Check if client is running
                client_running = is_league_client_running()

                if not client_running and not self._is_restarting_client:
                    # Client stopped - restart it
                    self._logger.warn("LeagueClient is not running!")
                    self._immediate_start_sent = False  # Reset flag
                    await self._ensure_client_running()
                
                elif client_running and process_count >= threshold:
                    # Client is running and process count threshold reached
                    if not self._immediate_start_sent:
                        self._logger.success(f"Process count {process_count} >= {threshold}!")
                        
                        # Wait before sending (macOS: 5s, Windows: 0s)
                        if delay_before_send > 0:
                            self._logger.info(f"Waiting {delay_before_send}s before sending IMMEDIATE_START...")
                            await asyncio.sleep(delay_before_send)
                        
                        self._logger.success("Sending IMMEDIATE_START to followers...")
                        self._immediate_start_sent = True
                        await self._relay_client.broadcast_immediate_start()

            except asyncio.CancelledError:
                break
            except Exception as e:
                self._logger.error("Monitor loop error", e)

    async def _ensure_client_running(self) -> None:
        """Ensure LeagueClient is running, restart if not."""
        if self._is_restarting_client:
            return
        if is_league_client_running():
            return

        self._is_restarting_client = True

        try:
            self._logger.warn("LeagueClient is not running, restarting...")

            # Kill any lingering processes
            kill_league_client()
            await asyncio.sleep(1)

            # Launch client
            success = launch_league_client()
            
            if success:
                self._logger.success("LeagueClient launched successfully")
                
                # Wait for client to appear
                self._logger.info("Waiting for LeagueClient process to appear...")
                for _ in range(30):  # 15 seconds timeout
                    await asyncio.sleep(0.5)
                    if is_league_client_running():
                        self._logger.success("LeagueClient process detected")
                        break
                else:
                    self._logger.warn("LeagueClient process not detected after 15 seconds")
                
                self._logger.info("Waiting for process count to reach threshold before notifying followers...")
            else:
                self._logger.error("Failed to launch LeagueClient")

        finally:
            self._is_restarting_client = False

    async def _heartbeat_loop(self) -> None:
        """Send periodic heartbeats."""
        while self._running:
            try:
                await asyncio.sleep(30)
                if self._relay_client.is_connected:
                    await self._relay_client.send_heartbeat()
            except asyncio.CancelledError:
                break
            except Exception as e:
                self._logger.error("Heartbeat error", e)
