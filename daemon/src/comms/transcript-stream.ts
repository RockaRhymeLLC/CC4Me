/**
 * Transcript Stream — reads assistant messages from the Claude Code transcript
 * JSONL file and routes them to the active channel.
 *
 * v3: Hook-driven approach. Instead of watching the file with fs.watch (which
 * is unreliable on macOS), Claude Code hooks (PostToolUse + Stop) notify the
 * daemon via HTTP when there's a new assistant message to read. This means
 * we only read the transcript when we know there's something relevant.
 *
 * Still handles transcript file rotation (new session = new file) via periodic
 * check, since hooks don't fire on session start.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getNewestTranscript, capturePane } from '../core/session-bridge.js';
import { routeOutgoingMessage, signalResponseComplete, getChannel } from './channel-router.js';
import { getProjectDir } from '../core/config.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('transcript-stream');

interface TranscriptMessage {
  type: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      thinking?: string;
    }>;
  };
}

// ── Dedup ────────────────────────────────────────────────────

const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _sentHashes = new Map<string, number>(); // hash → timestamp

function contentHash(text: string): string {
  return createHash('sha256').update(text.substring(0, 500)).digest('hex').substring(0, 16);
}

function isDuplicate(text: string): boolean {
  // Prune expired entries
  const now = Date.now();
  for (const [hash, ts] of _sentHashes) {
    if (now - ts > DEDUP_TTL_MS) _sentHashes.delete(hash);
  }

  const hash = contentHash(text);
  if (_sentHashes.has(hash)) return true;

  _sentHashes.set(hash, now);
  return false;
}

// ── Delivery log ─────────────────────────────────────────────

type DeliveryEvent = 'delivered' | 'dedup' | 'retry-exhausted';
type DeliveryLayer = 'stop-hook' | 'retry' | 'background-check' | 'pane-capture';

interface DeliveryLogEntry {
  ts: string;
  event: DeliveryEvent;
  layer: DeliveryLayer;
  hookEvent: string | null;
  elapsed: number | null;
  retryAttempt: number | null;
  chatId: string | null;
  len: number;
  hash: string;
}

const DELIVERY_LOG_MAX = 100;
const DELIVERY_LOG_TRIM = 75;

function getDeliveryLogPath(): string {
  return path.join(getProjectDir(), 'logs', 'delivery.jsonl');
}

function logDelivery(entry: DeliveryLogEntry): void {
  try {
    const logPath = getDeliveryLogPath();
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logPath, line);

    // Trim if over cap
    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length > DELIVERY_LOG_MAX) {
      const trimmed = lines.slice(lines.length - DELIVERY_LOG_TRIM);
      fs.writeFileSync(logPath, trimmed.join('\n') + '\n');
    }
  } catch (err) {
    log.error('Failed to write delivery log', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Get the current chat ID for logging. Reads from the channel router's
 * reply-chat-id state file (set by the Telegram adapter on incoming messages).
 */
