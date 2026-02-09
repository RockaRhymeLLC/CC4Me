/**
 * Voice Server — HTTP endpoint handlers for /voice/* routes.
 *
 * Handles client registration, status queries, transcription,
 * and (in later stories) TTS endpoints.
 */

import http from 'node:http';
import { createLogger } from '../core/logger.js';
import { loadConfig } from '../core/config.js';
import {
  registerClient,
  unregisterClient,
  getRegistryStatus,
  isVoiceAvailable,
  sendChime,
  sendAudioToClient,
  startPruner,
  stopPruner,
} from './voice-client-registry.js';
import { transcribe } from './stt.js';
import { saveTempAudio, cleanupTemp } from './audio-utils.js';
import { synthesize, startWorker, stopWorker } from './tts.js';
import { injectText } from '../core/session-bridge.js';
import { registerVoicePending, clearVoicePending, isVoicePending, getChannel, startTypingIndicator } from '../comms/channel-router.js';

const log = createLogger('voice-server');

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB max upload
const MAX_TTS_CHARS = 500; // Max chars per TTS request (prevents OOM on long text)
const VOICE_RESPONSE_TIMEOUT_MS = 30_000; // Max wait for Claude's response

/**
 * Parse JSON body from an incoming request.
 */
function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => resolve(body));
  });
}

/**
 * Parse raw binary body from an incoming request.
 * Rejects if the body exceeds maxBytes (drains remaining data first).
 */
function parseRawBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let tooLarge = false;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        tooLarge = true;
        // Keep draining so the response can be sent cleanly
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (tooLarge) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

/**
 * Get the client's IP address from the request.
 */
function getClientIp(req: http.IncomingMessage): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    ?? req.socket.remoteAddress
    ?? 'unknown';
}

/**
 * Check if voice is enabled in config. Returns false and sends 503 if disabled.
 */
function checkVoiceEnabled(res: http.ServerResponse): boolean {
  const config = loadConfig();
  if (!config.channels.voice?.enabled) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Voice is not enabled' }));
    return false;
  }
  return true;
}

/**
 * Handle a /voice/* request. Returns true if the request was handled.
 */
