#!/usr/bin/env python3
"""
BMO Voice Client — runs on the laptop, listens for "Hey BMO",
captures speech, sends to Mac Mini daemon, plays audio response.

Architecture:
  - openWakeWord listens continuously for wake word (~1% CPU)
  - On detection: play feedback sound, record until silence
  - POST audio to daemon /voice/transcribe
  - Play returned TTS audio through speakers
  - Heartbeat keeps registration alive with daemon
"""

import io
import json
import logging
import os
import signal
import struct
import sys
import threading
import time
import wave
from enum import Enum
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote

import numpy as np
import requests
import sounddevice as sd
import yaml

logging.basicConfig(
    level=logging.INFO,
    format="[bmo-voice] %(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("bmo-voice")

# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------

class State(Enum):
    IDLE = "idle"               # Listening for wake word only
    LISTENING = "listening"     # Recording user speech
    PROCESSING = "processing"   # Waiting for daemon response
    SPEAKING = "speaking"       # Playing TTS audio

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def load_config(path: str = None) -> dict:
    """Load config from YAML file."""
    if path is None:
        path = os.path.join(os.path.dirname(__file__), "config.yaml")
    with open(path) as f:
        return yaml.safe_load(f)

# ---------------------------------------------------------------------------
# Audio feedback sounds
# ---------------------------------------------------------------------------

def generate_tone(freq: float, duration: float, sample_rate: int = 24000,
                  volume: float = 0.3) -> np.ndarray:
    """Generate a simple sine wave tone."""
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
    # Apply fade in/out to avoid clicks
    tone = np.sin(2 * np.pi * freq * t) * volume
    fade_len = min(int(sample_rate * 0.01), len(tone) // 4)
    if fade_len > 0:
        tone[:fade_len] *= np.linspace(0, 1, fade_len)
        tone[-fade_len:] *= np.linspace(1, 0, fade_len)
    return tone.astype(np.float32)


def play_listening_sound(volume: float = 1.0):
    """Play a short 'listening' chime — two ascending tones."""
    sr = 24000
    t1 = generate_tone(880, 0.08, sr, 0.25 * volume)
    gap = np.zeros(int(sr * 0.03), dtype=np.float32)
    t2 = generate_tone(1320, 0.10, sr, 0.25 * volume)
    audio = np.concatenate([t1, gap, t2])
    sd.play(audio, sr)
    sd.wait()


def play_error_sound(volume: float = 1.0):
    """Play a low error buzz."""
    sr = 24000
    tone = generate_tone(220, 0.2, sr, 0.2 * volume)
    sd.play(tone, sr)
    sd.wait()


def play_chime_sound(volume: float = 1.0):
    """Play a distinctive notification chime — three-note arpeggio."""
    sr = 24000
    t1 = generate_tone(660, 0.10, sr, 0.2 * volume)
    gap = np.zeros(int(sr * 0.04), dtype=np.float32)
    t2 = generate_tone(880, 0.10, sr, 0.2 * volume)
    t3 = generate_tone(1100, 0.15, sr, 0.25 * volume)
    audio = np.concatenate([t1, gap, t2, gap, t3])
    sd.play(audio, sr)
    sd.wait()

# ---------------------------------------------------------------------------
# Confirmation/rejection phrase detection
# ---------------------------------------------------------------------------

CONFIRMATION_PHRASES = {
    "yeah", "yes", "what's up", "go ahead", "what", "hey",
    "yep", "sure", "okay", "ok", "go", "tell me", "shoot",
}
REJECTION_PHRASES = {
    "not now", "later", "no", "busy", "stop", "ignore",
    "never mind", "nevermind",
}


def classify_response(text: str) -> str:
    """Classify transcribed text as confirmed, rejected, or unknown."""
    lower = text.lower().strip()
    if not lower:
        return "timeout"
    for phrase in REJECTION_PHRASES:
        if phrase in lower:
            return "rejected"
    for phrase in CONFIRMATION_PHRASES:
        if phrase in lower:
            return "confirmed"
    # If we got speech but can't classify, treat as confirmation
    # (Dave said something, probably wants to hear it)
    return "confirmed"

# ---------------------------------------------------------------------------
# Callback server — handles daemon-initiated requests (chime, play)
# ---------------------------------------------------------------------------

class CallbackHandler(BaseHTTPRequestHandler):
    """HTTP handler for daemon→client callbacks."""

    # Reference to the voice client instance (set by CallbackServer)
    voice_client: "BMOVoiceClient" = None  # type: ignore

    def log_message(self, format, *args):
        log.debug("[callback] %s", args[0] if args else format)

    def do_POST(self):
        if self.path == "/chime":
            self._handle_chime()
        elif self.path == "/play":
            self._handle_play()
        else:
            self.send_error(404)

    def _handle_chime(self):
        """Handle a chime request from the daemon."""
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""

        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self._json_response(400, {"status": "error", "error": "Invalid JSON"})
            return

        text = data.get("text", "")
        notif_type = data.get("type", "notification")
        log.info("Chime request: type=%s, text=%s", notif_type, text[:80])

        client = self.voice_client
        if client is None or client.state != State.IDLE:
            log.info("Client busy (state=%s), rejecting chime",
                     client.state.value if client else "none")
            self._json_response(200, {"status": "rejected", "error": "Client busy"})
            return

        # Play chime
        play_chime_sound(client.volume)

        # Listen for confirmation (5 seconds)
        result = client._listen_for_confirmation(duration=5.0)
        log.info("Chime result: %s", result)

        self._json_response(200, {"status": result})

    def _handle_play(self):
        """Handle an audio push from the daemon — play through speakers."""
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self._json_response(400, {"error": "No audio data"})
            return

        audio_data = self.rfile.read(content_length)
        log.info("Received %d bytes of audio to play", len(audio_data))

        client = self.voice_client
        if client:
            client.state = State.SPEAKING
            try:
                client._play_audio(audio_data)
            finally:
                client.state = State.IDLE

        self._json_response(200, {"ok": True})

    def _json_response(self, code: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class CallbackServer:
    """Background HTTP server for daemon→client callbacks."""

    def __init__(self, port: int, voice_client: "BMOVoiceClient"):
        self.port = port
        CallbackHandler.voice_client = voice_client
        self._server = HTTPServer(("0.0.0.0", port), CallbackHandler)
        self._thread: threading.Thread | None = None

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        log.info("Callback server started on port %d", self.port)

    def _run(self):
        self._server.serve_forever()

    def stop(self):
        self._server.shutdown()
        log.info("Callback server stopped")

# ---------------------------------------------------------------------------
# Voice client
# ---------------------------------------------------------------------------

class BMOVoiceClient:
    """Main voice client — state machine driving audio pipeline."""

    def __init__(self, config: dict):
        self.config = config
        self.state = State.IDLE
        self._lock = threading.Lock()
        self._running = False
        self._heartbeat_thread: threading.Thread | None = None
        self._oww_model = None

        # Daemon connection
        daemon = config["daemon"]
        self.daemon_url = f"http://{daemon['host']}:{daemon['port']}"
        self.client_id = config["client"]["id"]
        self.callback_port = config["client"]["callback_port"]

        # Audio settings
        audio = config["audio"]
        self.sample_rate = audio["sample_rate"]
        self.channels = audio["channels"]
        self.frame_size = audio["frame_size"]
        self.silence_threshold = audio["silence_threshold"]
        self.silence_duration = audio["silence_duration"]
        self.max_recording = audio["max_recording"]

        # Wake word
        ww = config["wake_word"]
        self.ww_model_name = ww["model"]
        self.ww_threshold = ww["threshold"]
        self.ww_framework = ww["inference_framework"]

        # Playback
        self.volume = config["playback"]["volume"]

        # Conversation mode
        conv = config.get("conversation", {})
        self.follow_up_duration = conv.get("follow_up_duration", 3.0)
        self.enable_stop_interrupt = conv.get("enable_stop_interrupt", True)

        # Interrupt flag (set by interrupt detector during playback)
        self._interrupted = False

        # Heartbeat
        self.heartbeat_interval = config["heartbeat"]["interval"]

    # -- Lifecycle -----------------------------------------------------------

    def start(self):
        """Initialize and start the voice client."""
        log.info("Starting BMO voice client")
        self._running = True

        # Load wake word model
        self._load_wake_word_model()

        # Start callback server (for daemon-initiated chimes)
        self._callback_server = CallbackServer(self.callback_port, self)
        self._callback_server.start()

        # Register with daemon
        self._register()

        # Start heartbeat
        self._heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop, daemon=True
        )
        self._heartbeat_thread.start()

        # Enter main listening loop
        self._listen_loop()

    def stop(self):
        """Shut down the voice client."""
        log.info("Stopping BMO voice client")
        self._running = False
        if hasattr(self, '_callback_server'):
            self._callback_server.stop()
        self._unregister()

    # -- Wake word model -----------------------------------------------------

    def _load_wake_word_model(self):
        """Load the openWakeWord model."""
        from openwakeword.model import Model as OWWModel
        import openwakeword

        model_path = self.ww_model_name

        # If it's a file path, use it directly
        if os.path.isfile(model_path):
            log.info("Loading custom wake word model: %s", model_path)
            self._oww_model = OWWModel(
                wakeword_models=[model_path],
                inference_framework=self.ww_framework,
            )
        else:
            # Use pre-trained model by name
            log.info("Downloading pre-trained models (if needed)")
            openwakeword.utils.download_models()
            log.info("Loading pre-trained wake word model: %s", model_path)
            self._oww_model = OWWModel(
                wakeword_models=[model_path],
                inference_framework=self.ww_framework,
            )

        log.info("Wake word model loaded")

    # -- Daemon communication ------------------------------------------------

    def _register(self):
        """Register with the daemon."""
        url = f"{self.daemon_url}/voice/register"
        # Determine callback URL — use our local IP as seen from the Mac Mini
        callback_url = f"http://{self._get_local_ip()}:{self.callback_port}"
        body = {"clientId": self.client_id, "callbackUrl": callback_url}
        try:
            r = requests.post(url, json=body, timeout=5)
            if r.status_code == 200:
                log.info("Registered with daemon at %s", self.daemon_url)
            else:
                log.warning("Registration failed: %s %s", r.status_code, r.text)
        except requests.RequestException as e:
            log.warning("Cannot reach daemon: %s", e)

    def _unregister(self):
        """Unregister from the daemon."""
        url = f"{self.daemon_url}/voice/unregister"
        try:
            requests.post(url, json={"clientId": self.client_id}, timeout=5)
            log.info("Unregistered from daemon")
        except requests.RequestException:
            pass

    def _heartbeat_loop(self):
        """Send heartbeats to keep registration alive."""
        while self._running:
            time.sleep(self.heartbeat_interval)
            if not self._running:
                break
            self._register()  # Re-register acts as heartbeat

    def _get_local_ip(self) -> str:
        """Get this machine's LAN IP."""
        import socket
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"

    # -- Main listening loop -------------------------------------------------

    def _listen_loop(self):
        """Main loop: listen for wake word, record, send, play response."""
        log.info("Listening for wake word '%s' (threshold=%.2f)",
                 self.ww_model_name, self.ww_threshold)

        try:
            with sd.InputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype="int16",
                blocksize=self.frame_size,
            ) as stream:
                while self._running:
                    # Read one frame
                    audio_frame, overflowed = stream.read(self.frame_size)
                    if overflowed:
                        continue

                    # Only check wake word when idle
                    if self.state != State.IDLE:
                        continue

                    # Run wake word detection
                    frame_data = audio_frame[:, 0]  # mono
                    prediction = self._oww_model.predict(frame_data)

                    for model_name, score in prediction.items():
                        if score > self.ww_threshold:
                            log.info("Wake word detected! (%s: %.3f)",
                                     model_name, score)
                            self._handle_wake()
                            # Reset model scores after detection
                            self._oww_model.reset()
                            break

        except KeyboardInterrupt:
            log.info("Interrupted")
        except Exception as e:
            log.error("Listen loop error: %s", e, exc_info=True)
        finally:
            self.stop()

    # -- Voice interaction flow ----------------------------------------------

    def _handle_wake(self):
        """Handle a wake word detection — record, send, play, then
        enter conversation mode for follow-up questions."""
        with self._lock:
            if self.state != State.IDLE:
                return
            self.state = State.LISTENING

        try:
            self._voice_interaction_loop(initial=True)
        except Exception as e:
            log.error("Voice interaction failed: %s", e, exc_info=True)
            play_error_sound(self.volume)
        finally:
            self.state = State.IDLE

    def _voice_interaction_loop(self, initial: bool = True):
        """Core voice loop — handles initial query and follow-up conversation.

        After each response, listens briefly for follow-up questions.
        If Dave speaks within follow_up_duration, processes as new query
        without requiring the wake word again.
        """
        if initial:
            play_listening_sound(self.volume)

        # Record utterance
        self.state = State.LISTENING
        audio_data = self._record_utterance()
        if audio_data is None or len(audio_data) == 0:
            log.info("No speech detected")
            return

        # Send to daemon
        self.state = State.PROCESSING
        response_audio = self._send_to_daemon(audio_data)
        if response_audio is None:
            play_error_sound(self.volume)
            return

        # Play response (with optional stop interrupt detection)
        self.state = State.SPEAKING
        self._play_audio_with_interrupt(response_audio)

        if self._interrupted:
            log.info("Playback was interrupted")
            self._interrupted = False
            return

        # Enter follow-up listening window (conversation mode)
        if self.follow_up_duration > 0:
            log.info("Listening for follow-up (%.1fs)...", self.follow_up_duration)
            follow_up_audio = self._listen_for_follow_up()
            if follow_up_audio is not None:
                log.info("Follow-up detected, continuing conversation")
                # Recursively handle the follow-up (no wake word needed)
                self.state = State.PROCESSING
                response_audio = self._send_to_daemon(follow_up_audio)
                if response_audio:
                    self.state = State.SPEAKING
                    self._play_audio_with_interrupt(response_audio)
                    # One level of follow-up (could recurse deeper, but
                    # keeping it simple — one follow-up per wake word)
                else:
                    play_error_sound(self.volume)

    def _record_utterance(self) -> bytes | None:
        """Record audio until silence is detected. Returns WAV bytes."""
        log.info("Recording...")
        frames: list[np.ndarray] = []
        silence_count = 0
        silence_frames_needed = int(
            self.silence_duration * self.sample_rate / self.frame_size
        )
        max_frames = int(
            self.max_recording * self.sample_rate / self.frame_size
        )
        has_speech = False

        try:
            with sd.InputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype="int16",
                blocksize=self.frame_size,
            ) as stream:
                for _ in range(max_frames):
                    if not self._running:
                        return None

                    data, overflowed = stream.read(self.frame_size)
                    frame = data[:, 0]  # mono
                    frames.append(frame.copy())

                    # Energy-based VAD
                    energy = np.abs(frame).mean()

                    if energy > self.silence_threshold:
                        has_speech = True
                        silence_count = 0
                    else:
                        silence_count += 1

                    # End recording after enough silence (but only if we got speech)
                    if has_speech and silence_count >= silence_frames_needed:
                        log.info("Silence detected, stopping recording")
                        break

        except Exception as e:
            log.error("Recording error: %s", e)
            return None

        if not has_speech:
            return None

        # Convert to WAV bytes
        all_audio = np.concatenate(frames)
        return self._pcm_to_wav(all_audio)

    def _pcm_to_wav(self, pcm: np.ndarray) -> bytes:
        """Convert int16 PCM array to WAV bytes."""
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(self.sample_rate)
            wf.writeframes(pcm.tobytes())
        return buf.getvalue()

    def _send_to_daemon(self, audio_data: bytes) -> bytes | None:
        """Send recorded audio to daemon and get TTS response."""
        url = f"{self.daemon_url}/voice/transcribe"
        log.info("Sending %d bytes to daemon...", len(audio_data))

        try:
            r = requests.post(
                url,
                data=audio_data,
                headers={"Content-Type": "application/octet-stream"},
                timeout=60,  # Claude might take a while to respond
            )

            if r.status_code == 200:
                transcription = unquote(
                    r.headers.get("X-Transcription", "")
                )
                response_text = unquote(
                    r.headers.get("X-Response-Text", "")
                )
                log.info("Transcription: %s", transcription)
                log.info("Response: %s",
                         response_text[:100] + ("..." if len(response_text) > 100 else ""))
                return r.content
            else:
                try:
                    err = r.json()
                    log.warning("Daemon error: %s", err.get("error", r.text))
                except Exception:
                    log.warning("Daemon returned %d: %s", r.status_code, r.text[:200])
                return None

        except requests.Timeout:
            log.warning("Request timed out (60s)")
            return None
        except requests.RequestException as e:
            log.warning("Request failed: %s", e)
            return None

    def _listen_for_follow_up(self) -> bytes | None:
        """Listen briefly for a follow-up utterance after playback.

        Returns WAV bytes if speech detected, None if silence.
        """
        frames: list[np.ndarray] = []
        has_speech = False
        silence_count = 0
        # Use shorter silence timeout for follow-up
        silence_needed = int(self.silence_duration * self.sample_rate / self.frame_size)
        max_frames = int(
            (self.follow_up_duration + self.max_recording) *
            self.sample_rate / self.frame_size
        )
        # Wait at most follow_up_duration for speech to start
        start_wait_frames = int(
            self.follow_up_duration * self.sample_rate / self.frame_size
        )
        waited = 0

        try:
            with sd.InputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype="int16",
                blocksize=self.frame_size,
            ) as stream:
                for i in range(max_frames):
                    if not self._running:
                        return None

                    data, _ = stream.read(self.frame_size)
                    frame = data[:, 0]

                    energy = np.abs(frame).mean()

                    if not has_speech:
                        waited += 1
                        if energy > self.silence_threshold:
                            has_speech = True
                            frames.append(frame.copy())
                            silence_count = 0
                        elif waited >= start_wait_frames:
                            # No speech within follow-up window
                            return None
                    else:
                        frames.append(frame.copy())
                        if energy > self.silence_threshold:
                            silence_count = 0
                        else:
                            silence_count += 1
                        if silence_count >= silence_needed:
                            break

        except Exception as e:
            log.error("Follow-up listen error: %s", e)
            return None

        if not has_speech or not frames:
            return None

        all_audio = np.concatenate(frames)
        return self._pcm_to_wav(all_audio)

    def _play_audio_with_interrupt(self, wav_data: bytes):
        """Play WAV audio with optional stop-interrupt detection.

        If enable_stop_interrupt is True, listens for 'stop' / 'BMO stop'
        in a background thread during playback and halts if detected.
        """
        self._interrupted = False

        if not self.enable_stop_interrupt:
            self._play_audio(wav_data)
            return

        # Start interrupt detector in background
        stop_event = threading.Event()
        detector_thread = threading.Thread(
            target=self._interrupt_detector,
            args=(stop_event,),
            daemon=True,
        )
        detector_thread.start()

        try:
            self._play_audio(wav_data)
        finally:
            stop_event.set()  # Signal detector to stop
            detector_thread.join(timeout=1.0)

    def _interrupt_detector(self, stop_event: threading.Event):
        """Background thread that listens for 'stop' command during playback.

        Monitors audio energy on a separate InputStream. If speech is detected
        during playback, stops playback immediately. Full STT classification
        would add latency; we use energy detection as the trigger and treat
        any speech during playback as an interrupt.
        """
        try:
            with sd.InputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype="int16",
                blocksize=self.frame_size,
            ) as stream:
                speech_frames = 0
                while not stop_event.is_set():
                    data, _ = stream.read(self.frame_size)
                    frame = data[:, 0]
                    energy = np.abs(frame).mean()

                    # Need sustained speech (not just a blip from the speakers)
                    if energy > self.silence_threshold * 2:
                        speech_frames += 1
                        if speech_frames >= 3:  # ~240ms of speech
                            log.info("Interrupt detected during playback")
                            self._interrupted = True
                            sd.stop()  # Stop playback
                            return
                    else:
                        speech_frames = 0

        except Exception as e:
            log.debug("Interrupt detector error: %s", e)

    def _play_audio(self, wav_data: bytes):
        """Play WAV audio through speakers."""
        try:
            buf = io.BytesIO(wav_data)
            with wave.open(buf, "rb") as wf:
                sr = wf.getframerate()
                channels = wf.getnchannels()
                sampwidth = wf.getsampwidth()
                frames = wf.readframes(wf.getnframes())

            # Convert to float32 for playback
            if sampwidth == 2:
                audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32767.0
            elif sampwidth == 4:
                audio = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483647.0
            else:
                log.warning("Unsupported sample width: %d", sampwidth)
                return

            # Apply volume
            audio *= self.volume

            # Reshape for multi-channel
            if channels > 1:
                audio = audio.reshape(-1, channels)

            log.info("Playing response audio (%.1fs)", len(audio) / sr)
            sd.play(audio, sr)
            sd.wait()
            log.info("Playback complete")

        except Exception as e:
            log.error("Playback error: %s", e, exc_info=True)

    # -- Chime confirmation --------------------------------------------------

    def _listen_for_confirmation(self, duration: float = 5.0) -> str:
        """Listen for a short voice response after a chime.

        Records for up to `duration` seconds, sends to daemon /voice/speak
        for STT-only classification, and returns 'confirmed', 'rejected',
        or 'timeout'.
        """
        log.info("Listening for confirmation (%.1fs)...", duration)
        frames: list[np.ndarray] = []
        has_speech = False
        silence_count = 0
        silence_needed = int(0.8 * self.sample_rate / self.frame_size)  # 0.8s silence ends
        max_frames = int(duration * self.sample_rate / self.frame_size)

        try:
            with sd.InputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype="int16",
                blocksize=self.frame_size,
            ) as stream:
                for _ in range(max_frames):
                    data, _ = stream.read(self.frame_size)
                    frame = data[:, 0]
                    frames.append(frame.copy())

                    energy = np.abs(frame).mean()
                    if energy > self.silence_threshold:
                        has_speech = True
                        silence_count = 0
                    else:
                        silence_count += 1

                    if has_speech and silence_count >= silence_needed:
                        break

        except Exception as e:
            log.error("Confirmation listen error: %s", e)
            return "timeout"

        if not has_speech:
            log.info("No speech during confirmation window")
            return "timeout"

        # Send audio to daemon for STT-only transcription, then classify
        all_audio = np.concatenate(frames)
        wav_bytes = self._pcm_to_wav(all_audio)

        try:
            url = f"{self.daemon_url}/voice/stt"
            r = requests.post(
                url,
                data=wav_bytes,
                headers={"Content-Type": "application/octet-stream"},
                timeout=10,
            )

            if r.status_code == 200:
                data = r.json()
                text = data.get("text", "")
                result = classify_response(text)
                log.info("Confirmation STT: '%s' → %s", text, result)
                return result
            else:
                # STT failed — fallback: speech detected = confirmed
                log.warning("STT failed (%d), defaulting to confirmed", r.status_code)
                return "confirmed"

        except Exception as e:
            log.warning("STT request failed: %s — defaulting to confirmed", e)
            return "confirmed"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    config_path = None
    if len(sys.argv) > 1:
        config_path = sys.argv[1]

    config = load_config(config_path)
    client = BMOVoiceClient(config)

    def on_signal(signum, frame):
        log.info("Received signal %d, shutting down", signum)
        client.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)

    client.start()


if __name__ == "__main__":
    main()
