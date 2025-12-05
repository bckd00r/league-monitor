"""GUI application using CustomTkinter."""

import asyncio
import threading
from typing import Optional

import customtkinter as ctk

from .config import get_config
from .controller import ControllerService
from .follower import FollowerService
from .league_utils import get_league_process_count, is_league_client_running
from .logger import Logger


# Theme settings
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")


class LogFrame(ctk.CTkFrame):
    """Log display frame."""

    def __init__(self, master, **kwargs):
        super().__init__(master, **kwargs)
        
        # Header
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=10, pady=(10, 5))
        
        ctk.CTkLabel(
            header, 
            text="Logs", 
            font=ctk.CTkFont(size=16, weight="bold")
        ).pack(side="left")
        
        ctk.CTkButton(
            header,
            text="Clear",
            width=60,
            height=28,
            command=self._clear_logs
        ).pack(side="right")
        
        # Log textbox
        self._textbox = ctk.CTkTextbox(
            self,
            font=ctk.CTkFont(family="Menlo", size=12),
            state="disabled"
        )
        self._textbox.pack(fill="both", expand=True, padx=10, pady=(5, 10))
        
        # Configure tags for colors
        self._textbox.tag_config("INFO", foreground="#FFFFFF")
        self._textbox.tag_config("WARN", foreground="#FFA726")
        self._textbox.tag_config("ERROR", foreground="#EF5350")
        self._textbox.tag_config("SUCCESS", foreground="#4CAF50")
        self._textbox.tag_config("DEBUG", foreground="#90A4AE")

    def add_log(self, message: str, level: str = "INFO") -> None:
        """Add a log entry."""
        self._textbox.configure(state="normal")
        self._textbox.insert("end", message + "\n", level)
        self._textbox.see("end")
        self._textbox.configure(state="disabled")

    def _clear_logs(self) -> None:
        """Clear all logs."""
        self._textbox.configure(state="normal")
        self._textbox.delete("1.0", "end")
        self._textbox.configure(state="disabled")


class ModeSelectionFrame(ctk.CTkFrame):
    """Mode selection frame."""

    def __init__(self, master, on_controller: callable, on_follower: callable, **kwargs):
        super().__init__(master, **kwargs)
        
        self._on_controller = on_controller
        self._on_follower = on_follower
        
        # Title
        ctk.CTkLabel(
            self,
            text="Select Mode",
            font=ctk.CTkFont(size=18, weight="bold")
        ).pack(pady=(20, 15))
        
        # Mode buttons container
        container = ctk.CTkFrame(self, fg_color="transparent")
        container.pack(fill="x", padx=20, pady=10)
        container.grid_columnconfigure((0, 1), weight=1)
        
        # Controller option
        controller_frame = ctk.CTkFrame(container)
        controller_frame.grid(row=0, column=0, padx=(0, 10), sticky="nsew")
        
        ctk.CTkLabel(
            controller_frame,
            text="Controller",
            font=ctk.CTkFont(size=16, weight="bold")
        ).pack(pady=(15, 5))
        
        ctk.CTkLabel(
            controller_frame,
            text="Monitor LeagueClient,\nbroadcast commands\nto followers",
            font=ctk.CTkFont(size=12),
            text_color="#B0BEC5",
            justify="center"
        ).pack(pady=5)
        
        ctk.CTkButton(
            controller_frame,
            text="Start as Controller",
            command=self._on_controller
        ).pack(pady=(10, 20), padx=20)
        
        # Follower option
        follower_frame = ctk.CTkFrame(container)
        follower_frame.grid(row=0, column=1, padx=(10, 0), sticky="nsew")
        
        ctk.CTkLabel(
            follower_frame,
            text="Follower",
            font=ctk.CTkFont(size=16, weight="bold")
        ).pack(pady=(15, 5))
        
        ctk.CTkLabel(
            follower_frame,
            text="Receive commands\nfrom controller,\nauto-join by IP",
            font=ctk.CTkFont(size=12),
            text_color="#B0BEC5",
            justify="center"
        ).pack(pady=5)
        
        # Token entry
        self.token_entry = ctk.CTkEntry(
            follower_frame,
            placeholder_text="Session Token (optional)",
            width=180
        )
        self.token_entry.pack(pady=(10, 5), padx=20)
        
        ctk.CTkButton(
            follower_frame,
            text="Start as Follower",
            fg_color="#0F3460",
            hover_color="#1A4A7A",
            command=self._start_follower
        ).pack(pady=(5, 20), padx=20)

    def _start_follower(self) -> None:
        token = self.token_entry.get().strip() or None
        self._on_follower(token)


