# Spec: Ambient Voice Integration

**Created**: 2026-02-04
**Status**: Approved (Dave approved 2026-02-04, R2 reviewed)
**Related**: Todo #054, speech-integration-research.md

## Goal

Enable natural, hands-free voice conversations between Dave and BMO when Dave is at his desk, using a wake word ("Hey BMO") on Dave's laptop and local ML processing on the Mac Mini — with zero ongoing cost.

## Architecture Overview

```
Dave's MacBook (lightweight client)          Mac Mini M4 (all processing)
+----------------------------------+         +----------------------------------+
|                                  |         |                                  |
|  openWakeWord wake word (tiny)      |         |  Daemon (Node.js)                |
|  Mic capture (built-in mic)      |  LAN    |    POST /voice/transcribe        |
|  Speaker output (built-in)       | <-----> |    POST /voice/speak             |
|  ~100 lines Python               |  HTTP   |    POST /voice/chime             |
|  <10MB footprint                 |         |                                  |
|                                  |         |  whisper.cpp (STT, ~488MB)       |
+----------------------------------+         |  Qwen3-TTS via MLX (TTS, ~1.2GB) |
                                             |  Claude Code (tmux session)      |
                                             |                                  |
                                             +----------------------------------+
```

**Key principle**: Dave's laptop is a dumb audio terminal. All ML models, transcription, speech synthesis, and Claude interaction happen on the Mac Mini. The laptop captures audio, sends it over LAN, and plays audio responses. This keeps Dave's machine clean and makes the system easy to maintain and upgrade.

## Requirements

### Must Have

- [ ] **Wake word detection on laptop**: openWakeWord-based "Hey BMO" wake word running as a background process on Dave's MacBook. Low CPU, always-listening when active.
- [ ] **Speech capture**: On wake word trigger, record audio from laptop mic until end-of-utterance (silence detection via VAD). Output as WAV (16kHz, 16-bit, mono).
- [ ] **Audio upload to Mac Mini**: POST the captured WAV file to the daemon's `/voice/transcribe` endpoint over LAN. Expect JSON response with transcribed text + Claude's response text.
- [ ] **STT on Mac Mini**: whisper.cpp with `small.en` model (~488MB). CoreML + Metal acceleration on M4. Transcribes audio received from laptop client.
- [ ] **Tmux injection**: Transcribed text injected into Claude Code's tmux session via existing `injectText()` session bridge. Prefixed with `[Voice] Dave:` for context.
- [ ] **Response capture**: Capture Claude Code's response via existing transcript stream / hook mechanism. Route the response text to the TTS pipeline instead of (or in addition to) Telegram.
- [ ] **TTS on Mac Mini**: Qwen3-TTS via MLX framework (0.6B base model, ~1.2GB). Generate audio from Claude's response text. Output as WAV or OGG.
- [ ] **Audio response to laptop**: Return generated audio to the laptop client. Client plays through built-in speakers.
- [ ] **BMO-initiated chime**: When BMO wants to initiate a conversation (calendar reminder, email alert, todo nudge), the daemon sends a chime request to the laptop client. Client plays a distinctive notification sound.
- [ ] **Voice confirmation for BMO-initiated**: After chime, laptop client listens for a brief voice confirmation ("yeah?", "what's up?", "go ahead"). If detected, BMO speaks. If silence for ~5 seconds, fall back to Telegram text.
- [ ] **Telegram fallback**: If the laptop client is not connected (Dave is away from desk), all notifications fall back to Telegram text automatically.
- [ ] **Voice channel in config**: New `channels.voice` section in `cc4me.config.yaml` with client connection settings, model paths, and behavior options.
- [ ] **Daemon voice endpoints**: New HTTP endpoints on the daemon for voice operations (see Technical Considerations).

### Should Have

- [ ] **Conversation mode**: After BMO responds, keep listening briefly (~3-5 seconds) for a follow-up from Dave, enabling back-and-forth without repeating the wake word.
- [ ] **"BMO, stop" interrupt**: If BMO is speaking (long response), Dave can say "stop" or "BMO stop" to interrupt playback.
- [ ] **Volume control**: Configurable TTS output volume on the laptop client.
- [ ] **Voice activity indicator**: Laptop client shows a small visual indicator (menu bar icon change or notification) when BMO is listening or processing.
- [ ] **Configurable initiation events**: In config, specify which events trigger voice initiation (calendar reminders, urgent emails, todo nudges) vs. silent Telegram delivery.
- [ ] **Audio feedback sounds**: Short sounds for: wake word acknowledged ("listening"), processing started, error occurred.

