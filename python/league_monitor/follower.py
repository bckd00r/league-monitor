"""Follower service - receives commands from controller."""

import asyncio
from typing import Optional

from .config import get_config
from .league_utils import (
    is_league_client_running,
    is_league_game_running,
    kill_league_client,
    launch_league_client,
)
from .logger import Logger
from .relay_client import ClientRole, RelayClient


class FollowerService:
    """Follower service - receives commands and manages local League Client."""

    def __init__(self):
        self._logger = Logger("Follower")
        self._config = get_config().follower
        self._relay_client = RelayClient(ClientRole.FOLLOWER)
        
        self._running = False
        self._is_starting_client = False
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

        @self._relay_client.on_joined
        def on_joined(token: str, info: dict):
            self._session_token = token
            self._logger.success(f"Joined session: {token}")

        @self._relay_client.on_immediate_start
        def on_immediate_start():
            asyncio.create_task(self._handle_immediate_start())

        @self._relay_client.on_client_restarted
        def on_client_restarted():
            asyncio.create_task(self._handle_client_restarted())

        @self._relay_client.on_status_update
        def on_status_update(status: dict):
            self._handle_status_update(status)

    async def start(self, session_token: Optional[str] = None) -> None:
        """Start follower service."""
        if self._running:
            return

        self._logger.info("Starting League Client Follower...")
        
        if session_token:
            self._logger.info(f"Session token: {session_token}")
        else:
            self._logger.info("No token provided - will attempt auto-join by IP address")

        self._running = True

        # Start relay client connection
        relay_task = asyncio.create_task(self._relay_client.connect(session_token))

        # Wait for connection
        await asyncio.sleep(2)

        # Request initial status
        asyncio.create_task(self._request_initial_status())

        # Start heartbeat
        heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        self._logger.success("Follower is running!")
        self._logger.info("Waiting for commands from controller...")

        try:
            await asyncio.gather(relay_task, heartbeat_task)
        except asyncio.CancelledError:
            pass
        finally:
            self._running = False

    async def stop(self) -> None:
        """Stop follower service."""
        self._logger.info("Stopping follower...")
        self._running = False
        await self._relay_client.disconnect()
        self._logger.info("Follower stopped")

    async def _request_initial_status(self) -> None:
        """Request initial status from controller."""
        # Wait for session to be joined
        for _ in range(10):
            if self._relay_client.session_token:
                break
            await asyncio.sleep(1)

        if self._relay_client.is_connected and self._relay_client.session_token:
            self._logger.info("Requesting initial status from controller...")
            await self._relay_client.request_status()

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

    async def _handle_immediate_start(self) -> None:
        """Handle immediate start command from controller."""
        self._logger.info("IMMEDIATE START command received from controller!")

        if self._is_starting_client:
            self._logger.info("Already starting client, skipping.")
            return

        if is_league_game_running():
            self._logger.info("League game is running, skipping LeagueClient launch")
            return

        # Kill existing client if running (restart scenario)
        if is_league_client_running():
            self._logger.info("LeagueClient is already running, killing and restarting...")
            kill_league_client()
            await asyncio.sleep(1)

        await self._launch_client()

    async def _handle_client_restarted(self) -> None:
        """Handle client restarted command from controller."""
        self._logger.info("CLIENT_RESTARTED command received from controller!")

        if self._is_starting_client:
            self._logger.info("Already starting client, skipping.")
            return

        if is_league_game_running():
            self._logger.info("League game is running, skipping LeagueClient launch")
            return

        # Kill existing client if running
        if is_league_client_running():
            self._logger.info("LeagueClient is already running, killing and restarting...")
            kill_league_client()
            await asyncio.sleep(1)

        await self._launch_client()

    def _handle_status_update(self, status: dict) -> None:
        """Handle status update from controller."""
        client_running = status.get("clientRunning", False)
        process_count = status.get("processCount", 0)
        client_ready = status.get("clientReady", False)
        
        self._logger.info(
            f"Controller status: LeagueClient {'RUNNING' if client_running else 'NOT RUNNING'}, "
            f"Process count: {process_count}, Ready: {client_ready}"
        )
        
        # If controller's client is ready, start our client (fallback if IMMEDIATE_START was missed)
        if client_ready and client_running:
            if not is_league_client_running() and not self._is_starting_client:
                self._logger.info("Controller is ready, starting our LeagueClient...")
                asyncio.create_task(self._launch_client())

    async def _launch_client(self) -> None:
        """Launch League Client."""
        if self._is_starting_client:
            return

        self._is_starting_client = True

        try:
            self._logger.info("Launching LeagueClient...")
            success = launch_league_client()

            if success:
                self._logger.success("LeagueClient launched successfully")

                # Wait for process to appear
                self._logger.info("Waiting for LeagueClient process to appear...")
                for _ in range(30):  # 15 seconds timeout
                    await asyncio.sleep(0.5)
                    if is_league_client_running():
                        self._logger.success("LeagueClient process detected")
                        break
                else:
                    self._logger.warn("LeagueClient process not detected after 15 seconds")
            else:
                self._logger.error("Failed to launch LeagueClient")

        finally:
            self._is_starting_client = False
