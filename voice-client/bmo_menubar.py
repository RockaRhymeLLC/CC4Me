#!/usr/bin/env python3
"""
BMO Voice — macOS Menu Bar App

Runs bmo_voice.py as a subprocess and shows status in the menu bar.
The voice client gets its own process (and its own main thread) so
audio/CoreAudio/TSM operations never conflict with AppKit's
main-thread requirement.

Usage:
    python bmo_menubar.py              # Run directly
    open "BMO Voice.app"               # Run as .app bundle
"""

import logging
import os
import signal
import subprocess
import sys
import threading

import rumps

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
# State → display mapping (string keys match bmo_voice.py State.value)
# ---------------------------------------------------------------------------

STATE_DISPLAY = {
    "idle":       {"title": "BMO",    "tooltip": "BMO Voice — Listening for wake word"},
    "listening":  {"title": "BMO 👂", "tooltip": "BMO Voice — Recording..."},
    "processing": {"title": "BMO 💭", "tooltip": "BMO Voice — Processing..."},
    "speaking":   {"title": "BMO 🔊", "tooltip": "BMO Voice — Speaking..."},
}

# ---------------------------------------------------------------------------
# Menu bar app
# ---------------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


class BMOVoiceApp(rumps.App):
    """macOS menu bar wrapper — manages bmo_voice.py as a subprocess."""

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

        # Subprocess state
        self._process = None
        self._reader_thread = None
        self._running = False

        # Pending UI updates from background threads.
        # Background threads set these; a main-thread timer applies them.
        # This avoids crashes from AppKit/TSM calls off the main thread.
        self._pending_title = None
        self._pending_status = None
        self._pending_start_stop = None

        # Poll for UI updates on the main thread (rumps timers use NSTimer)
        self._ui_timer = rumps.Timer(self._apply_pending_ui, 0.25)
        self._ui_timer.start()

        # Auto-start after app launches (1 second delay for UI to settle)
        self._startup_timer = rumps.Timer(self._delayed_start, 1)
        self._startup_timer.start()

    def _start_client(self):
        """Start the voice client as a subprocess."""
        if self._running:
            return

        try:
            python = os.path.join(SCRIPT_DIR, ".venv", "bin", "python3")
            script = os.path.join(SCRIPT_DIR, "bmo_voice.py")

            if not os.path.exists(python):
                raise FileNotFoundError(f"No venv at {python}")
            if not os.path.exists(script):
                raise FileNotFoundError(f"No script at {script}")

            # Open log file for subprocess stderr (voice client logs)
            log_fh = open(LOG_FILE, "a")

            self._process = subprocess.Popen(
                [python, script, "--state-output"],
                stdout=subprocess.PIPE,
                stderr=log_fh,
                cwd=SCRIPT_DIR,
                # Don't forward signals — we handle stop ourselves
                preexec_fn=os.setpgrp,
            )
            self._running = True

            # Read state from subprocess stdout in a background thread
            self._reader_thread = threading.Thread(
                target=self._read_state, daemon=True
            )
            self._reader_thread.start()

            self.start_stop.title = "Stop"
            self.status_item.title = "Status: Running"
            self.title = "BMO"
            log.info("Voice client started (pid=%d)", self._process.pid)

        except Exception as e:
            log.error("Failed to start voice client: %s", e, exc_info=True)
            self.status_item.title = f"Status: Error — {e}"
            self.title = "BMO ⚠️"

    def _read_state(self):
        """Read state lines from subprocess stdout (background thread)."""
        try:
            proc = self._process
            if proc is None or proc.stdout is None:
                return

            for raw_line in proc.stdout:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if line.startswith("STATE:"):
                    state = line[6:]
                    display = STATE_DISPLAY.get(state, STATE_DISPLAY["idle"])
                    self._pending_title = display["title"]

            # stdout closed — process exited
            exit_code = proc.wait()
            log.info("Voice client exited (code=%d)", exit_code)

            if self._running:
                self._running = False
                self._pending_status = f"Status: Stopped (exit {exit_code})"
                self._pending_start_stop = "Start"
                if exit_code != 0:
                    self._pending_title = "BMO ⚠️"
                else:
                    self._pending_title = "BMO ⏸"

        except Exception as e:
            log.error("State reader error: %s", e, exc_info=True)

    def _stop_client(self):
        """Stop the voice client subprocess."""
        if not self._running:
            return

        self._running = False
        proc = self._process
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                log.warning("Voice client didn't stop, killing")
                proc.kill()
                proc.wait(timeout=2)
        self._process = None

        self.start_stop.title = "Start"
        self.status_item.title = "Status: Stopped"
        self.title = "BMO ⏸"
        log.info("Voice client stopped")

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