### Won't Have (for now)

- [ ] **Voice on mobile/remote**: Mobile voice interaction is out of scope. Dave uses text/Siri on mobile.
- [ ] **Call detection**: No automatic detection of active calls. The chime + confirmation pattern handles this gracefully — Dave ignores the chime if he's busy.
- [ ] **Voice identification**: No speaker verification (is this Dave or someone else?). The laptop client is physically at Dave's desk, so physical access implies authorization.
- [ ] **Custom voice cloning**: Qwen3-TTS supports voice cloning, but creating a unique BMO voice identity is a future enhancement.
- [ ] **Telegram voice messages**: Receiving/sending Telegram voice messages. Dave is fine with text on mobile.
- [ ] **Multi-room audio**: Only Dave's desk setup. No distributed microphones or speakers.
- [ ] **Cloud STT/TTS fallback**: Starting fully local. Cloud options (Deepgram, OpenAI TTS) are documented in research but not implemented in v1.

## Constraints

### Security

- The laptop client connects to the daemon over LAN only. No public internet exposure for voice endpoints.
- Voice endpoints should verify requests come from the local network (IP range check or shared secret in config).
- No audio is stored persistently. Temporary WAV files are deleted after processing.
- No audio is sent to any cloud service. All processing is local.

### Performance

- **Audio pipeline latency target**: Under 2 seconds end-to-end (wake word detection through start of TTS playback), excluding Claude's thinking time.
- **Wake word detection**: Must not noticeably impact laptop battery or CPU. openWakeWord is designed for this (~1% CPU).
- **STT**: whisper.cpp small.en on M4 should transcribe 5 seconds of audio in under 600ms.
- **TTS**: Qwen3-TTS streaming on M4 should begin audio output within 300ms.
- **Network**: LAN transfer of a 5-second audio clip (~160KB at 16kHz mono) should take <50ms. Response audio (<500KB) should take <100ms.

### Compatibility

- **Mac Mini**: macOS 14+ (Sonoma or later), Apple Silicon M4, 16GB RAM, 256GB storage.
- **Laptop client**: macOS 13+ with Python 3.10+. Should work on any MacBook with Apple Silicon or Intel.
- **Dependencies (Mac Mini)**: whisper.cpp (Homebrew), Qwen3-TTS (pip + MLX), ffmpeg (Homebrew for audio conversion).
- **Dependencies (Laptop)**: Python 3.10+, openWakeWord SDK (pip), pyaudio or sounddevice (pip), requests (pip).
- **Headless operation**: Mac Mini runs headless. No display, no built-in speakers. All audio I/O happens on the laptop client.

## Success Criteria

1. Dave says "Hey BMO, what's on my calendar?" at his desk. Within ~3-7 seconds, BMO responds audibly through the laptop speakers with today's calendar.
2. BMO plays a chime through the laptop when a calendar reminder fires. Dave says "yeah?" and BMO speaks the reminder. If Dave doesn't respond, BMO sends it via Telegram instead.
3. Dave closes his laptop or disconnects from the network. BMO automatically falls back to Telegram for all notifications.
4. Dave opens his laptop and the voice client reconnects. Wake word detection resumes automatically.
5. The entire system runs with $0/month ongoing cost. All processing is local.
6. The laptop client uses minimal resources (<1% CPU idle, <50MB RAM).

## User Stories / Scenarios

### Scenario 1: Voice Query at Desk
- **Given**: Dave is at his desk, laptop open, voice client running
- **When**: Dave says "Hey BMO, what time is the SA meeting today?"
- **Then**: Wake word triggers, audio captured until Dave stops speaking, audio sent to Mac Mini, whisper.cpp transcribes, text injected into Claude Code, Claude responds, Qwen3-TTS generates audio, audio plays through laptop speakers. Dave hears: "Your SA Team Meeting is at 2 PM on Teams."

