# Voice Integration Guide

Talk to your CC4Me assistant using your voice. The voice system runs as a client-server pair: a **voice client** on the machine with mic and speakers (e.g., your laptop) and the **daemon voice server** on the CC4Me machine.

## Architecture

```
Your Laptop                              CC4Me Machine
+-------------------+                   +----------------------------+
| voice_client.py   |   HTTP POST       | daemon (port 3847)         |
|                   | ----------------> |   /voice/transcribe        |
| - Wake word or    |   WAV audio       |   - STT (whisper-cli)      |
|   push-to-talk    |                   |   - Inject into Claude     |
| - Record speech   |   Audio/JSON      |   - TTS (mlx-audio)        |
| - Play response   | <---------------- |   - Return audio or JSON   |
+-------------------+                   +----------------------------+
```

**Voice channel**: Full speech-in/speech-out loop (STT -> Claude -> TTS -> audio response).
**Telegram channel**: Voice input is transcribed and injected into Claude; response routes to Telegram with a typing indicator.

## Prerequisites

### On the CC4Me machine (daemon)

| Tool | Purpose | Install |
|------|---------|---------|
| whisper-cli | Speech-to-text | `brew install whisper-cpp` |
| Python 3.12+ | TTS worker | `brew install python@3.12` |
| mlx-audio | Text-to-speech | See TTS setup below |

### On the voice client machine (laptop)

| Tool | Purpose | Install |
|------|---------|---------|
| Python 3.10+ | Voice client | `brew install python@3.12` |
| PortAudio | Audio I/O | `brew install portaudio` |

## Setup

### 1. Daemon (CC4Me machine)

#### Download a Whisper model

```bash
mkdir -p models
# Small English model (recommended — good accuracy, fast)
curl -L -o models/ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
```

Other model options: `ggml-tiny.en.bin` (fastest, less accurate), `ggml-medium.en.bin` (most accurate, slower).

#### Set up TTS

```bash
cd daemon/src/voice

# Create a Python venv for TTS
python3.12 -m venv .venv
source .venv/bin/activate
pip install mlx-audio flask

# Test TTS worker
python3 tts-worker.py
# Should print "READY" when the model is loaded
```

The TTS worker runs as a persistent HTTP microservice on port 3848. It loads the model once and handles synthesis requests.

#### Enable voice in config

Edit `cc4me.config.yaml`:

```yaml
channels:
  voice:
    enabled: true
    stt:
      model_path: "models/ggml-small.en.bin"
    tts:
      port: 3848
      speaker: "Aiden"        # Try: Aiden, Ryan, Dylan, Eric
      instruct_prompt: "A clear, friendly voice."
```

Restart the daemon after changing config.

### 2. Voice Client (laptop)

```bash
# Copy voice-client directory to the laptop
# (via git clone, scp, network share, etc.)

cd voice-client

# Run install script (creates venv, installs dependencies)
chmod +x install.sh
./install.sh

# Edit config — set daemon host to your CC4Me machine's IP
vim config.yaml
# Change daemon.host to your CC4Me machine's IP address
```

#### Configure wake word

