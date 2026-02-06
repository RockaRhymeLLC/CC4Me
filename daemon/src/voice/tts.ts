/**
 * TTS (Text-to-Speech) — Qwen3-TTS via persistent Python worker.
 *
 * Manages the tts-worker.py lifecycle (start, health-check, restart)
 * and provides synthesize() to convert text to WAV audio.
 */

import { spawn, ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { createLogger } from '../core/logger.js';
import { loadConfig, getProjectDir } from '../core/config.js';

const log = createLogger('tts');

const WORKER_PORT = 3848;
const MAX_RETRIES = 3;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const STARTUP_TIMEOUT_MS = 120_000; // Model loading can be slow first time
const SYNTHESIZE_TIMEOUT_MS = 60_000;

let worker: ChildProcess | null = null;
let workerReady = false;
let retryCount = 0;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let startupResolve: (() => void) | null = null;
let synthesizing = false;

/**
 * Get the path to the tts-worker.py script.
 */
function getWorkerScript(): string {
  return path.join(getProjectDir(), 'daemon', 'src', 'voice', 'tts-worker.py');
}

/**
 * Get the model ID from config.
 */
function getModelId(): string {
  const config = loadConfig();
  const engine = config.channels.voice?.tts?.engine ?? 'qwen3-tts-mlx';
  // Map config model names to HuggingFace model IDs
  if (engine === 'qwen3-tts-mlx') {
    return 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16';
  }
  return config.channels.voice?.tts?.model ?? 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16';
}

/**
 * Start the TTS worker process.
 */
export function startWorker(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (worker && workerReady) {
      resolve();
      return;
    }

    const script = getWorkerScript();
    const modelId = getModelId();

    log.info('Starting TTS worker', { script, model: modelId, port: WORKER_PORT });

    const pythonBin = path.join(getProjectDir(), 'daemon', 'src', 'voice', '.venv', 'bin', 'python3');
    worker = spawn(pythonBin, [
      script,
      '--port', String(WORKER_PORT),
      '--model', modelId,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    startupResolve = resolve;

    // Watch stdout for READY signal
    worker.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('READY')) {
          log.info('TTS worker ready', { line });
          workerReady = true;
          retryCount = 0;
          startHealthChecks();
          if (startupResolve) {
            startupResolve();
            startupResolve = null;
          }
        }
      }
    });

    // Log stderr
    worker.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) log.debug('TTS worker', { msg: line });
    });

    // Handle crash
    worker.on('exit', (code) => {
      log.warn('TTS worker exited', { code, retryCount });
      workerReady = false;
      worker = null;
      stopHealthChecks();

      if (startupResolve) {
        startupResolve = null;
        reject(new Error(`TTS worker exited during startup with code ${code}`));
        return;
      }

      // Auto-restart if under retry limit
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        log.info('Restarting TTS worker', { attempt: retryCount });
        startWorker().catch((err) => {
          log.error('TTS worker restart failed', { error: err.message });
        });
      } else {
        log.error('TTS worker max retries reached, giving up');
      }
    });

    // Startup timeout
    setTimeout(() => {
      if (!workerReady && startupResolve) {
        log.error('TTS worker startup timeout');
        startupResolve = null;
        stopWorker();
        reject(new Error('TTS worker startup timed out'));
      }
    }, STARTUP_TIMEOUT_MS);
  });
}

/**
 * Stop the TTS worker process.
 */
export function stopWorker(): void {
  stopHealthChecks();
  if (worker) {
    log.info('Stopping TTS worker');
    worker.kill('SIGTERM');
    worker = null;
    workerReady = false;
  }
}

/**
 * Check if the worker is running and healthy.
 */
async function checkHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: WORKER_PORT,
      path: '/health',
      method: 'GET',
      timeout: HEALTH_CHECK_TIMEOUT_MS,
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        resolve(res.statusCode === 200);
      });
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function startHealthChecks(): void {
  if (healthTimer) return;
  healthTimer = setInterval(async () => {
    if (synthesizing) return; // Don't health-check during synthesis — worker is single-threaded
    const healthy = await checkHealth();
    if (!healthy && workerReady) {
      log.warn('TTS worker health check failed');
      workerReady = false;
      // The exit handler will trigger restart
      if (worker) worker.kill('SIGTERM');
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

function stopHealthChecks(): void {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

/**
 * Synthesize text to WAV audio.
 *
 * @param text - Text to synthesize
 * @returns Buffer containing WAV audio data
 * @throws Error if worker not running or synthesis fails
 */
export function synthesize(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!workerReady) {
      return reject(new Error('TTS worker is not running'));
    }

    const config = loadConfig();
    const rawVoice = config.channels.voice?.tts?.voice ?? 'default';
    // Map "default" to the default speaker; normalize to lowercase for the model
    const voice = rawVoice === 'default' ? 'aiden' : rawVoice.toLowerCase();

    const body = JSON.stringify({ text, voice });

    synthesizing = true;

    const req = http.request({
      hostname: '127.0.0.1',
      port: WORKER_PORT,
      path: '/synthesize',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: SYNTHESIZE_TIMEOUT_MS,
    }, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        synthesizing = false;
        const data = Buffer.concat(chunks);

        if (res.statusCode !== 200) {
          try {
            const err = JSON.parse(data.toString());
            reject(new Error(err.error || 'Synthesis failed'));
          } catch {
            reject(new Error(`Synthesis failed with status ${res.statusCode}`));
          }
          return;
        }

        const elapsed = res.headers['x-synthesis-time-ms'];
        log.info('TTS synthesis complete', {
          chars: text.length,
          audioBytes: data.length,
          elapsed: elapsed ? `${elapsed}ms` : 'unknown',
        });

        resolve(data);
      });
    });

    req.on('error', (err) => { synthesizing = false; reject(new Error(`TTS request failed: ${err.message}`)); });
    req.on('timeout', () => { synthesizing = false; req.destroy(); reject(new Error('TTS request timed out')); });
    req.end(body);
  });
}