function getCurrentChatId(): string | null {
  const channel = getChannel();
  if (channel === 'terminal' || channel === 'silent') return null;
  try {
    const chatIdFile = path.join(getProjectDir(), '.claude', 'state', 'reply-chat-id.txt');
    return fs.readFileSync(chatIdFile, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

// Tracking state for the current delivery cycle
let _currentHookEvent: string | null = null;
let _retryStartTime: number | null = null;
let _retryAttemptCount = 0;
let _lastDeliveredLen = 0;
let _lastDeliveredHash = '';

// ── State ────────────────────────────────────────────────────

let _currentFile: string | null = null;
let _fileOffset = 0;  // byte offset of where we've read to
let _checkInterval: ReturnType<typeof setInterval> | null = null;
let _pollTimer: ReturnType<typeof setTimeout> | null = null;
let _running = false;

/**
 * Called by the daemon's HTTP endpoint when a Claude Code hook fires
 * (PostToolUse, Stop, or SubagentStop). Reads any new assistant messages
 * from the transcript and routes them.
 *
 * For Stop/SubagentStop hooks where the transcript hasn't been flushed yet,
 * starts a retry loop to catch delayed writes (200ms–60s).
 *
 * @param transcriptPath - Optional path from the hook's stdin payload.
 * @param hookEvent - Optional hook event name (e.g., 'Stop', 'SubagentStop').
 */
export function onHookNotification(transcriptPath?: string, hookEvent?: string): void {
  _currentHookEvent = hookEvent ?? null;

  // If the hook provides a transcript path, use it (handles rotation)
  if (transcriptPath && transcriptPath !== _currentFile) {
    switchToFile(transcriptPath);
  }

  if (!_currentFile) {
    const newest = getNewestTranscript();
    if (newest) {
      switchToFile(newest);
    } else {
      log.warn('Hook fired but no transcript file found');
      return;
    }
  }

  // First attempt — read immediately
  const found = readNewMessages(_currentFile!);

  if (found) {
    // Delivered on first read from hook — log as stop-hook layer
    logDelivery({
      ts: new Date().toISOString(),
      event: 'delivered',
      layer: 'stop-hook',
      hookEvent: _currentHookEvent,
      elapsed: 0,
      retryAttempt: null,
      chatId: getCurrentChatId(),
      len: _lastDeliveredLen,
      hash: _lastDeliveredHash,
    });
    signalResponseComplete();
    return;
  }

  // For Stop/SubagentStop hooks, the transcript may not be flushed yet.
  // Start a retry loop to catch delayed writes.
  const isStopEvent = hookEvent === 'Stop' || hookEvent === 'SubagentStop';
  if (isStopEvent) {
    log.info(`No messages on first read after ${hookEvent}, starting retry loop`);
    startRetryLoop();
  }
}

/**
 * Read new lines from the transcript file since our last offset.
 * Returns true if any assistant messages were found and delivered.
 */
function readNewMessages(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);

    if (stats.size <= _fileOffset) {
      if (stats.size < _fileOffset) {
        log.info('Transcript file truncated, resetting offset');
        _fileOffset = 0;
      }
      return false;
    }

    const readFrom = _fileOffset;
    _fileOffset = stats.size;

    // Read only the new bytes synchronously — simple and reliable
    const buf = Buffer.alloc(stats.size - readFrom);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, buf.length, readFrom);
    fs.closeSync(fd);

    const newContent = buf.toString('utf8');
    const lines = newContent.split('\n');

    let foundAny = false;
    for (const line of lines) {
      if (!line.includes('"type":"assistant"')) continue;
      if (line.length > 50_000) continue;

      try {
        const msg = JSON.parse(line) as TranscriptMessage;
        if (msg.type !== 'assistant') continue;
        if (handleAssistantMessage(msg)) foundAny = true;
      } catch {
        // Malformed JSON line — skip
      }
    }
    return foundAny;
  } catch (err) {
    log.error('readNewMessages error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Handle a parsed assistant message from the transcript.
 * Extracts text blocks and optionally thinking blocks (for verbose mode).
 * Returns true if the message was delivered (not a duplicate, not empty).
 */
function handleAssistantMessage(msg: TranscriptMessage): boolean {
  const content = msg.message?.content;
  if (!content || !Array.isArray(content)) return false;

  // Extract text blocks
  const textParts = content
    .filter(c => c.type === 'text' && c.text)
    .map(c => c.text!);

  const text = textParts.join('\n').trim();

  // Skip empty or placeholder messages
  if (!text || text === 'null' || text === '(no content)') return false;

  const hash = contentHash(text);

  // Dedup check — skip if we've already sent this content
  if (isDuplicate(text)) {
    log.info(`Dedup: skipping already-sent message (${text.length} chars, hash=${hash})`);
    logDelivery({
      ts: new Date().toISOString(),
      event: 'dedup',
      layer: _pollTimer ? 'retry' : _currentHookEvent ? 'stop-hook' : 'background-check',
      hookEvent: _currentHookEvent,
      elapsed: _retryStartTime ? Date.now() - _retryStartTime : null,
      retryAttempt: _retryAttemptCount || null,
      chatId: getCurrentChatId(),
      len: text.length,
      hash,
    });
    return false;
  }

  log.debug(`New assistant message (${text.length} chars)`);

  // Track for delivery logging (caller reads these after readNewMessages returns)
  _lastDeliveredLen = text.length;
  _lastDeliveredHash = hash;

  // Extract thinking blocks for verbose mode
  const thinkingParts = content
    .filter(c => c.type === 'thinking' && c.thinking)
    .map(c => c.thinking!);

  const thinking = thinkingParts.join('\n').trim();

  // Route through channel router (passes both text and thinking)
  routeOutgoingMessage(text, thinking || undefined);
  return true;
}

/**
 * Switch to a new transcript file.
 */
function switchToFile(filePath: string): void {
  _currentFile = filePath;
  // Start from end of file (don't replay old messages)
  try {
    _fileOffset = fs.statSync(filePath).size;
    log.info(`Watching transcript: ${path.basename(filePath)} (from byte ${_fileOffset})`);
  } catch {
    _fileOffset = 0;
    log.warn(`Could not stat transcript: ${path.basename(filePath)}, starting from 0`);
  }
}

// ── Retry loop (Layer 1) ─────────────────────────────────────

/**
 * Retry loop for Stop/SubagentStop hooks where the transcript hasn't
 * been flushed yet. Fast burst first (3x200ms), then slow poll (1s)
 * up to 60s total. On timeout, falls back to tmux capture-pane.
 */
function startRetryLoop(): void {
  // Cancel any existing retry loop
  cancelRetryLoop();

  _retryStartTime = Date.now();
  _retryAttemptCount = 0;

  function poll(): void {
    if (!_currentFile) {
      cancelRetryLoop();
      signalResponseComplete();
      return;
    }

    _retryAttemptCount++;
    const found = readNewMessages(_currentFile!);

    if (found) {
      const elapsed = Date.now() - _retryStartTime!;
      log.info(`Retry loop: delivered after ${elapsed}ms (attempt ${_retryAttemptCount})`);
      logDelivery({
        ts: new Date().toISOString(),
        event: 'delivered',
        layer: 'retry',
        hookEvent: _currentHookEvent,
        elapsed,
        retryAttempt: _retryAttemptCount,
        chatId: getCurrentChatId(),
        len: _lastDeliveredLen,
        hash: _lastDeliveredHash,
      });
      cancelRetryLoop();
      _retryStartTime = null;
      _retryAttemptCount = 0;
      signalResponseComplete();
      return;
    }

    const elapsed = Date.now() - _retryStartTime!;
    if (elapsed >= 60_000) {
      log.warn(`Retry loop: exhausted after ${_retryAttemptCount} attempts (${elapsed}ms), falling back to pane capture`);
      cancelRetryLoop();
      onRetryExhausted();
      return;
    }

    // Fast burst for first 3 attempts (200ms), then slow poll (1s)
    const delay = _retryAttemptCount <= 3 ? 200 : 1000;
    _pollTimer = setTimeout(poll, delay);
  }

  // First retry after 200ms
  _pollTimer = setTimeout(poll, 200);
}

function cancelRetryLoop(): void {
  if (_pollTimer) {
    clearTimeout(_pollTimer);
    _pollTimer = null;
  }
}

// ── Background check (Layer 2) ──────────────────────────────

/**
 * Passive safety net running every 7 seconds. Checks for transcript
 * file rotation AND reads new messages if no retry loop is active.
 * Catches messages that hooks missed entirely.
 */
function backgroundCheck(): void {
  // Check for newer transcript file (handles session restarts)
  const newest = getNewestTranscript();
  if (newest && newest !== _currentFile) {
    log.info(`Switching to newer transcript: ${path.basename(newest)}`);
    switchToFile(newest);
  }

  // Also read new messages if no retry loop is active
  if (!_pollTimer && _currentFile) {
    _currentHookEvent = null; // Background check, no hook
    const found = readNewMessages(_currentFile);
    if (found) {
      log.info('Background check: found and delivered missed message(s)');
      logDelivery({
        ts: new Date().toISOString(),
        event: 'delivered',
        layer: 'background-check',
        hookEvent: null,
        elapsed: null,
        retryAttempt: null,
        chatId: getCurrentChatId(),
        len: _lastDeliveredLen,
        hash: _lastDeliveredHash,
      });
      signalResponseComplete();
    }
  }
}

// ── Capture-pane fallback (Layer 3) ──────────────────────────

/**
 * Last resort — called when the retry loop exhausts 60s without finding
 * the message in the transcript. Captures the tmux pane content and
 * attempts to extract the assistant's response.
 */
function onRetryExhausted(): void {
  const elapsed = _retryStartTime ? Date.now() - _retryStartTime : 60_000;
  let paneCaptureResult: 'delivered' | 'empty' | 'duplicate' | 'failed' = 'failed';

  try {
    const pane = capturePane();
    if (!pane) {
      log.warn('Pane capture: empty pane content');
      paneCaptureResult = 'empty';
      signalResponseComplete();
      logRetryExhausted(elapsed, paneCaptureResult, 0, '');
      return;
    }

    const text = extractAssistantFromPane(pane);
    if (text && !isDuplicate(text)) {
      log.info(`Pane capture: extracted response (${text.length} chars), delivering`);
      routeOutgoingMessage(text);
      paneCaptureResult = 'delivered';
      logDelivery({
        ts: new Date().toISOString(),
        event: 'delivered',
        layer: 'pane-capture',
        hookEvent: _currentHookEvent,
        elapsed,
        retryAttempt: _retryAttemptCount,
        chatId: getCurrentChatId(),
        len: text.length,
        hash: contentHash(text),
      });
    } else if (text) {
      log.info('Pane capture: extracted text was a duplicate, skipping');
      paneCaptureResult = 'duplicate';
      logRetryExhausted(elapsed, paneCaptureResult, text.length, contentHash(text));
    } else {
      log.warn('Pane capture: could not extract assistant response from pane');
      paneCaptureResult = 'failed';
      logRetryExhausted(elapsed, paneCaptureResult, 0, '');
    }
  } catch (err) {
    log.error('Pane capture error', { error: err instanceof Error ? err.message : String(err) });
    logRetryExhausted(elapsed, 'failed', 0, '');
  }

  _retryStartTime = null;
  _retryAttemptCount = 0;
  signalResponseComplete();
}

function logRetryExhausted(elapsed: number, paneCaptureResult: string, len: number, hash: string): void {
  logDelivery({
    ts: new Date().toISOString(),
    event: 'retry-exhausted',
    layer: 'pane-capture',
    hookEvent: _currentHookEvent,
    elapsed,
    retryAttempt: _retryAttemptCount,
    chatId: getCurrentChatId(),
    len,
    hash,
  });
}

/**
 * Extract the most recent assistant response from tmux pane content.
 * Conservative — returns null if ambiguous rather than sending garbage.
 *
 * Looks for the pattern of Claude's output: text blocks between prompts,
 * skipping UI chrome (spinners, status bar, "esc to interrupt").
 */
function extractAssistantFromPane(pane: string): string | null {
  const lines = pane.split('\n');

  // UI chrome patterns to skip
  const chromePatterns = [
    /esc to interrupt/i,
    /^[✶✷✸✹✺✻✼✽✾✿❀❁❂❃⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/,
    /^>/,          // Input prompt
    /^❯/,          // Prompt character
    /^\$/,         // Shell prompt
    /^\s*$/,       // Empty lines (handled below)
  ];

  // Find the last substantial block of text that isn't UI chrome.
  // Walk backwards from the end to find non-chrome content.
  let endIdx = lines.length - 1;

  // Skip trailing empty lines and chrome
  while (endIdx >= 0) {
    const line = lines[endIdx]!.trim();
    if (line === '' || chromePatterns.some(p => p.test(line))) {
      endIdx--;
    } else {
      break;
    }
  }

  if (endIdx < 0) return null;

  // Walk backwards to find the start of the assistant's response block.
  // Stop when we hit a prompt line or the beginning of the pane.
  let startIdx = endIdx;
  while (startIdx > 0) {
    const prevLine = lines[startIdx - 1]!;
    // Stop at prompt-like lines (user input markers)
    if (/^[>❯$]/.test(prevLine.trim()) && prevLine.trim().length > 1) {
      break;
    }
    startIdx--;
  }

  const block = lines.slice(startIdx, endIdx + 1)
    .map(l => l.trimEnd())
    .join('\n')
    .trim();

  // Sanity checks: must have some substance
  if (block.length < 10) return null;
  if (block.split('\n').length < 1) return null;

  log.debug(`Pane extract: ${block.length} chars from lines ${startIdx}-${endIdx}`);
  return block;
}

// ── Lifecycle ────────────────────────────────────────────────

/**
 * Start the transcript stream. Finds the current transcript and sets up
 * periodic background check. Actual message reading is triggered by hook
 * notifications via onHookNotification(), with background check as safety net.
 */
export function startTranscriptStream(): void {
  if (_running) return;
  _running = true;

  const transcriptPath = getNewestTranscript();
  if (transcriptPath) {
    switchToFile(transcriptPath);
  } else {
    log.warn('No transcript file found, will check periodically');
  }

  // Background check every 7 seconds — handles file rotation + missed hooks
  _checkInterval = setInterval(backgroundCheck, 7_000);

  log.info('Transcript stream started (hook-driven + background check)');
}

/**
 * Stop the transcript stream and cancel all timers.
 */
export function stopTranscriptStream(): void {
  _running = false;

  if (_checkInterval) {
    clearInterval(_checkInterval);
    _checkInterval = null;
  }

  cancelRetryLoop();

  log.info('Transcript stream stopped');
}