class RunningFrame(ctk.CTkFrame):
    """Running mode display frame."""

    def __init__(self, master, mode: str, on_stop: callable, **kwargs):
        super().__init__(master, **kwargs)
        
        self._mode = mode
        self._on_stop = on_stop
        
        # Header row
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=20, pady=(15, 10))
        
        # Mode label
        self._mode_label = ctk.CTkLabel(
            header,
            text=f"{mode.capitalize()} Mode",
            font=ctk.CTkFont(size=18, weight="bold")
        )
        self._mode_label.pack(side="left")
        
        # Stop button
        ctk.CTkButton(
            header,
            text="Stop",
            width=80,
            fg_color="#EF5350",
            hover_color="#F44336",
            command=self._on_stop
        ).pack(side="right")
        
        # Status row
        status_row = ctk.CTkFrame(self, fg_color="transparent")
        status_row.pack(fill="x", padx=20, pady=5)
        
        # Connection status
        self._connection_indicator = ctk.CTkLabel(
            status_row,
            text="",
            width=12,
            height=12,
            fg_color="#EF5350",
            corner_radius=6
        )
        self._connection_indicator.pack(side="left")
        
        self._connection_label = ctk.CTkLabel(
            status_row,
            text="Disconnected",
            font=ctk.CTkFont(size=12),
            text_color="#B0BEC5"
        )
        self._connection_label.pack(side="left", padx=(8, 0))
        
        # Process count (controller only)
        if mode == "controller":
            self._process_label = ctk.CTkLabel(
                status_row,
                text="Processes: 0",
                font=ctk.CTkFont(size=12),
                fg_color="#1E88E5",
                corner_radius=4,
                padx=8,
                pady=2
            )
            self._process_label.pack(side="left", padx=(15, 0))
        
        # Session token row
        token_row = ctk.CTkFrame(self, fg_color="transparent")
        token_row.pack(fill="x", padx=20, pady=(5, 15))
        
        ctk.CTkLabel(
            token_row,
            text="Token:",
            font=ctk.CTkFont(size=12),
            text_color="#B0BEC5"
        ).pack(side="left")
        
        self._token_label = ctk.CTkLabel(
            token_row,
            text="Connecting...",
            font=ctk.CTkFont(family="Menlo", size=12),
            fg_color="#16213E",
            corner_radius=4,
            padx=8,
            pady=2
        )
        self._token_label.pack(side="left", padx=(8, 0))
        
        self._copy_button = ctk.CTkButton(
            token_row,
            text="Copy",
            width=60,
            height=24,
            command=self._copy_token
        )
        self._copy_button.pack(side="left", padx=(8, 0))

    def set_connected(self, connected: bool) -> None:
        """Update connection status."""
        if connected:
            self._connection_indicator.configure(fg_color="#4CAF50")
            self._connection_label.configure(text="Connected")
        else:
            self._connection_indicator.configure(fg_color="#EF5350")
            self._connection_label.configure(text="Disconnected")

    def set_token(self, token: str) -> None:
        """Update session token."""
        self._token_label.configure(text=token)

    def set_process_count(self, count: int) -> None:
        """Update process count (controller only)."""
        if hasattr(self, "_process_label"):
            self._process_label.configure(text=f"Processes: {count}")

    def _copy_token(self) -> None:
        """Copy token to clipboard."""
        token = self._token_label.cget("text")
        if token and token != "Connecting...":
            self.clipboard_clear()
            self.clipboard_append(token)


