# Plan: Ambient Voice Integration

**Spec**: specs/20260204-voice-integration.spec.md
**To-Do**: 054
**Created**: 2026-02-04

## Technical Approach

### Architecture

Voice integration adds two major components:

1. **Daemon voice module** (`daemon/src/voice/`) — New module on the Mac Mini handling STT, TTS, client tracking, and Claude response capture. Follows existing daemon patterns (register-at-import, handler registration, structured logging).

2. **Laptop voice client** (`voice-client/`) — Lightweight Python script (~200 lines) running on Dave's MacBook. Handles wake word detection, audio capture, playback, and chime responses. Communicates with daemon over LAN HTTP.

### Key Design Decisions

**Voice as parallel system, not exclusive channel.** Voice runs alongside Telegram — it doesn't replace it. The daemon tracks whether a voice client is connected and routes notifications to voice when available, falling back to Telegram when not. This is different from the channel-router's mutually exclusive model. Voice availability is a runtime property, not a config toggle.

**Chunked streaming response.** When the laptop client POSTs audio to `/voice/transcribe`, the HTTP connection stays open (Transfer-Encoding: chunked) while the daemon: (1) transcribes via whisper.cpp, (2) injects text into Claude's tmux session, (3) waits for Claude's response via the transcript stream, (4) streams TTS audio chunks as they generate. The client reads the response body as a stream and begins playback before the full response is ready. Timeout at 30 seconds. *(R2 review: chunked streaming cuts perceived latency vs. buffering the full WAV.)*

**Callback-based chime system.** The laptop client registers a callback URL with the daemon on startup. When BMO wants to initiate, the daemon POSTs to the client's callback URL. The client plays a chime, listens for confirmation (positive phrases) or rejection (negative phrases like "not now", "later"), and either sends audio back to the daemon or reports timeout/rejection. *(R2 review: added negative phrase detection alongside confirmation.)*

**CLI wrapper for STT, persistent worker for TTS.** whisper.cpp is invoked as a CLI subprocess per-request — bursty usage makes this fine, and subprocess isolation is a plus. Qwen3-TTS runs as a **persistent Python worker** (localhost HTTP microservice on a Unix socket) started by the daemon on boot. Loading the 1.2GB model on every request would add 3-5s latency, which is unacceptable. The persistent worker loads the model once and serves requests with sub-500ms latency. *(R2 review: persistent TTS worker is essential, not premature optimization.)*

### Module Structure

```
daemon/src/voice/
  voice-server.ts          # HTTP endpoint handlers for /voice/* routes
  stt.ts                   # whisper.cpp CLI wrapper
  tts.ts                   # Qwen3-TTS Python/MLX wrapper
  voice-client-registry.ts # Track connected laptop clients
  audio-utils.ts           # Temp file management, format conversion

voice-client/
  bmo_voice.py             # Main client script
  requirements.txt         # Python dependencies
  config.yaml              # Connection settings
  sounds/                  # Chime, listening, error WAVs
  install.sh               # Setup script
  com.bmo.voice-client.plist  # launchd auto-start
```

### Integration Points