### Scenario 2: BMO Initiates — Dave Is Available
- **Given**: Dave is at his desk, voice client connected
- **When**: A calendar reminder fires (e.g., "9:00 AM — Ladew camp registration")
- **Then**: Daemon sends chime request to laptop client, laptop plays chime sound, client listens for ~5 seconds. Dave says "what's up?" — voice captured, sent to Mac Mini, confirmation detected, BMO speaks: "Hey Dave, Ladew Gardens camp registration opens at 9. Want me to look into it?"

### Scenario 3: BMO Initiates — Dave Is Busy/Away
- **Given**: Dave is on a call, or laptop client is not connected
- **When**: A calendar reminder fires
- **Then**: Daemon attempts to send chime to laptop client. If client is disconnected, immediately falls back to Telegram text. If client is connected but Dave doesn't respond to chime within 5 seconds, BMO sends a Telegram message instead.

### Scenario 4: Conversation Mode Follow-up
- **Given**: BMO just finished speaking a response
- **When**: Dave immediately asks a follow-up question without saying "Hey BMO" again
- **Then**: The client stays in listening mode for ~3-5 seconds after BMO finishes speaking. Dave's follow-up is captured and processed as a new voice query.

### Scenario 5: Laptop Disconnect/Reconnect
- **Given**: Voice client was running, Dave closes laptop or leaves the network
- **When**: Daemon tries to reach the laptop client and gets no response
- **Then**: Daemon marks voice channel as unavailable. All notifications route to Telegram. When the client reconnects (laptop reopened, network restored), it re-registers with the daemon and voice becomes available again.

### Scenario 6: Long Response Interrupt
- **Given**: BMO is speaking a long response through the laptop speakers
- **When**: Dave says "BMO, stop" or "stop"
- **Then**: The client detects the interrupt phrase, stops audio playback immediately, and signals the daemon that playback was interrupted.

## Technical Considerations

### Daemon Endpoints (New)

Following the existing pattern in `main.ts` (native `http.createServer` request handler):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /voice/transcribe` | POST | Receive audio from laptop, run STT, inject into Claude, return response + TTS audio |
| `POST /voice/chime` | POST | Trigger the laptop client to play a chime (called internally by scheduler tasks) |
| `GET /voice/status` | GET | Check if a voice client is currently connected |
| `POST /voice/register` | POST | Laptop client registers itself with the daemon on startup (sends its callback URL) |
| `POST /voice/unregister` | POST | Laptop client deregisters on shutdown |

### Daemon Module Structure

```
daemon/src/
  voice/                          # NEW module
    voice-server.ts               # HTTP endpoint handlers for voice routes
    stt.ts                        # whisper.cpp wrapper (CLI invocation)
    tts.ts                        # Qwen3-TTS wrapper (Python/MLX invocation)
    voice-client-registry.ts      # Track connected laptop clients
    audio-utils.ts                # WAV/OGG conversion, temp file management
```

### Laptop Client Structure

```
voice-client/                     # NEW — lives in repo root or separate repo
  bmo-voice.py                    # Main client script (~100-200 lines)
  requirements.txt                # openWakeWord, pyaudio/sounddevice, requests
  config.yaml                     # Mac Mini host, port, wake word model path
  sounds/                         # Chime and feedback audio files
    chime.wav
    listening.wav
    error.wav
  install.sh                      # Setup script (pip install, download wake word model)
  com.bmo.voice-client.plist      # launchd plist for auto-start on login
```

### Voice Flow (Detailed)

**Dave-initiated (wake word):**
1. openWakeWord detects "Hey BMO" → play "listening" sound
2. Start recording from mic (pyaudio, 16kHz mono)
3. VAD (webrtcvad or simple energy-based) detects end-of-speech after ~1s silence
4. Save audio to temp WAV file
5. POST WAV to `http://<mac-mini>:3847/voice/transcribe`
6. Daemon: save WAV to temp, run `whisper-cpp -m small.en -f audio.wav`
7. Daemon: inject transcribed text into tmux: `[Voice] Dave: <text>`
8. Daemon: wait for Claude response (hook-driven transcript capture)
9. Daemon: run Qwen3-TTS on response text, generate response WAV
10. Daemon: return response audio in HTTP response body
11. Client: play response audio through speakers
12. Client: enter conversation mode (listen for ~3-5 seconds for follow-up)
13. Cleanup: delete temp audio files on both sides

