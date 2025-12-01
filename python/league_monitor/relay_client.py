"""WebSocket client for relay server communication."""

import asyncio
import json
from enum import Enum
from typing import Any, Callable, Dict, Optional

import websockets
from websockets.client import WebSocketClientProtocol

from .config import get_config
from .logger import Logger


class MessageType(Enum):
    """Message types for relay protocol."""
    CONNECTED = "CONNECTED"
    CREATE_SESSION = "CREATE_SESSION"
    SESSION_CREATED = "SESSION_CREATED"
    JOIN = "JOIN"
    JOINED = "JOINED"
    RESTART = "RESTART"
    CLIENT_RESTARTED = "CLIENT_RESTARTED"
    RESTART_BROADCASTED = "RESTART_BROADCASTED"
    IMMEDIATE_START = "IMMEDIATE_START"
    IMMEDIATE_START_BROADCASTED = "IMMEDIATE_START_BROADCASTED"
    STATUS_REQUEST = "STATUS_REQUEST"
    STATUS_UPDATE = "STATUS_UPDATE"
    STATUS_BROADCASTED = "STATUS_BROADCASTED"
    GAME_STATUS = "GAME_STATUS"
    GAME_STATUS_RECEIVED = "GAME_STATUS_RECEIVED"
    HEARTBEAT = "HEARTBEAT"
    HEARTBEAT_ACK = "HEARTBEAT_ACK"
    ERROR = "ERROR"


class ClientRole(Enum):
    """Client role in session."""
    CONTROLLER = "controller"
    FOLLOWER = "follower"


