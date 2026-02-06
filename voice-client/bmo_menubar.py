#!/usr/bin/env python3
"""
BMO Voice — macOS Menu Bar App

Wraps bmo_voice.py in a rumps menu bar app. No terminal window needed.
Lives in the menu bar with status icon, auto-starts on login via Login Items.

Usage:
    python bmo_menubar.py              # Run directly
    python setup.py py2app             # Build as .app bundle
"""

import logging
import os
import sys
import threading

import rumps

from bmo_voice import BMOVoiceClient, State, load_config

# ---------------------------------------------------------------------------
# Logging — write to file instead of terminal (no terminal in .app mode)
# ---------------------------------------------------------------------------

LOG_DIR = os.path.expanduser("~/Library/Logs")
LOG_FILE = os.path.join(LOG_DIR, "BMOVoice.log")
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="[bmo-voice] %(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.FileHandler(LOG_FILE),
    ],
)
log = logging.getLogger("bmo-menubar")

# ---------------------------------------------------------------------------
# State → display mapping
# ---------------------------------------------------------------------------

STATE_DISPLAY = {
    State.IDLE:       {"title": "BMO",  "tooltip": "BMO Voice — Listening for wake word"},
    State.LISTENING:  {"title": "BMO 👂", "tooltip": "BMO Voice — Recording..."},
    State.PROCESSING: {"title": "BMO 💭", "tooltip": "BMO Voice — Processing..."},
    State.SPEAKING:   {"title": "BMO 🔊", "tooltip": "BMO Voice — Speaking..."},
}

# ---------------------------------------------------------------------------
# Menu bar app
# ---------------------------------------------------------------------------

class BMOVoiceApp(rumps.App):
    """macOS menu bar wrapper for BMO Voice Client."""

    def __init__(self):
        super().__init__(
            name="BMO Voice",
            title="BMO",
            quit_button=None,  # We'll add our own with cleanup
        )

        # Menu items
        self.status_item = rumps.MenuItem("Status: Starting...", callback=None)
        self.status_item.set_callback(None)
        self.start_stop = rumps.MenuItem("Stop", callback=self.toggle)
        self.menu = [
            self.status_item,
            None,  # separator
            self.start_stop,
            None,  # separator
            rumps.MenuItem("View Log", callback=self.open_log),
            None,  # separator
            rumps.MenuItem("Quit BMO Voice", callback=self.quit_app),
        ]

        # Voice client
        self._client = None
        self._client_thread = None
        self._running = False

        # Pending UI updates from background threads.
        # Background threads set these; a main-thread timer applies them.
        # This avoids crashes from AppKit/TSM calls off the main thread.
        self._pending_title = None
        self._pending_status = None
        self._pending_start_stop = None

        # Poll for UI updates on the main thread (rumps timers use NSTimer)
        self._ui_timer = rumps.Timer(self._apply_pending_ui, 0.15)
        self._ui_timer.start()

        # Auto-start after app launches (1 second delay for UI to settle)
        self._startup_timer = rumps.Timer(self._delayed_start, 1)
        self._startup_timer.start()

    def _start_client(self):
        """Start the voice client in a background thread."""
        if self._running:
            return

        try:
            # Pre-initialize Core Audio on the main thread.
            # Opening an audio stream triggers macOS HAL device queries,
            # which call TSMGetInputSourceProperty — a main-thread-only API.
            # If the first stream opens on a background thread, macOS crashes
            # with dispatch_assert_queue_fail. Pre-opening here forces the
            # HAL to cache device info so background threads don't hit TSM.
            import sounddevice as _sd
            try:
                with _sd.InputStream(samplerate=16000, channels=1,
                                     dtype="int16", blocksize=1280):
                    pass
                log.info("Audio pre-initialized on main thread")
            except Exception as e:
                log.warning("Audio pre-init failed: %s", e)

            # Find config relative to this script (or the .app bundle)
            config_path = os.path.join(os.path.dirname(__file__), "config.yaml")
            if not os.path.exists(config_path):
                # In .app bundle, check Resources
                config_path = os.path.join(
                    os.path.dirname(sys.executable), "..", "Resources", "config.yaml"
                )

            config = load_config(config_path)
            self._client = BMOVoiceClient(config)
            self._client.on_state_change = self._on_state_change
            self._running = True

            self._client_thread = threading.Thread(
                target=self._run_client, daemon=True
            )
            self._client_thread.start()

            self.start_stop.title = "Stop"
            self.status_item.title = "Status: Running"
            self.title = "BMO"
            log.info("Voice client started")

        except Exception as e:
            log.error("Failed to start voice client: %s", e, exc_info=True)
            rumps.notification(
                title="BMO Voice",
                subtitle="Error",
                message=f"Failed to start: {e}",
            )
            self.status_item.title = f"Status: Error — {e}"
            self.title = "BMO ⚠️"

    def _run_client(self):
        """Run the voice client (blocks until stopped)."""
        try:
            self._client.start()
        except Exception as e:
            log.error("Voice client crashed: %s", e, exc_info=True)
            self._running = False
            # Schedule UI updates for the main thread
            self._pending_status = "Status: Stopped (error)"
            self._pending_start_stop = "Start"
            self._pending_title = "BMO ⚠️"

    def _stop_client(self):
        """Stop the voice client."""
        if not self._running:
            return

        self._running = False
        if self._client:
            self._client.stop()
            self._client = None

        self.start_stop.title = "Start"
        self.status_item.title = "Status: Stopped"
        self.title = "BMO ⏸"
        log.info("Voice client stopped")

    def _on_state_change(self, new_state: State):
        """Called by voice client when state changes (from background thread).
        Don't touch AppKit here — schedule for main thread via _pending_title."""
        display = STATE_DISPLAY.get(new_state, STATE_DISPLAY[State.IDLE])
        self._pending_title = display["title"]

    def _apply_pending_ui(self, _timer):
        """Apply pending UI updates on the main thread (called by NSTimer)."""
        if self._pending_title is not None:
            self.title = self._pending_title
            self._pending_title = None
        if self._pending_status is not None:
            self.status_item.title = self._pending_status
            self._pending_status = None
        if self._pending_start_stop is not None:
            self.start_stop.title = self._pending_start_stop
            self._pending_start_stop = None

    # -- Menu callbacks -------------------------------------------------------

    def toggle(self, _):
        """Start or stop the voice client."""
        if self._running:
            self._stop_client()
        else:
            self._start_client()

    def open_log(self, _):
        """Open the log file in Console.app."""
        os.system(f'open "{LOG_FILE}"')

    def quit_app(self, _):
        """Clean shutdown."""
        log.info("Quitting BMO Voice")
        self._stop_client()
        rumps.quit_application()

    # -- App lifecycle --------------------------------------------------------

    def _delayed_start(self, timer):
        """Auto-start the voice client after a brief delay."""
        timer.stop()
        self._start_client()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    BMOVoiceApp().run()
