/**
 * Extended status — gathers comprehensive agent/daemon state for the ops dashboard.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, getProjectDir } from './config.js';
import { sessionExists } from './session-bridge.js';
import { runHealthCheck } from './health.js';
import { getEmailProviders } from '../comms/adapters/email/index.js';
import { listTasks } from '../automation/scheduler.js';

const execFileAsync = promisify(execFile);

interface TodoItem {
  id: string;
  title: string;
  priority: string;
  status: string;
}

interface TodoCounts {
  open: number;
  inProgress: number;
  blocked: number;
  items: TodoItem[];
}

interface CommitInfo {
  hash: string;
  message: string;
  time: string;
}

interface ServiceStatus {
  name: string;
  status: 'ok' | 'degraded' | 'down';
  detail?: string;
}

interface TaskInfo {
  name: string;
  lastRun: number;
  nextRun?: number;
  interval?: string;
  cron?: string;
}

interface GitStatus {
  branch: string;
  aheadOfOrigin: number;
  dirty: boolean;
}

interface ContextUsage {
  usedPercent: number;
  remainingPercent: number;
}

interface PeerSyncInfo {
  lastSentAt: string;
  lastReceivedAt: string;
  sentCount: number;
  receivedCount: number;
}

interface MemoryStats {
  totalLocal: number;
  peers: Record<string, PeerSyncInfo>;
}

export interface ExtendedStatus {
  agent: string;
  uptime: number;
  session: 'active' | 'idle' | 'stopped';
  channel: string;
  timestamp: string;
  health: { ok: number; warn: number; error: number };
  todos: TodoCounts;
  commits: CommitInfo[];
  services: ServiceStatus[];
  scheduler: { tasks: number; running: string[]; schedule: TaskInfo[] };
  git?: GitStatus;
  context?: ContextUsage;
  memory?: MemoryStats;
}

function getTodoCounts(): TodoCounts {
  const todosDir = path.join(getProjectDir(), '.claude', 'state', 'todos');
  const counts: TodoCounts = { open: 0, inProgress: 0, blocked: 0, items: [] };

  try {
    const files = fs.readdirSync(todosDir).filter(f => f.endsWith('.json') && !f.startsWith('.'));
    for (const file of files) {
      if (file.includes('-completed-')) continue;

      if (file.includes('-open-')) counts.open++;
      else if (file.includes('-in-progress-')) counts.inProgress++;
      else if (file.includes('-blocked-')) counts.blocked++;

      // Parse the file to get title and details
      try {
        const data = JSON.parse(fs.readFileSync(path.join(todosDir, file), 'utf8'));
        counts.items.push({
          id: data.id ?? file.match(/\d{3}/)?.[0] ?? '?',
          title: data.title ?? 'Untitled',
          priority: data.priority ?? 'medium',
          status: data.status ?? 'open',
        });
      } catch { /* skip malformed */ }
    }
  } catch {
    // Todos dir might not exist
  }

  return counts;
}

async function getRecentCommits(limit = 3): Promise<CommitInfo[]> {
  try {
    const { stdout } = await execFileAsync('git', [
      'log', `--max-count=${limit}`, '--format=%h|%s|%aI',
    ], {
      cwd: getProjectDir(),
      encoding: 'utf8',
      timeout: 5000,
    });

    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const [hash, message, time] = line.split('|');
      return { hash: hash!, message: message!, time: time! };
    });
  } catch {
    return [];
  }
}

async function getGitStatus(): Promise<GitStatus | undefined> {
  const cwd = getProjectDir();
  try {
    const [branchResult, aheadResult, statusResult] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', timeout: 3000 }),
      execFileAsync('git', ['rev-list', '--count', 'origin/main..HEAD'], { cwd, encoding: 'utf8', timeout: 3000 }).catch(() => ({ stdout: '0' })),
      execFileAsync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8', timeout: 3000 }),
    ]);

    return {
      branch: branchResult.stdout.trim(),
      aheadOfOrigin: parseInt(aheadResult.stdout.trim(), 10) || 0,
      dirty: statusResult.stdout.trim().length > 0,
    };
  } catch {
    return undefined;
  }
}

