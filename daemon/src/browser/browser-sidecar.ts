/**
 * browser-sidecar.ts — Daemon-side lifecycle management for the browser sidecar process.
 *
 * Follows the TTS worker pattern: spawn child process, watch for READY signal,
 * health monitoring, auto-restart on crash, graceful shutdown.
 */

import { spawn, ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { createLogger } from '../core/logger.js';
import { loadConfig, getProjectDir } from '../core/config.js';

const log = createLogger('browser-sidecar');

const MAX_RETRIES = 3;
const STARTUP_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

let sidecar: ChildProcess | null = null;
let sidecarReady = false;
let retryCount = 0;
let startupResolve: (() => void) | null = null;
let healthInterval: ReturnType<typeof setInterval> | null = null;
let sidecarPort = 3849;

// ── Health Checks ────────────────────────────────────────────

function startHealthChecks(): void {
  stopHealthChecks();
  healthInterval = setInterval(async () => {
    try {
      const ok = await checkHealth();
      if (!ok) {
        log.warn('Browser sidecar health check failed');
      }
    } catch (err) {
      log.warn('Browser sidecar health check error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

function stopHealthChecks(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}

function checkHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), HEALTH_CHECK_TIMEOUT_MS);

    const req = http.get(`http://localhost:${sidecarPort}/health`, (res) => {
      clearTimeout(timer);
      resolve(res.statusCode === 200);
      res.resume(); // drain
    });

    req.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// ── Lifecycle ────────────────────────────────────────────────

export function startSidecar(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (sidecar && sidecarReady) {
      resolve();
      return;
    }

    const projectDir = getProjectDir();
    const mainJs = path.join(projectDir, 'browser-sidecar', 'dist', 'main.js');
    const config = loadConfig();

    sidecarPort = config.integrations?.browserbase?.sidecar_port ?? 3849;

    log.info('Starting browser sidecar', { script: mainJs, port: sidecarPort });

    const bbConfig = config.integrations?.browserbase;
    sidecar = spawn('node', [mainJs, `--port=${sidecarPort}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        STATE_DIR: path.join(projectDir, '.claude', 'state'),
        DAEMON_PORT: String(config.daemon.port),
        SESSION_TIMEOUT: String(bbConfig?.default_timeout ?? 300),
        SESSION_WARNING: String(Math.max(0, (bbConfig?.default_timeout ?? 300) - (bbConfig?.idle_warning ?? 240))),
        HANDOFF_SESSION_TIMEOUT: String(bbConfig?.handoff_session_timeout ?? 1800),
        HANDOFF_IDLE_WARN: String(Math.floor((bbConfig?.handoff_timeout ?? 300) * 0.6)),
        HANDOFF_IDLE_TIMEOUT: String(bbConfig?.handoff_timeout ?? 300),
      },
    });

    startupResolve = resolve;

    // Watch stdout for READY signal
    sidecar.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line === 'READY') {
          log.info('Browser sidecar ready');
          sidecarReady = true;
          retryCount = 0;
          startHealthChecks();
          if (startupResolve) {
            startupResolve();
            startupResolve = null;
          }
        } else {
          log.debug('Browser sidecar stdout', { msg: line });
        }
      }
    });

    // Log stderr
    sidecar.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) log.debug('Browser sidecar stderr', { msg: line });
    });

    // Handle crash
    sidecar.on('exit', (code) => {
      log.warn('Browser sidecar exited', { code, retryCount });
      sidecarReady = false;
      sidecar = null;
      stopHealthChecks();

      if (startupResolve) {
        startupResolve = null;
        reject(new Error(`Browser sidecar exited during startup with code ${code}`));
        return;
      }

      // Auto-restart if under retry limit
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        log.info('Restarting browser sidecar', { attempt: retryCount });
        startSidecar().catch((err) => {
          log.error('Browser sidecar restart failed', { error: err.message });
        });
      } else {
        log.error('Browser sidecar max retries reached, giving up');
      }
    });

    // Startup timeout
    setTimeout(() => {
      if (!sidecarReady && startupResolve) {
        log.error('Browser sidecar startup timeout');
        startupResolve = null;
        stopSidecar();
        reject(new Error('Browser sidecar startup timed out'));
      }
    }, STARTUP_TIMEOUT_MS);
  });
}

export function stopSidecar(): void {
  stopHealthChecks();
  if (sidecar) {
    log.info('Stopping browser sidecar');
    sidecar.kill('SIGTERM');
    sidecar = null;
    sidecarReady = false;
  }
}

export function isSidecarReady(): boolean {
  return sidecarReady;
}

export function getSidecarPort(): number {
  return sidecarPort;
}

// ── Init (called from daemon main.ts) ────────────────────────

export async function initBrowserSidecar(): Promise<void> {
  const config = loadConfig();
  if (config.integrations?.browserbase?.enabled) {
    startSidecar().catch((err) => {
      log.error('Browser sidecar failed to start', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  } else {
    log.info('Browser sidecar disabled in config');
  }
}

export function stopBrowserSidecar(): void {
  stopSidecar();
}