**BMO-initiated (chime):**
1. Scheduler task or event triggers voice notification
2. Daemon checks voice client registry — is a client connected?
3. If yes: POST to client's callback URL `/chime` with notification text
4. Client: play chime sound, start listening for ~5 seconds
5. If voice detected: capture, POST to `/voice/transcribe` as confirmation
6. Daemon: detect confirmation phrase, speak the notification
7. If no voice in 5s: client reports timeout to daemon
8. Daemon: fall back to Telegram text delivery

### Response Capture Challenge

The existing transcript stream is hook-driven — Claude Code hooks POST to `/hook/response` after tool use and on stop. The voice flow needs to:

1. Inject the transcribed text into tmux
2. Wait for Claude to process and respond
3. Capture the response text
4. Generate TTS audio

**Approach**: After injecting text, set a flag indicating a voice response is pending. When the transcript stream receives a response (via the existing hook pipeline), check the flag. If set, route the response text to the TTS pipeline and return audio to the waiting HTTP request (which is held open, long-poll style, with a timeout).

**Timeout**: If Claude doesn't respond within 30 seconds, return an error to the client. Client plays a brief "sorry, I didn't get a response" message.

### Config Addition

```yaml
channels:
  voice:
    enabled: true
    stt:
      engine: whisper-cpp
      model: small.en          # base.en for faster, medium.en for more accuracy
      language: en
    tts:
      engine: qwen3-tts-mlx
      model: Qwen/Qwen3-TTS-0.6B
      voice: default           # or path to voice clone sample
      speed: 1.0
    wake_word:
      engine: porcupine
      phrase: "Hey BMO"
    client:
      listen_after_response: 3  # seconds of conversation mode
      chime_timeout: 5          # seconds to wait for voice confirmation
      confirmation_phrases:     # phrases that count as "yes, talk to me"
        - "yeah"
        - "yes"
        - "what's up"
        - "go ahead"
        - "what"
        - "hey"
    initiation:
      calendar_reminders: true
      urgent_emails: true
      todo_nudges: false        # probably too noisy
```

### Model Installation

```bash
# On Mac Mini
brew install whisper-cpp ffmpeg
# Download whisper small.en CoreML model
whisper-cpp --download-model small.en

# Qwen3-TTS via MLX
pip install mlx-audio
# Model downloads automatically on first use (~1.2GB)

# On Dave's Laptop
pip install openwakeword pyaudio requests pyyaml webrtcvad
# openWakeWord wake word model — download from Picovoice console
```

### Storage Budget (Mac Mini, 256GB)

| Component | Size |
|-----------|------|
| whisper.cpp small.en model | ~488MB |
| Qwen3-TTS 0.6B model | ~1.2GB |
| Python + MLX dependencies | ~500MB |
| Temp audio files (cleaned up) | <10MB |
| **Total** | **~2.2GB** |

## Open Questions

- [x] **Wake word engine**: Decided on openWakeWord (Apache 2.0, fully open source, no telemetry, 100% local). Custom "Hey BMO" model will be trained via Google Colab notebook (<1 hour, synthetic speech generation — no need for 100+ real samples).
- [ ] **Client as separate repo?**: Should the laptop voice client live in the CC4Me-BMO repo or in its own repo? It's a different machine with different dependencies. Leaning toward a `voice-client/` directory in this repo for simplicity.
- [ ] **Conversation mode VAD**: What's the right silence threshold for conversation mode? Too short and it'll cut Dave off mid-thought. Too long and the delay feels awkward. Probably needs tuning — start at 1.5 seconds of silence.
- [ ] **Multiple response chunks**: Claude sometimes responds in multiple tool calls (read file, then answer). The hook-driven transcript stream may fire multiple times for a single query. Need to define "response complete" — probably the Stop hook, which fires when Claude finishes its full response.

## Notes

- The full speech integration research is at `.claude/state/research/speech-integration-research.md` (750 lines, covers all evaluated options).
- Dave confirmed: mobile voice is low priority. He's comfortable with text and Siri Shortcuts on his phone.
- Dave's budget is $20-50/month, but the all-local approach means $0/month ongoing. The budget is available if we want to add cloud fallbacks later.
- Dave expects to talk a lot, which makes local processing even more cost-effective vs. per-minute cloud APIs.
- Dave uses his own laptop for calls. The Mac Mini is dedicated to BMO. No shared resources.
- Mac Mini is headless. The dummy HDMI dongle question is resolved — not needed for audio since all audio I/O happens on Dave's laptop.
