#!/usr/bin/env python3.12
"""
TTS Worker — persistent HTTP microservice for Qwen3-TTS via MLX.

Loads the model once on startup and serves synthesis requests with low latency.
Runs on a configurable localhost port (default 3848).

Endpoints:
  POST /synthesize  — {text: str, voice?: str, language?: str} → WAV audio
  GET  /health      — {status: "ok", model: str, uptime: float}

Usage:
  python3 tts-worker.py [--port 3848] [--model mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16]
"""

import argparse
import io
import json
import struct
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# MLX imports (deferred to avoid import errors at parse time)
model_instance = None
model_name = ""
start_time = 0.0

DEFAULT_MODEL = "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16"
DEFAULT_PORT = 3848
DEFAULT_VOICE = "Aiden"
DEFAULT_LANGUAGE = "English"
SAMPLE_RATE = 24000  # Qwen3-TTS outputs at 24kHz


def mx_array_to_wav(audio_array, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Convert an mx.array of float audio to WAV bytes."""
    import numpy as np

    # Convert to numpy, ensure float32
    audio_np = np.array(audio_array, dtype=np.float32)

    # Normalize to [-1, 1] if needed
    max_val = np.abs(audio_np).max()
    if max_val > 1.0:
        audio_np = audio_np / max_val

    # Convert to 16-bit PCM
    pcm = (audio_np * 32767).astype(np.int16)

    # Build WAV file
    buf = io.BytesIO()
    num_samples = len(pcm)
    data_size = num_samples * 2  # 16-bit = 2 bytes per sample

    # RIFF header
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")

    # fmt chunk
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))       # chunk size
    buf.write(struct.pack("<H", 1))        # PCM format
    buf.write(struct.pack("<H", 1))        # mono
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", sample_rate * 2))  # byte rate
    buf.write(struct.pack("<H", 2))        # block align
    buf.write(struct.pack("<H", 16))       # bits per sample

    # data chunk
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm.tobytes())

    return buf.getvalue()


class TTSServer(HTTPServer):
    """HTTPServer that skips getfqdn() in server_bind.

    Python's HTTPServer.server_bind() calls socket.getfqdn() which does
    a DNS reverse lookup. On macOS this can block for 30+ seconds when
    DNS is slow or misconfigured. Since we only listen on localhost,
    we skip it entirely.
    """

    def server_bind(self):
        import socketserver
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = host
        self.server_port = port


class TTSHandler(BaseHTTPRequestHandler):
    """HTTP handler for TTS requests."""

    def log_message(self, format, *args):
        """Override to use stderr with timestamp."""
        sys.stderr.write(f"[tts-worker] {args[0]}\n")

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({
                "status": "ok",
                "model": model_name,
                "uptime": round(time.time() - start_time, 1),
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_error(404)

    def do_POST(self):
        if self.path == "/synthesize":
            self._handle_synthesize()
            return

        self.send_error(404)

    def _handle_synthesize(self):
        global model_instance

        # Read body
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self._json_error(400, "Empty request body")
            return

        raw = self.rfile.read(content_length)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            self._json_error(400, "Invalid JSON")
            return

        text = data.get("text", "").strip()
        if not text:
            self._json_error(400, "'text' is required and must be non-empty")
            return

        voice = data.get("voice", DEFAULT_VOICE)
        language = data.get("language", DEFAULT_LANGUAGE)
        instruct = data.get("instruct", "")

        try:
            t0 = time.time()
            results = list(model_instance.generate_custom_voice(
                text=text,
                speaker=voice,
                language=language,
                instruct=instruct or f"A clear, friendly voice.",
            ))
            t1 = time.time()

            if not results or results[0].audio is None:
                self._json_error(500, "Model returned no audio")
                return

            wav_bytes = mx_array_to_wav(results[0].audio)
            elapsed = round((t1 - t0) * 1000)
            sys.stderr.write(
                f"[tts-worker] synthesized {len(text)} chars in {elapsed}ms "
                f"({len(wav_bytes)} bytes)\n"
            )

            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav_bytes)))
            self.send_header("X-Synthesis-Time-Ms", str(elapsed))
            self.end_headers()
            self.wfile.write(wav_bytes)

        except Exception as e:
            sys.stderr.write(f"[tts-worker] synthesis error: {e}\n")
            self._json_error(500, f"Synthesis failed: {str(e)}")

    def _json_error(self, code: int, message: str):
        body = json.dumps({"error": message}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    global model_instance, model_name, start_time

    parser = argparse.ArgumentParser(description="TTS Worker — persistent Qwen3-TTS server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to listen on")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="HuggingFace model ID")
    args = parser.parse_args()

    model_name = args.model
    start_time = time.time()

    sys.stderr.write(f"[tts-worker] loading model: {model_name}\n")
    sys.stderr.flush()

    from mlx_audio.tts.utils import load_model
    model_instance = load_model(model_name)

    load_time = round(time.time() - start_time, 1)
    sys.stderr.write(f"[tts-worker] model loaded in {load_time}s\n")
    sys.stderr.write(f"[tts-worker] listening on 127.0.0.1:{args.port}\n")
    sys.stderr.flush()

    # Signal readiness via stdout (daemon watches for this)
    print(f"READY port={args.port}", flush=True)

    server = TTSServer(("127.0.0.1", args.port), TTSHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("[tts-worker] shutting down\n")
        server.shutdown()


if __name__ == "__main__":
    main()