1. **main.ts** — Import voice module, add `/voice/*` route prefix delegation
2. **config.ts** — Add `VoiceConfig` interface and `channels.voice` section
3. **transcript-stream.ts** — Add voice-pending flag check; when set, route response text to a callback instead of (in addition to) the channel router. Must grab the LAST assistant message (not just any) and set `_lastDeliveredTime` to prevent Telegram double-delivery. *(R2 review: hook lifecycle nuance + dedup guard from PR #26.)*
4. **channel-router.ts** — No changes needed. Voice is parallel, not a channel type
5. **Scheduler tasks** — Existing tasks (calendar reminders, email alerts) gain voice notification capability by checking voice client availability

## Stories

| ID | Title | Priority | Tests | Blocked By |
|----|-------|----------|-------|------------|
| s-v01 | Voice module foundation and config | 1 | t-001, t-002 | — |
| s-v02 | STT pipeline (whisper.cpp) | 2 | t-003, t-004 | s-v01 |
| s-v03 | TTS pipeline (Qwen3-TTS) | 3 | t-005, t-006 | s-v01 |
| s-v04 | Full voice pipeline (STT → Claude → TTS) | 4 | t-007, t-008 | s-v02, s-v03 |
| s-v05 | Laptop voice client | 5 | t-009, t-010, t-011 | s-v04 |
| s-v06 | BMO-initiated voice (chime system) | 6 | t-012, t-013, t-014 | s-v05 |
| s-v07 | Conversation mode and polish | 7 | t-015, t-016, t-017 | s-v05 |

## Dependencies

```
s-v01 (foundation)
  ├── s-v02 (STT)
  ├── s-v03 (TTS)
  │     │
  └─────┴── s-v04 (full pipeline)
                └── s-v05 (laptop client)
                      ├── s-v06 (chime system)
                      └── s-v07 (conversation mode)
```

## Files to Create

### Daemon (Mac Mini)
- `daemon/src/voice/voice-server.ts` — Route handlers
- `daemon/src/voice/stt.ts` — whisper.cpp wrapper
- `daemon/src/voice/tts.ts` — Qwen3-TTS wrapper
- `daemon/src/voice/voice-client-registry.ts` — Client tracking
- `daemon/src/voice/audio-utils.ts` — Audio utilities
- `daemon/src/voice/tts-worker.py` — Python script for Qwen3-TTS inference

### Laptop Client
- `voice-client/bmo_voice.py` — Main client
- `voice-client/requirements.txt` — Dependencies
- `voice-client/config.yaml` — Connection config
- `voice-client/install.sh` — Setup script
- `voice-client/com.bmo.voice-client.plist` — launchd plist
- `voice-client/sounds/` — Audio feedback files

### Modified Files
- `daemon/src/core/main.ts` — Add voice route delegation
- `daemon/src/core/config.ts` — Add VoiceConfig types
- `daemon/src/comms/transcript-stream.ts` — Add voice-pending response routing
- `cc4me.config.yaml` — Add channels.voice section

## R2 Review Summary (2026-02-04)

R2 reviewed the full spec + plan. Verdict: **Ship it.** One must-do change (persistent TTS worker), rest is solid. Key feedback incorporated:

1. **Chunked transfer encoding** for TTS streaming (cuts perceived latency)
2. **beam_size=1** for whisper.cpp on M4 (avoids known slowdown, GitHub issue #3493)
3. **Persistent TTS worker** — essential for usable latency, not premature optimization
4. **Stay with small.en** — accuracy matters more than 338MB savings
5. **Grab LAST assistant message** + set `_lastDeliveredTime` to prevent Telegram double-delivery
6. **Negative phrase detection** for chime system ("not now", "later")
7. **openWakeWord free tier** phones home for key validation — document this, not fully offline

Latency math confirmed: ~500ms STT + ~500ms TTS + ~200ms overhead = ~1.2s (within 2s target with persistent TTS worker).

## Notes

- Model installation (whisper.cpp, Qwen3-TTS) happens as part of story s-v02 and s-v03, not as a separate story. The install is a prerequisite to testing the wrapper.
- The laptop client (s-v05) is the first story that requires Dave's MacBook. Stories s-v01 through s-v04 are all Mac Mini work and can be built and tested independently.
- **openWakeWord confirmed** (Dave's decision). Apache 2.0, fully open source, no telemetry, 100% local. Custom "Hey BMO" model trained via Google Colab notebook (synthetic speech, <1 hour). Dependencies: openwakeword, onnxruntime. No API key needed.
- Audio feedback sounds (chime.wav, listening.wav, error.wav) can be generated or sourced from freesound.org. Keep them short (<1 second) and distinctive.
- If memory pressure ever becomes an issue: quantized Qwen3-TTS (8-bit) drops from ~1.2GB to ~600-800MB with minimal quality loss. whisper could also be loaded on-demand since STT is bursty.
- Security note: LAN-only is sufficient for home network. If ever exposed via Cloudflare tunnel, add bearer token auth (same pattern as agent-comms).
