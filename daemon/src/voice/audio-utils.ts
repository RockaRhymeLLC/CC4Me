/**
 * Audio utilities — temp file management for voice processing.
 *
 * Incoming audio is written to temp files for whisper.cpp to process,
 * then cleaned up after transcription completes.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createLogger } from '../core/logger.js';

const log = createLogger('audio-utils');

const TEMP_PREFIX = 'cc4me-voice-';

/**
 * Save audio data to a temp file. Returns the absolute path.
 */
export function saveTempAudio(buffer: Buffer, extension = '.wav'): string {
  const id = crypto.randomBytes(8).toString('hex');
  const filename = `${TEMP_PREFIX}${id}${extension}`;
  const filepath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(filepath, buffer);
  log.debug('Saved temp audio', { filepath, bytes: buffer.length });
  return filepath;
}

/**
 * Delete a temp audio file. Safe to call even if file doesn't exist.
 */
export function cleanupTemp(filepath: string): void {
  try {
    fs.unlinkSync(filepath);
    log.debug('Cleaned up temp file', { filepath });
  } catch {
    // File already gone or never existed — that's fine
  }
}
