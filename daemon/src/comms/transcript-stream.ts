/**
 * Transcript Stream — watches the Claude Code transcript JSONL file
 * using fs.watch + readline for reliable, efficient parsing.
 *
 * Replaces transcript-watcher.sh:
 * - No more bash polling with sleep 1
 * - No more shelling out to jq for every line
 * - Proper fs.watch for instant notifications
 * - Handles transcript file rotation (new session = new file)
 */

import fs from 'node:fs';
import readline from 'node:readline';
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

let _watcher: fs.FSWatcher | null = null;
let _currentFile: string | null = null;
let _fileOffset = 0;  // byte offset of where we've read to
let _checkInterval: ReturnType<typeof setInterval> | null = null;
let _pollInterval: ReturnType<typeof setInterval> | null = null;
let _running = false;
let _processing = false;  // guard against concurrent processNewLines calls

/**
 * Process new lines added to the transcript file since our last read.
 * Uses a processing flag to prevent concurrent reads (fs.watch on macOS
 * can fire multiple change events for a single write).
 */
function processNewLines(filePath: string): void {
  if (_processing) return;
  _processing = true;

  try {
    const stats = fs.statSync(filePath);

    if (stats.size <= _fileOffset) {
      if (stats.size < _fileOffset) {
        // File was truncated — reset
        log.info('Transcript file truncated, resetting offset');
        _fileOffset = 0;
      }
      _processing = false;
      return;
    }

    // Capture the read range: from current offset to current file size.
    // Update _fileOffset immediately so concurrent calls don't re-read.
    const readFrom = _fileOffset;
    const readTo = stats.size;
    _fileOffset = readTo;

    // Read only the new bytes
    const stream = fs.createReadStream(filePath, {
      start: readFrom,
      end: readTo - 1,
      encoding: 'utf8',
    });

    const rl = readline.createInterface({ input: stream });

    rl.on('line', (line) => {
      // Quick pre-filter: only parse lines that look like assistant messages
      if (!line.includes('"type":"assistant"')) return;

      // Skip very large lines (file snapshots can match the filter)
      if (line.length > 50_000) return;

      try {
        const msg = JSON.parse(line) as TranscriptMessage;
        if (msg.type !== 'assistant') return;

        handleAssistantMessage(msg);
      } catch {
        // Malformed JSON line — skip
      }
    });

    rl.on('close', () => {
      _processing = false;
    });

    rl.on('error', () => {
      _processing = false;
    });
  } catch (err) {
    _processing = false;
    log.error('processNewLines error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Handle a parsed assistant message from the transcript.
 */
function handleAssistantMessage(msg: TranscriptMessage): void {
  const content = msg.message?.content;
  if (!content || !Array.isArray(content)) return;

  // Extract text blocks (non-thinking)
  const textParts = content
    .filter(c => c.type === 'text' && c.text)
    .map(c => c.text!);

  const text = textParts.join('\n').trim();

  // Skip empty or placeholder messages
  if (!text || text === 'null' || text === '(no content)') return;

  log.debug(`New assistant message (${text.length} chars)`);

  // Route through channel router
  routeOutgoingMessage(text);
}

/**
 * Check for a newer transcript file and switch to it if found.
 */
function checkForNewerFile(): void {
  const newest = getNewestTranscript();
  if (newest && newest !== _currentFile) {
    log.info(`Switching to newer transcript: ${path.basename(newest)}`);
    watchFile(newest);
  }
}

/**
 * Fallback poll: check if the current file has new content.
 * fs.watch on macOS can miss events during rapid writes.
 * This runs every 2 seconds as a safety net.
 */
function pollForChanges(): void {
  if (!_currentFile || _processing) return;
  try {
    const stats = fs.statSync(_currentFile);
    if (stats.size > _fileOffset) {
      processNewLines(_currentFile);
    }
  } catch {
    // File may have been deleted during rotation — ignore
  }
}

/**
 * Start watching a specific transcript file.
 */
function watchFile(filePath: string): void {
  // Clean up existing watcher
  if (_watcher) {
    _watcher.close();
    _watcher = null;
  }

  _currentFile = filePath;
  // Start from end of file (don't replay old messages)
  _fileOffset = fs.statSync(filePath).size;

  log.info(`Watching transcript: ${path.basename(filePath)} (from byte ${_fileOffset})`);

  // Use fs.watch for instant change notifications
  _watcher = fs.watch(filePath, (event) => {
    if (event === 'change') {
      processNewLines(filePath);
    }
  });

  _watcher.on('error', (err) => {
    log.error('Watcher error', { error: err.message });
    // Try to recover by re-watching
    setTimeout(() => {
      if (_running && _currentFile) watchFile(_currentFile);
    }, 1000);
  });
}

/**
 * Start the transcript stream. Finds the current transcript and watches it.
 * Also periodically checks for newer transcript files (session restarts).
 */
export function startTranscriptStream(): void {
  if (_running) return;
  _running = true;

  const transcriptPath = getNewestTranscript();
  if (transcriptPath) {
    watchFile(transcriptPath);
  } else {
    log.warn('No transcript file found, will check periodically');
  }

  // Check for newer transcript files every 10 seconds
  _checkInterval = setInterval(checkForNewerFile, 10_000);

  // Fallback poll every 2 seconds to catch missed fs.watch events
  _pollInterval = setInterval(pollForChanges, 2_000);

  log.info('Transcript stream started');
}

/**
 * Stop the transcript stream and clean up watchers.
 */
export function stopTranscriptStream(): void {
  _running = false;

  if (_watcher) {
    _watcher.close();
    _watcher = null;
  }

  if (_checkInterval) {
    clearInterval(_checkInterval);
    _checkInterval = null;
  }

  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }

  log.info('Transcript stream stopped');
}
