/**
 * STT (Speech-to-Text) — whisper.cpp wrapper.
 *
 * Accepts a WAV file path, invokes whisper-cli with Metal acceleration
 * and greedy decoding (beam_size=1 — required on M4, see whisper.cpp #3493),
 * and returns the transcribed text.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../core/logger.js';
import { loadConfig, getProjectDir } from '../core/config.js';

const log = createLogger('stt');

const WHISPER_CLI = '/opt/homebrew/bin/whisper-cli';
const TRANSCRIBE_TIMEOUT_MS = 30_000; // 30s max for any transcription

/**
 * Resolve the model path from config.
 * Looks in <projectDir>/models/ for ggml-<model>.bin
 */
function getModelPath(): string {
  const config = loadConfig();
  const modelName = config.channels.voice?.stt?.model ?? 'small.en';
  return path.join(getProjectDir(), 'models', `ggml-${modelName}.bin`);
}

/**
 * Transcribe a WAV file to text using whisper.cpp.
 *
 * @param wavPath - Absolute path to a WAV audio file
 * @returns Transcribed text (trimmed, no timestamps)
 * @throws Error if whisper-cli not found, model missing, or transcription fails
 */
export function transcribe(wavPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Validate inputs
    if (!fs.existsSync(wavPath)) {
      return reject(new Error(`Audio file not found: ${wavPath}`));
    }

    if (!fs.existsSync(WHISPER_CLI)) {
      return reject(new Error(
        `whisper-cli not found at ${WHISPER_CLI}. Install via: brew install whisper-cpp`
      ));
    }

    const modelPath = getModelPath();
    if (!fs.existsSync(modelPath)) {
      return reject(new Error(
        `Whisper model not found at ${modelPath}. Download from https://huggingface.co/ggerganov/whisper.cpp`
      ));
    }

    const config = loadConfig();
    const language = config.channels.voice?.stt?.language ?? 'en';

    const args = [
      '-m', modelPath,
      '-f', wavPath,
      '-l', language,
      '--beam-size', '1',       // Greedy decoding — required on M4 (whisper.cpp #3493)
      '--no-timestamps',
      '--no-prints',            // Suppress model loading info, only output text
    ];

    const startTime = Date.now();

    execFile(WHISPER_CLI, args, { timeout: TRANSCRIBE_TIMEOUT_MS }, (err, stdout, stderr) => {
      const elapsed = Date.now() - startTime;

      if (err) {
        log.error('Transcription failed', {
          error: err.message,
          stderr: stderr?.trim(),
          elapsed: `${elapsed}ms`,
        });
        return reject(new Error(`Transcription failed: ${err.message}`));
      }

      // Clean up output: trim whitespace, remove any stray newlines
      const text = stdout.trim();

      log.info('Transcription complete', {
        elapsed: `${elapsed}ms`,
        chars: text.length,
        preview: text.slice(0, 80),
      });

      resolve(text);
    });
  });
}
