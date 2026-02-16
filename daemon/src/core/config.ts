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
  type: 'graph' | 'jmap' | 'himalaya' | 'outlook';
  account?: string;  // For himalaya: 'gmail' or 'outlook'
}

export interface EmailTriageConfig {
  enabled: boolean;
  vip: string[];
  junk: string[];
  newsletters: string[];
  receipts: string[];
  auto_read: string[];
}

export interface EmailChannelConfig {
  enabled: boolean;
  providers: EmailProviderConfig[];
  triage?: EmailTriageConfig;
}

export interface VoiceSttConfig {
  engine: string;        // e.g. 'whisper-cpp'
  model: string;         // e.g. 'small.en'
  language: string;
}

export interface VoiceTtsConfig {
  engine: string;        // e.g. 'qwen3-tts-mlx'
  model: string;         // e.g. 'Qwen/Qwen3-TTS-0.6B'
  voice: string;
  speed: number;
}

export interface VoiceWakeWordConfig {
  engine: string;        // e.g. 'openwakeword'
  phrase: string;        // e.g. 'Hey Assistant'
}

export interface VoiceClientConfig {
  listen_after_response: number;   // seconds of conversation mode
  chime_timeout: number;           // seconds to wait for voice confirmation
  confirmation_phrases: string[];
  rejection_phrases: string[];
}

export interface VoiceInitiationConfig {
  calendar_reminders: boolean;
  urgent_emails: boolean;
  todo_nudges: boolean;
}

export interface VoiceChannelConfig {
  enabled: boolean;
  stt: VoiceSttConfig;
  tts: VoiceTtsConfig;
  wake_word: VoiceWakeWordConfig;
  client: VoiceClientConfig;
  initiation: VoiceInitiationConfig;
}

export interface ChannelsConfig {
  telegram: TelegramChannelConfig;
  email: EmailChannelConfig;
  voice?: VoiceChannelConfig;
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

export interface RateLimitsConfig {
  incoming_max_per_minute: number;
  outgoing_max_per_minute: number;
}

export interface AgentCommsPeerConfig {
  name: string;
  host: string;
  port: number;
  ip?: string;             // Optional fallback IP when DNS fails
}

export interface AgentCommsConfig {
  enabled: boolean;
  secret: string;          // Keychain reference, e.g. "keychain:credential-agent-comms-secret"
  peers: AgentCommsPeerConfig[];
}

// ── Agent message types ───────────────────────────────────────

export interface AgentMessage {
  from: string;            // Agent name
  type: 'text' | 'status' | 'coordination' | 'pr-review';
  text?: string;           // For text messages
  status?: 'idle' | 'busy' | 'offline';           // For status messages
  action?: 'claim' | 'release';                    // For coordination messages
  task?: string;           // For coordination messages
  context?: string;        // Optional context/metadata
  callbackUrl?: string;    // Optional URL to POST response to
  timestamp: string;       // ISO 8601
  messageId: string;       // UUID for dedup/tracking
  repo?: string;           // For pr-review messages
  branch?: string;         // For pr-review messages
  pr?: number;             // For pr-review messages
}

export interface AgentMessageResponse {
  ok: boolean;
  queued: boolean;         // true if agent is busy and message was queued
  error?: string;
}

export interface SecurityConfig {
  safe_senders_file: string;
  third_party_senders_file: string;
  rate_limits: RateLimitsConfig;
}

export interface BrowserbaseConfig {
  enabled: boolean;
  sidecar_port: number;
  default_timeout: number;
  idle_warning: number;
  handoff_timeout: number;
  handoff_session_timeout: number;
  block_ads: boolean;
  solve_captchas: boolean;
  record_sessions: boolean;
}

export interface IntegrationsConfig {
  browserbase?: BrowserbaseConfig;
}

export interface NetworkConfig {
  enabled: boolean;
  relay_url: string;
  owner_email?: string;
}

export interface CC4MeConfig {
  agent: AgentConfig;
  tmux: TmuxConfig;
  daemon: DaemonConfig;
  channels: ChannelsConfig;
  'agent-comms': AgentCommsConfig;
  network?: NetworkConfig;
  scheduler: SchedulerConfig;
  security: SecurityConfig;
  integrations?: IntegrationsConfig;
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
    voice: {
      enabled: false,
      stt: { engine: 'whisper-cpp', model: 'small.en', language: 'en' },
      tts: { engine: 'qwen3-tts-mlx', model: 'Qwen/Qwen3-TTS-0.6B', voice: 'default', speed: 1.0 },
      wake_word: { engine: 'openwakeword', phrase: 'Hey Assistant' },
      client: {
        listen_after_response: 3,
        chime_timeout: 5,
        confirmation_phrases: ['yeah', 'yes', "what's up", 'go ahead', 'what', 'hey'],
        rejection_phrases: ['not now', 'later', 'no', 'busy'],
      },
      initiation: { calendar_reminders: true, urgent_emails: true, todo_nudges: false },
    },
  },
  'agent-comms': {
    enabled: false,
    secret: '',
    peers: [],
  },
  scheduler: { tasks: [] },
  security: {
    safe_senders_file: '.claude/state/safe-senders.json',
    third_party_senders_file: '.claude/state/3rd-party-senders.json',
    rate_limits: { incoming_max_per_minute: 5, outgoing_max_per_minute: 10 },
  },
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
