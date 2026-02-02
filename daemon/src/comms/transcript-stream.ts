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
import { getNewestTranscript } from '../core/session-bridge.js';
import { routeOutgoingMessage } from './channel-router.js';
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

let _currentFile: string | null = null;
let _fileOffset = 0;  // byte offset of where we've read to
let _checkInterval: ReturnType<typeof setInterval> | null = null;
let _running = false;

/**
 * Called by the daemon's HTTP endpoint when a Claude Code hook fires
 * (PostToolUse or Stop). Reads any new assistant messages from the
 * transcript and routes them.
 *
 * @param transcriptPath - Optional path from the hook's stdin payload.
 *   If provided and different from current, switches to the new file.
 */
export function onHookNotification(transcriptPath?: string): void {
  // If the hook provides a transcript path, use it (handles rotation)
  if (transcriptPath && transcriptPath !== _currentFile) {
    switchToFile(transcriptPath);
  }

  if (!_currentFile) {
    // Try to find a transcript file if we don't have one yet
    const newest = getNewestTranscript();
    if (newest) {
      switchToFile(newest);
    } else {
      log.warn('Hook fired but no transcript file found');
      return;
    }
  }

  readNewMessages(_currentFile!);
}

/**
 * Read new lines from the transcript file since our last offset.
 * Synchronous and simple — no processing flag needed since hooks
 * fire sequentially and we process inline.
 */
function readNewMessages(filePath: string): void {
  try {
    const stats = fs.statSync(filePath);

    if (stats.size <= _fileOffset) {
      if (stats.size < _fileOffset) {
        log.info('Transcript file truncated, resetting offset');
        _fileOffset = 0;
      }
      return;
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

    for (const line of lines) {
      if (!line.includes('"type":"assistant"')) continue;
      if (line.length > 50_000) continue;

      try {
        const msg = JSON.parse(line) as TranscriptMessage;
        if (msg.type !== 'assistant') continue;
        handleAssistantMessage(msg);
      } catch {
        // Malformed JSON line — skip
      }
    }
  } catch (err) {
    log.error('readNewMessages error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Handle a parsed assistant message from the transcript.
 * Extracts text blocks and optionally thinking blocks (for verbose mode).
 */
function handleAssistantMessage(msg: TranscriptMessage): void {
  const content = msg.message?.content;
  if (!content || !Array.isArray(content)) return;

  // Extract text blocks
  const textParts = content
    .filter(c => c.type === 'text' && c.text)
    .map(c => c.text!);

  const text = textParts.join('\n').trim();

  // Skip empty or placeholder messages
  if (!text || text === 'null' || text === '(no content)') return;

  log.debug(`New assistant message (${text.length} chars)`);

  // Extract thinking blocks for verbose mode
  const thinkingParts = content
    .filter(c => c.type === 'thinking' && c.thinking)
    .map(c => c.thinking!);

  const thinking = thinkingParts.join('\n').trim();

  // Route through channel router (passes both text and thinking)
  routeOutgoingMessage(text, thinking || undefined);
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

/**
 * Check for a newer transcript file and switch to it if found.
 */
function checkForNewerFile(): void {
  const newest = getNewestTranscript();
  if (newest && newest !== _currentFile) {
    log.info(`Switching to newer transcript: ${path.basename(newest)}`);
    switchToFile(newest);
  }
}

/**
 * Start the transcript stream. Finds the current transcript and sets up
 * periodic check for file rotation. Actual message reading is triggered
 * by hook notifications via onHookNotification().
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

  // Check for newer transcript files every 10 seconds (handles session restarts)
  _checkInterval = setInterval(checkForNewerFile, 10_000);

  log.info('Transcript stream started (hook-driven mode)');
}

/**
 * Stop the transcript stream.
 */
export function stopTranscriptStream(): void {
  _running = false;

  if (_checkInterval) {
    clearInterval(_checkInterval);
    _checkInterval = null;
  }

  log.info('Transcript stream stopped');
}
