/**
 * Structured JSON logger with file rotation.
 * All daemon modules log through this instead of ad-hoc console/echo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, resolveProjectPath } from './config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  msg: string;
  data?: Record<string, unknown>;
}

let _logDir: string = '';
let _minLevel: LogLevel = 'info';
let _maxSizeMB = 10;
let _maxFiles = 5;
let _initialized = false;

/**
 * Initialize the logger from config. Call once at daemon start.
 */
export function initLogger(): void {
  const config = loadConfig();
  _logDir = resolveProjectPath(config.daemon.log_dir);
  _minLevel = config.daemon.log_level;
  _maxSizeMB = config.daemon.log_rotation.max_size_mb;
  _maxFiles = config.daemon.log_rotation.max_files;

  fs.mkdirSync(_logDir, { recursive: true });
  _initialized = true;
}

function getLogFile(): string {
  return path.join(_logDir, 'daemon.log');
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[_minLevel];
}

/**
 * Rotate logs if the current file exceeds the size limit.
 */
function rotateIfNeeded(): void {
  const logFile = getLogFile();
  if (!fs.existsSync(logFile)) return;

  const stats = fs.statSync(logFile);
  if (stats.size < _maxSizeMB * 1024 * 1024) return;

  // Rotate: daemon.log -> daemon.log.1 -> daemon.log.2 -> ...
  for (let i = _maxFiles - 1; i >= 1; i--) {
    const src = `${logFile}.${i}`;
    const dst = `${logFile}.${i + 1}`;
    if (fs.existsSync(src)) {
      if (i + 1 >= _maxFiles) {
        fs.unlinkSync(src);
      } else {
        fs.renameSync(src, dst);
      }
    }
  }
  fs.renameSync(logFile, `${logFile}.1`);
}

function writeLog(entry: LogEntry): void {
  if (!_initialized) {
    // Fallback before init
    console.log(`[${entry.level}] ${entry.module}: ${entry.msg}`);
    return;
  }

  rotateIfNeeded();
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(getLogFile(), line);

  // Also echo to stdout for launchd capture
  if (entry.level === 'error') {
    console.error(`[${entry.level}] ${entry.module}: ${entry.msg}`);
  } else if (LEVEL_ORDER[entry.level] >= LEVEL_ORDER['info']) {
    console.log(`[${entry.level}] ${entry.module}: ${entry.msg}`);
  }
}

/**
 * Create a scoped logger for a specific module.
 */
export function createLogger(module: string) {
  return {
    debug(msg: string, data?: Record<string, unknown>) {
      if (shouldLog('debug')) writeLog({ ts: new Date().toISOString(), level: 'debug', module, msg, data });
    },
    info(msg: string, data?: Record<string, unknown>) {
      if (shouldLog('info')) writeLog({ ts: new Date().toISOString(), level: 'info', module, msg, data });
    },
    warn(msg: string, data?: Record<string, unknown>) {
      if (shouldLog('warn')) writeLog({ ts: new Date().toISOString(), level: 'warn', module, msg, data });
    },
    error(msg: string, data?: Record<string, unknown>) {
      if (shouldLog('error')) writeLog({ ts: new Date().toISOString(), level: 'error', module, msg, data });
    },
  };
}
