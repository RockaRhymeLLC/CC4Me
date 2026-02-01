/**
 * Config loader — reads cc4me.config.yaml and provides typed access.
 * Single source of truth for all daemon configuration.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// ── Config types ─────────────────────────────────────────────

export interface AgentConfig {
  name: string;
}

export interface TmuxConfig {
  session: string;
  socket?: string;
}

export interface LogRotationConfig {
  max_size_mb: number;
  max_files: number;
}

export interface DaemonConfig {
  port: number;
  log_level: 'debug' | 'info' | 'warn' | 'error';
  log_dir: string;
  log_rotation: LogRotationConfig;
}

export interface TelegramChannelConfig {
  enabled: boolean;
  webhook_path: string;
}

export interface EmailProviderConfig {
  type: 'graph' | 'jmap';
}

export interface EmailChannelConfig {
  enabled: boolean;
  providers: EmailProviderConfig[];
}

export interface ChannelsConfig {
  telegram: TelegramChannelConfig;
  email: EmailChannelConfig;
}

export interface TaskScheduleConfig {
  name: string;
  enabled: boolean;
  interval?: string;   // e.g. "3m", "15m", "1h"
  cron?: string;       // standard cron expression
  config?: Record<string, unknown>;
}

export interface SchedulerConfig {
  tasks: TaskScheduleConfig[];
}

export interface SecurityConfig {
  safe_senders_file: string;
}

export interface CC4MeConfig {
  agent: AgentConfig;
  tmux: TmuxConfig;
  daemon: DaemonConfig;
  channels: ChannelsConfig;
  scheduler: SchedulerConfig;
  security: SecurityConfig;
}

// ── Defaults ─────────────────────────────────────────────────

const DEFAULTS: CC4MeConfig = {
  agent: { name: 'Assistant' },
  tmux: { session: 'assistant' },
  daemon: {
    port: 3847,
    log_level: 'info',
    log_dir: 'logs',
    log_rotation: { max_size_mb: 10, max_files: 5 },
  },
  channels: {
    telegram: { enabled: false, webhook_path: '/telegram' },
    email: { enabled: false, providers: [] },
  },
  scheduler: { tasks: [] },
  security: { safe_senders_file: '.claude/state/safe-senders.json' },
};

// ── Loader ───────────────────────────────────────────────────

let _config: CC4MeConfig | null = null;
let _projectDir: string = '';

/**
 * Parse an interval string like "3m", "15m", "1h", "30s" into milliseconds.
 */
export function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)(s|m|h)$/);
  if (!match) throw new Error(`Invalid interval format: "${interval}" (use e.g. "3m", "30s", "1h")`);
  const [, num, unit] = match;
  const value = parseInt(num!, 10);
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    default: throw new Error(`Unknown unit: ${unit}`);
  }
}

/**
 * Deep merge two objects. Source values override target.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result;
}

/**
 * Load config from cc4me.config.yaml. Caches after first load.
 * Call with projectDir on startup; subsequent calls return cached config.
 */
export function loadConfig(projectDir?: string): CC4MeConfig {
  if (_config) return _config;

  const dir = projectDir ?? process.cwd();
  _projectDir = dir;

  const configPath = path.join(dir, 'cc4me.config.yaml');
  if (!fs.existsSync(configPath)) {
    console.warn(`No cc4me.config.yaml found at ${configPath}, using defaults`);
    _config = DEFAULTS;
    return _config;
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = yaml.load(raw) as Partial<CC4MeConfig>;

  _config = deepMerge(DEFAULTS as unknown as Record<string, unknown>, parsed as Record<string, unknown>) as unknown as CC4MeConfig;

  // Auto-detect tmux socket if not specified
  if (!_config.tmux.socket) {
    _config.tmux.socket = `/private/tmp/tmux-${process.getuid?.() ?? 502}/default`;
  }

  return _config;
}

/**
 * Get the project root directory (where cc4me.config.yaml lives).
 */
export function getProjectDir(): string {
  return _projectDir;
}

/**
 * Resolve a relative path against the project directory.
 */
export function resolveProjectPath(...segments: string[]): string {
  return path.resolve(_projectDir, ...segments);
}