The voice client uses [openWakeWord](https://github.com/dscripka/openWakeWord) for always-on wake word detection. Pre-trained models include:

- `hey_jarvis` — "Hey Jarvis"
- `alexa` — "Alexa"
- `hey_mycroft` — "Hey Mycroft"

Set in `config.yaml`:

```yaml
wake_word:
  model: "hey_jarvis"    # Pre-trained model name or path to custom .onnx
  threshold: 0.5         # Lower = more sensitive, higher = fewer false positives
```

You can also train a custom wake word using [openWakeWord's training notebook](https://github.com/dscripka/openWakeWord#training-new-models).

#### Configure push-to-talk

Push-to-talk lets you speak without saying the wake word — just hold a key:

```yaml
push_to_talk:
  enabled: true
  key: "right_cmd"       # Options: right_cmd, left_cmd, right_alt, right_ctrl, f18, f19, f20
```

Requires `pynput` (included in requirements.txt). On macOS, you may need to grant Accessibility permissions to Terminal or your Python interpreter in System Settings > Privacy & Security > Accessibility.

#### Run the voice client

```bash
# Activate venv and run
source .venv/bin/activate
python3 voice_client.py
```

#### Auto-start with launchd (optional)

```bash
# Edit the plist template — update paths
vim com.cc4me.voice-client.plist

# Install
cp com.cc4me.voice-client.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.cc4me.voice-client.plist
```

## Configuration Reference

### Daemon config (`cc4me.config.yaml`)

| Key | Default | Description |
|-----|---------|-------------|
| `channels.voice.enabled` | `false` | Enable/disable voice endpoints |
| `channels.voice.stt.model_path` | `models/ggml-small.en.bin` | Path to Whisper model |
| `channels.voice.tts.port` | `3848` | TTS worker HTTP port |
| `channels.voice.tts.speaker` | `Aiden` | mlx-audio voice name |
| `channels.voice.tts.instruct_prompt` | `A clear, friendly voice.` | TTS style instruction |

### Voice client config (`voice-client/config.yaml`)

| Key | Default | Description |
|-----|---------|-------------|
| `daemon.host` | `localhost` | CC4Me machine IP/hostname |
| `daemon.port` | `3847` | Daemon HTTP port |
| `wake_word.model` | `hey_jarvis` | Wake word model name or path |
| `wake_word.threshold` | `0.5` | Detection sensitivity (0.0-1.0) |
| `audio.silence_threshold` | `500` | Energy level for silence detection |
| `audio.silence_duration` | `1.0` | Seconds of silence to stop recording |
| `audio.max_recording` | `30.0` | Max recording duration |
| `conversation.follow_up_duration` | `10.0` | Seconds to listen for follow-up after response |
| `push_to_talk.enabled` | `true` | Enable push-to-talk |
| `push_to_talk.key` | `right_cmd` | Key to hold for PTT |
| `playback.volume` | `1.0` | Output volume (0.0-1.0) |
| `heartbeat.interval` | `30` | Seconds between daemon heartbeats |

## API Endpoints

The daemon exposes these voice endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/voice/transcribe` | POST | Send WAV audio, get back TTS audio or JSON |
| `/voice/synthesize` | POST | Text-to-speech (JSON body: `{text, speaker?, instruct?}`) |
| `/voice/speak` | POST | Send a notification to a registered voice client |
| `/voice/clients` | GET | List registered voice clients |

## How It Works

### Wake word flow

1. Voice client listens continuously with openWakeWord (~1% CPU)
2. Wake word detected -> play "listening" chime
3. Record speech until silence detected
4. POST WAV audio to daemon `/voice/transcribe`
5. Daemon runs STT (whisper-cli) -> transcribed text
6. **If channel is `voice`**: Inject text into Claude, wait for response, run TTS, return audio
7. **If channel is `telegram`**: Start typing indicator, inject text into Claude, return JSON (response comes via Telegram)
8. Voice client plays audio response (voice channel) or "sent" sound (telegram channel)
9. Listen for follow-up speech (conversation mode)

### Push-to-talk flow

1. User holds configured key (e.g., right Command)
2. Play "listening" chime, start recording
3. User releases key -> recording stops immediately
4. Play "sent" confirmation sound
5. Same daemon flow as wake word (steps 4-9 above)

## Troubleshooting

### Voice client can't reach daemon
- Check daemon is running: `curl http://<daemon-ip>:3847/health`
- Verify `daemon.host` in `config.yaml` matches the CC4Me machine's IP
- Ensure both machines are on the same network
- Check firewall isn't blocking port 3847

### STT returns empty or garbage
- Check Whisper model exists: `ls models/ggml-small.en.bin`
- Try a larger model (`ggml-medium.en.bin`) for better accuracy
- Check `whisper-cli` is installed: `which whisper-cli`
- Ensure audio is recording correctly (check `silence_threshold` — lower if needed)

### TTS worker won't start
- Ensure Python 3.12+ with mlx-audio: `python3 -c "import mlx_audio"`
- Check port 3848 isn't in use: `lsof -i :3848`
- On first run, the model downloads (~1GB) — be patient
- Check venv is activated: `source daemon/src/voice/.venv/bin/activate`

### Push-to-talk not working
- Install pynput: `pip install pynput`
- Grant Accessibility permissions: System Settings > Privacy & Security > Accessibility
- Add Terminal (or iTerm, or Python) to the list

### Wake word not detecting
- Lower the threshold in `config.yaml` (e.g., 0.3 instead of 0.5)
- Speak clearly and at normal volume
- Check mic permissions: System Settings > Privacy & Security > Microphone
- Try a pre-trained model first (`hey_jarvis`) before custom models

### Audio playback issues
- Check output device: `python3 -c "import sounddevice; print(sounddevice.query_devices())"`
- Adjust `playback.volume` in config
- Ensure PortAudio is installed: `brew install portaudio`