class RelayClient:
    """WebSocket client for relay server."""

    def __init__(self, role: ClientRole):
        self._role = role
        self._logger = Logger(f"RelayClient-{role.value}")
        self._config = get_config()
        self._server_url = self._config.relay.url
        
        self._websocket: Optional[WebSocketClientProtocol] = None
        self._session_token: Optional[str] = None
        self._is_connected = False
        self._reconnect_interval = 5.0
        self._running = False
        
        # Event handlers
        self._on_connected: Optional[Callable[[], None]] = None
        self._on_disconnected: Optional[Callable[[], None]] = None
        self._on_session_created: Optional[Callable[[str], None]] = None
        self._on_joined: Optional[Callable[[str, Dict[str, Any]], None]] = None
        self._on_immediate_start: Optional[Callable[[], None]] = None
        self._on_client_restarted: Optional[Callable[[], None]] = None
        self._on_status_update: Optional[Callable[[Dict[str, Any]], None]] = None
        self._on_status_request: Optional[Callable[[], Dict[str, Any]]] = None
        self._on_error: Optional[Callable[[str], None]] = None

    @property
    def is_connected(self) -> bool:
        return self._is_connected

    @property
    def session_token(self) -> Optional[str]:
        return self._session_token

    def on_connected(self, handler: Callable[[], None]) -> None:
        self._on_connected = handler

    def on_disconnected(self, handler: Callable[[], None]) -> None:
        self._on_disconnected = handler

    def on_session_created(self, handler: Callable[[str], None]) -> None:
        self._on_session_created = handler

    def on_joined(self, handler: Callable[[str, Dict[str, Any]], None]) -> None:
        self._on_joined = handler

    def on_immediate_start(self, handler: Callable[[], None]) -> None:
        self._on_immediate_start = handler

    def on_client_restarted(self, handler: Callable[[], None]) -> None:
        self._on_client_restarted = handler

    def on_status_update(self, handler: Callable[[Dict[str, Any]], None]) -> None:
        self._on_status_update = handler

    def on_status_request(self, handler: Callable[[], Dict[str, Any]]) -> None:
        self._on_status_request = handler

    def on_error(self, handler: Callable[[str], None]) -> None:
        self._on_error = handler

    async def connect(self, session_token: Optional[str] = None) -> None:
        """Connect to relay server."""
        self._session_token = session_token
        self._running = True
        
        while self._running:
            try:
                self._logger.info(f"Connecting to relay server at {self._server_url}...")
                
                async with websockets.connect(self._server_url) as ws:
                    self._websocket = ws
                    self._is_connected = True
                    self._logger.success("Connected to relay server")
                    
                    if self._on_connected:
                        self._on_connected()
                    
                    # Join session
                    await self._join_session(self._session_token)
                    
                    # Receive loop
                    await self._receive_loop()
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                self._logger.error("Connection error", e)
            
            self._is_connected = False
            if self._on_disconnected:
                self._on_disconnected()
            
            if self._running:
                self._logger.info(f"Reconnecting in {self._reconnect_interval} seconds...")
                await asyncio.sleep(self._reconnect_interval)

    async def disconnect(self) -> None:
        """Disconnect from relay server."""
        self._running = False
        if self._websocket:
            await self._websocket.close()
        self._is_connected = False

    async def _receive_loop(self) -> None:
        """Receive messages from server."""
        try:
            async for message in self._websocket:
                await self._handle_message(message)
        except websockets.ConnectionClosed:
            self._logger.warn("Server closed connection")
        except Exception as e:
            self._logger.error("Receive error", e)

    async def _handle_message(self, message: str) -> None:
        """Handle incoming message."""
        try:
            data = json.loads(message)
            msg_type = data.get("type", "")
            
            if msg_type == "CONNECTED":
                self._logger.info(f"Client ID: {data.get('clientId')}")
            
            elif msg_type == "SESSION_CREATED":
                token = data.get("token")
                self._session_token = token
                self._logger.success(f"Session created: {token}")
                if self._on_session_created:
                    self._on_session_created(token)
                # Auto-join own session
                await self._join_session(token)
            
            elif msg_type == "JOINED":
                self._session_token = data.get("sessionToken")
                self._logger.success(f"Joined session as {data.get('role')}")
                
                if data.get("autoJoined"):
                    self._logger.success("Auto-joined session by IP address")
                
                session_info = data.get("sessionInfo", {})
                self._logger.info(f"Session: {self._session_token}")
                self._logger.info(f"Controller: {'Yes' if session_info.get('hasController') else 'No'}")
                self._logger.info(f"Followers: {session_info.get('followerCount', 0)}")
                
                if self._on_joined:
                    self._on_joined(self._session_token, session_info)
            
            elif msg_type == "IMMEDIATE_START":
                self._logger.info("Received immediate start command from controller!")
                if self._on_immediate_start:
                    self._on_immediate_start()
            
            elif msg_type == "IMMEDIATE_START_BROADCASTED":
                self._logger.success(f"Immediate start command sent to {data.get('sentTo')} follower(s)")
            
            elif msg_type == "CLIENT_RESTARTED":
                self._logger.info("Received CLIENT_RESTARTED message from controller!")
                if self._on_client_restarted:
                    self._on_client_restarted()
            
            elif msg_type == "RESTART_BROADCASTED":
                self._logger.success(f"Restart command sent to {data.get('sentTo')} follower(s)")
            
            elif msg_type == "STATUS_UPDATE":
                self._logger.info("Received status update from controller")
                status = data.get("status", {})
                if self._on_status_update:
                    self._on_status_update(status)
            
            elif msg_type == "STATUS_REQUEST":
                self._logger.info("Controller status requested")
                if self._on_status_request:
                    status = self._on_status_request()
                    await self.send_status(status.get("clientRunning", False), status.get("processCount", 0))
            
            elif msg_type == "HEARTBEAT_ACK":
                pass  # Silent
            
            elif msg_type == "ERROR":
                error_msg = data.get("message", "Unknown error")
                self._logger.error(f"Server error: {error_msg}")
                if self._on_error:
                    self._on_error(error_msg)
                
                # Handle session not found - retry auto-join
                if "Session not found" in error_msg or "No session found" in error_msg:
                    if self._role == ClientRole.FOLLOWER and not self._session_token:
                        self._logger.info("Controller not found yet, will retry auto-join...")
                        await asyncio.sleep(5)
                        await self._join_session(None)
            
            else:
                self._logger.info(f"Received: {msg_type}")
                
        except Exception as e:
            self._logger.error("Failed to handle message", e)

    async def _send(self, data: Dict[str, Any]) -> None:
        """Send message to server."""
        if not self._websocket or not self._is_connected:
            self._logger.warn("Cannot send: not connected")
            return
        
        try:
            await self._websocket.send(json.dumps(data))
        except Exception as e:
            self._logger.error("Failed to send message", e)

    async def _join_session(self, token: Optional[str]) -> None:
        """Join a session."""
        await self._send({
            "type": "JOIN",
            "sessionToken": token,
            "role": self._role.value
        })

    async def send_heartbeat(self) -> None:
        """Send heartbeat to keep connection alive."""
        await self._send({"type": "HEARTBEAT"})

    async def broadcast_immediate_start(self) -> None:
        """Broadcast immediate start command (controller only)."""
        if not self._is_connected:
            self._logger.warn("Not connected, cannot broadcast immediate start")
            return
        await self._send({"type": "IMMEDIATE_START"})

    async def broadcast_restart(self) -> None:
        """Broadcast restart command (controller only)."""
        if not self._is_connected:
            self._logger.warn("Not connected, cannot broadcast restart")
            return
        await self._send({"type": "RESTART"})

    async def send_status(self, client_running: bool, process_count: int) -> None:
        """Send status update (controller only)."""
        if not self._is_connected:
            self._logger.warn("Not connected, cannot send status")
            return
        await self._send({
            "type": "STATUS_UPDATE",
            "status": {
                "clientRunning": client_running,
                "processCount": process_count
            }
        })

    async def request_status(self) -> None:
        """Request status from controller (follower only)."""
        if not self._is_connected:
            self._logger.warn("Not connected, cannot request status")
            return
        await self._send({"type": "STATUS_REQUEST"})