export async function handleVoiceRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<boolean> {

  // POST /voice/register
  if (req.method === 'POST' && pathname === '/voice/register') {
    if (!checkVoiceEnabled(res)) return true;

    const body = await parseBody(req);
    try {
      const data = JSON.parse(body) as { callbackUrl?: string; clientId?: string };
      if (!data.callbackUrl || !data.clientId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "'callbackUrl' and 'clientId' are required" }));
        return true;
      }

      const ip = getClientIp(req);
      registerClient(data.clientId, data.callbackUrl, ip);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
    return true;
  }

  // POST /voice/unregister
  if (req.method === 'POST' && pathname === '/voice/unregister') {
    if (!checkVoiceEnabled(res)) return true;

    const body = await parseBody(req);
    try {
      const data = JSON.parse(body) as { clientId?: string };
      if (!data.clientId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "'clientId' is required" }));
        return true;
      }

      const removed = unregisterClient(data.clientId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, removed }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
    return true;
  }

  // GET /voice/status
  if (req.method === 'GET' && pathname === '/voice/status') {
    // Status endpoint works even when voice is disabled (returns connected: false)
    const status = getRegistryStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return true;
  }

  // POST /voice/stt — STT only (no Claude, no TTS). Used for chime confirmation.
  if (req.method === 'POST' && pathname === '/voice/stt') {
    if (!checkVoiceEnabled(res)) return true;

    let audioBuffer: Buffer;
    try {
      audioBuffer = await parseRawBody(req, MAX_AUDIO_BYTES);
    } catch (err) {
      if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large (max 10MB)' }));
        return true;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read request body' }));
      return true;
    }

    if (audioBuffer.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Empty audio body' }));
      return true;
    }

    // WAV header check
    if (audioBuffer.length < 12 ||
        audioBuffer.toString('ascii', 0, 4) !== 'RIFF' ||
        audioBuffer.toString('ascii', 8, 12) !== 'WAVE') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid audio format — expected WAV' }));
      return true;
    }

    let tempPath: string | null = null;
    try {
      tempPath = saveTempAudio(audioBuffer);
      const text = await transcribe(tempPath);
      cleanupTemp(tempPath);
      tempPath = null;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: text.trim() }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('STT-only error', { error: msg });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: msg }));
      }
    } finally {
      if (tempPath) cleanupTemp(tempPath);
    }
    return true;
  }

  // POST /voice/transcribe — full voice pipeline: audio → STT → Claude → TTS → audio
  if (req.method === 'POST' && pathname === '/voice/transcribe') {
    if (!checkVoiceEnabled(res)) return true;

    // No busy check — tmux queues the injected text naturally.
    // The voice-pending callback will capture the response.

    // Check if another voice request is already pending
    if (isVoicePending()) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Another voice request is in progress' }));
      return true;
    }

    let audioBuffer: Buffer;
    try {
      audioBuffer = await parseRawBody(req, MAX_AUDIO_BYTES);
    } catch (err) {
      if (err instanceof Error && err.message === 'PAYLOAD_TOO_LARGE') {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large (max 10MB)' }));
        return true;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read request body' }));
      return true;
    }

    if (audioBuffer.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Empty audio body' }));
      return true;
    }

    // Basic WAV header check
    if (audioBuffer.length < 12 ||
        audioBuffer.toString('ascii', 0, 4) !== 'RIFF' ||
        audioBuffer.toString('ascii', 8, 12) !== 'WAVE') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid audio format — expected WAV' }));
      return true;
    }

    let tempPath: string | null = null;
    try {
      // Step 1: STT — transcribe the audio
      tempPath = saveTempAudio(audioBuffer);
      const sttText = await transcribe(tempPath);
      cleanupTemp(tempPath);
      tempPath = null;

      if (!sttText.trim()) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: '', note: 'No speech detected' }));
        return true;
      }

      log.info('Voice pipeline: STT complete', { text: sttText });

      // Check channel to determine response routing
      const channel = getChannel();

      if (channel === 'voice') {
        // Full voice pipeline: STT → Claude → TTS → audio response
        const responseText = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            clearVoicePending();
            reject(new Error('Claude did not respond within 30 seconds'));
          }, VOICE_RESPONSE_TIMEOUT_MS);

          registerVoicePending((text: string) => {
            clearTimeout(timeout);
            resolve(text);
          });

          const injected = injectText(`[Voice] Dave: ${sttText}`);
          if (!injected) {
            clearTimeout(timeout);
            clearVoicePending();
            reject(new Error('Failed to inject text into Claude session'));
          }
        });

        log.info('Voice pipeline: Claude responded', { chars: responseText.length });

        // TTS — synthesize Claude's response
        const ttsInput = responseText.length > MAX_TTS_CHARS
          ? responseText.substring(0, MAX_TTS_CHARS - 3) + '...'
          : responseText;

        const responseAudio = await synthesize(ttsInput);

        log.info('Voice pipeline: TTS complete', {
          responseChars: responseText.length,
          ttsChars: ttsInput.length,
          audioBytes: responseAudio.length,
        });

        res.writeHead(200, {
          'Content-Type': 'audio/wav',
          'X-Transcription': encodeURIComponent(sttText),
          'X-Response-Text': encodeURIComponent(responseText),
          'Content-Length': String(responseAudio.length),
        });
        res.end(responseAudio);
      } else {
        // Voice input, text output: inject into Claude, response goes via current channel

        // Start typing indicator so the user sees "typing..." while
        // waiting for Claude's response via the transcript stream.
        if (channel === 'telegram' || channel === 'telegram-verbose') {
          startTypingIndicator();
        }

        const injected = injectText(`[Voice] Dave: ${sttText}`);
        if (!injected) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to inject text into Claude session' }));
          return true;
        }

        log.info('Voice pipeline: text injected, response via channel', { text: sttText, channel });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: sttText, responseChannel: channel }));
      }

    } catch (err) {
      clearVoicePending(); // Clean up in case of error
      const msg = err instanceof Error ? err.message : String(err);
      log.error('Voice pipeline error', { error: msg });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: msg }));
      }
    } finally {
      if (tempPath) cleanupTemp(tempPath);
    }
    return true;
  }

  // POST /voice/speak — synthesize text to speech audio
  if (req.method === 'POST' && pathname === '/voice/speak') {
    if (!checkVoiceEnabled(res)) return true;

    const body = await parseBody(req);
    try {
      const data = JSON.parse(body) as { text?: string };
      if (!data.text?.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "'text' is required and must be non-empty" }));
        return true;
      }

      const text = data.text.trim();
      if (text.length > MAX_TTS_CHARS) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Text too long (${text.length} chars, max ${MAX_TTS_CHARS})` }));
        return true;
      }

      const audioBuffer = await synthesize(text);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': String(audioBuffer.length),
      });
      res.end(audioBuffer);
    } catch (err) {
      log.error('Speak endpoint error', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'TTS failed' }));
    }
    return true;
  }

  // POST /voice/notify — daemon-initiated voice notification (chime flow)
  if (req.method === 'POST' && pathname === '/voice/notify') {
    if (!checkVoiceEnabled(res)) return true;

    const body = await parseBody(req);
    try {
      const data = JSON.parse(body) as { text?: string; type?: string };
      if (!data.text?.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "'text' is required" }));
        return true;
      }

      const result = await sendVoiceNotification(
        data.text.trim(),
        data.type || 'notification',
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }));
    }
    return true;
  }

  return false; // Not a recognized voice route
}

/**
 * Initialize the voice server (start pruner and TTS worker).
 */
export async function initVoiceServer(): Promise<void> {
  const config = loadConfig();
  if (config.channels.voice?.enabled) {
    startPruner();

    // Start TTS worker (async, don't block server startup)
    startWorker().catch((err) => {
      log.error('TTS worker failed to start', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    log.info('Voice server initialized');
  } else {
    log.info('Voice is disabled in config, endpoints will return 503');
  }
}

/**
 * Stop the voice server (stop pruner and TTS worker).
 */
export function stopVoiceServer(): void {
  stopPruner();
  stopWorker();
}

// ---------------------------------------------------------------------------
// Voice notification (daemon-initiated chime flow)
// ---------------------------------------------------------------------------

export interface VoiceNotificationResult {
  delivered: boolean;
  method: 'voice' | 'fallback';
  reason?: string;
}

/**
 * Send a voice notification to Dave.
 *
 * Flow:
 * 1. Check if a voice client is connected
 * 2. Send chime request to client
 * 3. Client plays chime, listens for confirmation/rejection
 * 4. If confirmed: synthesize TTS, push audio to client
 * 5. If rejected/timeout/no client: return false (caller should use Telegram)
 *
 * @param text - The notification text to speak
 * @param type - Notification type (e.g., 'calendar', 'email', 'todo')
 * @returns Result indicating delivery method
 */
export async function sendVoiceNotification(
  text: string,
  type: string = 'notification',
): Promise<VoiceNotificationResult> {
  // Check if any voice client is connected
  if (!isVoiceAvailable()) {
    log.info('Voice notification: no client connected, falling back', { type });
    return { delivered: false, method: 'fallback', reason: 'No voice client connected' };
  }

  // Send chime to client
  log.info('Voice notification: sending chime', { type, textChars: text.length });
  const chimeResult = await sendChime(text, type);

  if (chimeResult.status !== 'confirmed') {
    log.info('Voice notification: chime not confirmed, falling back', {
      status: chimeResult.status,
      type,
    });
    return {
      delivered: false,
      method: 'fallback',
      reason: `Client ${chimeResult.status}: ${chimeResult.error || 'no confirmation'}`,
    };
  }

  // Synthesize TTS audio
  try {
    const ttsText = text.length > MAX_TTS_CHARS
      ? text.substring(0, MAX_TTS_CHARS - 3) + '...'
      : text;

    const audioBuffer = await synthesize(ttsText);
    log.info('Voice notification: TTS complete', {
      chars: ttsText.length,
      audioBytes: audioBuffer.length,
    });

    // Push audio to client
    const played = await sendAudioToClient(audioBuffer);
    if (played) {
      log.info('Voice notification: delivered via voice', { type });
      return { delivered: true, method: 'voice' };
    } else {
      log.warn('Voice notification: audio push failed, falling back', { type });
      return { delivered: false, method: 'fallback', reason: 'Audio push to client failed' };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Voice notification: TTS failed, falling back', { error: msg, type });
    return { delivered: false, method: 'fallback', reason: `TTS error: ${msg}` };
  }
}