class LeagueMonitorApp(ctk.CTk):
    """Main application window."""

    def __init__(self):
        super().__init__()
        
        self.title("League Monitor")
        self.geometry("800x600")
        self.minsize(700, 500)
        
        self._config = get_config()
        self._service: Optional[ControllerService | FollowerService] = None
        self._service_thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._mode: Optional[str] = None
        
        self._setup_ui()
        
        # Redirect logger to GUI
        self._setup_logging()

    def _setup_ui(self) -> None:
        """Setup UI components."""
        # Configure grid
        self.grid_rowconfigure(2, weight=1)
        self.grid_columnconfigure(0, weight=1)
        
        # Header
        header = ctk.CTkFrame(self, corner_radius=10)
        header.grid(row=0, column=0, padx=15, pady=(15, 10), sticky="ew")
        
        header_inner = ctk.CTkFrame(header, fg_color="transparent")
        header_inner.pack(fill="x", padx=15, pady=10)
        
        ctk.CTkLabel(
            header_inner,
            text="League Monitor",
            font=ctk.CTkFont(size=24, weight="bold")
        ).pack(side="left")
        
        ctk.CTkLabel(
            header_inner,
            text=f"Relay: {self._config.relay.host}:{self._config.relay.port}",
            font=ctk.CTkFont(size=12),
            text_color="#B0BEC5"
        ).pack(side="right")
        
        # Mode selection / Running panel
        self._mode_frame = ModeSelectionFrame(
            self,
            on_controller=self._start_controller,
            on_follower=self._start_follower,
            corner_radius=10
        )
        self._mode_frame.grid(row=1, column=0, padx=15, pady=5, sticky="ew")
        
        self._running_frame: Optional[RunningFrame] = None
        
        # Log panel
        self._log_frame = LogFrame(self, corner_radius=10)
        self._log_frame.grid(row=2, column=0, padx=15, pady=(5, 10), sticky="nsew")
        
        # Footer
        ctk.CTkLabel(
            self,
            text="League Monitor v1.0 - Python Client",
            font=ctk.CTkFont(size=11),
            text_color="#607D8B"
        ).grid(row=3, column=0, pady=(0, 10))

    def _setup_logging(self) -> None:
        """Redirect logger to GUI."""
        from datetime import datetime
        from . import logger as log_module
        
        original_log = Logger._log
        
        def gui_log(self_logger, level, message):
            original_log(self_logger, level, message)
            # Update GUI in main thread with timestamp
            timestamp = datetime.now().strftime("%H:%M:%S")
            self.after(0, lambda: self._log_frame.add_log(
                f"[{timestamp}] [{self_logger._name}] {message}",
                level.value
            ))
        
        Logger._log = gui_log

    def _start_controller(self) -> None:
        """Start controller mode."""
        self._mode = "controller"
        self._show_running_frame()
        
        self._service = ControllerService()
        self._setup_controller_handlers()
        self._start_service_thread()

    def _start_follower(self, token: Optional[str]) -> None:
        """Start follower mode."""
        self._mode = "follower"
        self._show_running_frame()
        
        self._service = FollowerService()
        self._setup_follower_handlers()
        self._start_service_thread(token)

    def _show_running_frame(self) -> None:
        """Show running frame, hide mode selection."""
        self._mode_frame.grid_forget()
        
        self._running_frame = RunningFrame(
            self,
            mode=self._mode,
            on_stop=self._stop_service,
            corner_radius=10
        )
        self._running_frame.grid(row=1, column=0, padx=15, pady=5, sticky="ew")

    def _setup_controller_handlers(self) -> None:
        """Setup controller UI event handlers (wraps existing handlers)."""
        service = self._service
        relay = service._relay_client
        
        # Store original handlers
        orig_on_connected = relay._on_connected
        orig_on_disconnected = relay._on_disconnected
        orig_on_session_created = relay._on_session_created
        orig_on_joined = relay._on_joined
        
        # Wrap with UI updates
        def on_connected():
            if orig_on_connected:
                orig_on_connected()
            self.after(0, lambda: self._running_frame.set_connected(True))
        
        def on_disconnected():
            if orig_on_disconnected:
                orig_on_disconnected()
            self.after(0, lambda: self._running_frame.set_connected(False))
        
        def on_session_created(token: str):
            if orig_on_session_created:
                orig_on_session_created(token)
            self.after(0, lambda: self._running_frame.set_token(token))
        
        def on_joined(token: str, info: dict):
            if orig_on_joined:
                orig_on_joined(token, info)
            self.after(0, lambda: self._running_frame.set_token(token))
        
        relay._on_connected = on_connected
        relay._on_disconnected = on_disconnected
        relay._on_session_created = on_session_created
        relay._on_joined = on_joined

    def _setup_follower_handlers(self) -> None:
        """Setup follower UI event handlers (wraps existing handlers)."""
        service = self._service
        relay = service._relay_client
        
        # Store original handlers
        orig_on_connected = relay._on_connected
        orig_on_disconnected = relay._on_disconnected
        orig_on_joined = relay._on_joined
        
        # Wrap with UI updates
        def on_connected():
            if orig_on_connected:
                orig_on_connected()
            self.after(0, lambda: self._running_frame.set_connected(True))
        
        def on_disconnected():
            if orig_on_disconnected:
                orig_on_disconnected()
            self.after(0, lambda: self._running_frame.set_connected(False))
        
        def on_joined(token: str, info: dict):
            if orig_on_joined:
                orig_on_joined(token, info)
            self.after(0, lambda: self._running_frame.set_token(token))
        
        relay._on_connected = on_connected
        relay._on_disconnected = on_disconnected
        relay._on_joined = on_joined

    def _start_service_thread(self, token: Optional[str] = None) -> None:
        """Start service in background thread."""
        def run():
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            
            try:
                if self._mode == "controller":
                    self._loop.run_until_complete(self._service.start())
                else:
                    self._loop.run_until_complete(self._service.start(token))
            except Exception as e:
                self.after(0, lambda: self._log_frame.add_log(f"Service error: {e}", "ERROR"))
            finally:
                self._loop.close()
        
        self._service_thread = threading.Thread(target=run, daemon=True)
        self._service_thread.start()
        
        # Start process count updater for controller
        if self._mode == "controller":
            self._update_process_count()

    def _update_process_count(self) -> None:
        """Periodically update process count."""
        if self._mode == "controller" and self._running_frame:
            count = get_league_process_count()
            self._running_frame.set_process_count(count)
            self.after(2000, self._update_process_count)

    def _stop_service(self) -> None:
        """Stop service and return to mode selection."""
        if self._service and self._loop:
            asyncio.run_coroutine_threadsafe(self._service.stop(), self._loop)
        
        if self._running_frame:
            self._running_frame.grid_forget()
            self._running_frame = None
        
        self._mode_frame.grid(row=1, column=0, padx=15, pady=5, sticky="ew")
        self._mode = None
        self._service = None

    def on_closing(self) -> None:
        """Handle window close."""
        if self._service and self._loop:
            asyncio.run_coroutine_threadsafe(self._service.stop(), self._loop)
        self.destroy()


def run_gui() -> None:
    """Run the GUI application."""
    app = LeagueMonitorApp()
    app.protocol("WM_DELETE_WINDOW", app.on_closing)
    app.mainloop()