function getContextUsage(): ContextUsage | undefined {
  try {
    const filePath = path.join(getProjectDir(), '.claude', 'state', 'context-usage.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // Only report if data is recent (within 5 minutes)
    const age = (Date.now() / 1000) - (data.timestamp || 0);
    if (age > 300) return undefined;
    return {
      usedPercent: data.used_percentage ?? 0,
      remainingPercent: data.remaining_percentage ?? 100,
    };
  } catch {
    return undefined;
  }
}

function getMemoryStats(): MemoryStats | undefined {
  const memoriesDir = path.join(getProjectDir(), '.claude', 'state', 'memory', 'memories');
  const syncStatePath = path.join(getProjectDir(), '.claude', 'state', 'memory', 'sync-state.json');

  try {
    const files = fs.readdirSync(memoriesDir).filter(f => f.endsWith('.md'));
    const totalLocal = files.length;

    let peers: Record<string, PeerSyncInfo> = {};
    try {
      peers = JSON.parse(fs.readFileSync(syncStatePath, 'utf-8'));
    } catch {
      // No sync state yet
    }

    return { totalLocal, peers };
  } catch {
    return undefined;
  }
}

function getServiceStatuses(): ServiceStatus[] {
  const config = loadConfig();
  const services: ServiceStatus[] = [];

  // Telegram
  services.push({
    name: 'telegram',
    status: config.channels.telegram.enabled ? 'ok' : 'down',
    detail: config.channels.telegram.enabled ? 'enabled' : 'disabled',
  });

  // Email providers
  try {
    const providers = getEmailProviders();
    services.push({
      name: 'email',
      status: providers.length > 0 ? 'ok' : 'down',
      detail: `${providers.length} provider(s): ${providers.map(p => p.name).join(', ')}`,
    });
  } catch {
    services.push({ name: 'email', status: 'down', detail: 'failed to load' });
  }

  // Voice
  services.push({
    name: 'voice',
    status: config.channels.voice?.enabled ? 'ok' : 'down',
    detail: config.channels.voice?.enabled ? 'enabled' : 'disabled',
  });

  // Agent comms
  services.push({
    name: 'agent-comms',
    status: config['agent-comms'].enabled ? 'ok' : 'down',
    detail: config['agent-comms'].enabled
      ? `${config['agent-comms'].peers.length} peer(s)`
      : 'disabled',
  });

  return services;
}

export async function getExtendedStatus(): Promise<ExtendedStatus> {
  const config = loadConfig();

  // Run health check
  const healthReport = await runHealthCheck();
  const healthSummary = { ok: 0, warn: 0, error: 0 };
  for (const r of healthReport.results) {
    if (r.severity === 'ok') healthSummary.ok++;
    else if (r.severity === 'warn') healthSummary.warn++;
    else if (r.severity === 'error') healthSummary.error++;
  }

  // Determine session state
  let session: 'active' | 'idle' | 'stopped' = 'stopped';
  if (sessionExists()) {
    session = 'active'; // Always active if session exists — busy detection removed
  }

  // Gather all data
  const [commits, git] = await Promise.all([
    getRecentCommits(),
    getGitStatus(),
  ]);

  const schedulerTasks = listTasks();
  const context = getContextUsage();
  const memory = getMemoryStats();

  // Read current channel
  let channel = 'unknown';
  try {
    channel = fs.readFileSync(path.join(getProjectDir(), '.claude', 'state', 'channel.txt'), 'utf8').trim();
  } catch { /* default to unknown */ }

  return {
    agent: config.agent.name,
    uptime: process.uptime(),
    session,
    channel,
    timestamp: new Date().toISOString(),
    health: healthSummary,
    todos: getTodoCounts(),
    commits,
    services: getServiceStatuses(),
    scheduler: {
      tasks: schedulerTasks.length,
      running: schedulerTasks.filter(t => t.lastRun > 0).map(t => t.name),
      schedule: schedulerTasks,
    },
    ...(git && { git }),
    ...(context && { context }),
    ...(memory && { memory }),
  };
}
