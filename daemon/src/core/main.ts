/**
 * CC4Me Daemon — single entry point.
 *
 * Starts the HTTP server, initializes all modules based on config,
 * and serves as the unified runtime for comms + automation.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig, getProjectDir } from './config.js';
import { initLogger, createLogger } from './logger.js';
import { runHealthCheck, formatReport } from './health.js';
import { validateAgentCommsAuth } from './keychain.js';
import { sessionExists, injectText, updateAgentState } from './session-bridge.js';

// Comms imports (Phase 2)
import { startTranscriptStream, stopTranscriptStream, onHookNotification } from '../comms/transcript-stream.js';
import { initChannelRouter } from '../comms/channel-router.js';
import { createTelegramRouter } from '../comms/adapters/telegram.js';

// Agent comms imports
import { initAgentComms, stopAgentComms, handleAgentMessage, getAgentStatus, sendAgentMessage } from '../comms/agent-comms.js';

// Voice imports
import { handleVoiceRequest, initVoiceServer, stopVoiceServer } from '../voice/voice-server.js';

// Browser sidecar imports
import { initBrowserSidecar, stopBrowserSidecar } from '../browser/browser-sidecar.js';
import { activateHandoff, deactivateHandoff, isHandoffActive, sendMessage as sendTelegramMessage } from '../comms/adapters/telegram.js';

// Automation imports (Phase 3)
import { startScheduler, stopScheduler, runTaskByName, getTaskList } from '../automation/scheduler.js';

// Task registrations — importing these files causes registerTask() calls
import '../automation/tasks/context-watchdog.js';
import '../automation/tasks/todo-reminder.js';
import '../automation/tasks/email-check.js';
import '../automation/tasks/nightly-todo.js';
import '../automation/tasks/health-check.js';
import '../automation/tasks/memory-consolidation.js';
import '../automation/tasks/approval-audit.js';
import '../automation/tasks/morning-briefing.js';
import '../automation/tasks/upstream-sync.js';
import '../automation/tasks/peer-heartbeat.js';
import '../automation/tasks/backup.js';

// ── Bootstrap ────────────────────────────────────────────────

const projectDir = path.resolve(process.argv[2] ?? process.cwd());

const config = loadConfig(projectDir);
initLogger();

const log = createLogger('main');

log.info(`CC4Me daemon starting`, {
  agent: config.agent.name,
  port: config.daemon.port,
  projectDir,
});

// ── Retry To-Do Creation ─────────────────────────────────────

/**
 * Create a to-do programmatically when a hand-off times out,
 * so the assistant can retry the browser task later.
 */
function createRetryTodo(url?: string, contextName?: string): void {
  if (!url) return; // Nothing to retry without a URL

  const todosDir = path.join(getProjectDir(), '.claude', 'state', 'todos');
  const counterPath = path.join(todosDir, '.counter');

  try {
    // Read and increment counter
    let counter = 1;
    try {
      counter = parseInt(fs.readFileSync(counterPath, 'utf-8').trim(), 10) || 1;
    } catch { /* first todo */ }

    const id = String(counter).padStart(3, '0');
    const slug = `retry-browser-${(contextName ?? 'session').replace(/[^a-z0-9]/gi, '-').toLowerCase()}`.slice(0, 30);
    const filename = `3-medium-open-${id}-${slug}.json`;
    const now = new Date().toISOString();

    const todo = {
      id,
      title: `Retry browser task: ${url}`,
      description: `Hand-off timed out before the human could complete it. Retry browsing ${url}${contextName ? ` (context: ${contextName})` : ''} when the human is available.`,
      priority: 'medium',
      status: 'open',
      created: now,
      updated: now,
      actions: [
        {
          type: 'created',
          timestamp: now,
          note: `Auto-created by daemon: hand-off idle timeout on ${url}`,
        },
      ],
    };

    fs.writeFileSync(path.join(todosDir, filename), JSON.stringify(todo, null, 2));
    fs.writeFileSync(counterPath, String(counter + 1));
    log.info('Created retry to-do for timed-out hand-off', { id, url });
  } catch (err) {
    log.error('Failed to create retry to-do', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Extended Status ───────────────────────────────────────────

interface ExtendedStatus {
  agent: string;
  timestamp: string;
  uptime: string;
  health: 'ok' | 'warn' | 'error';
  todos: { open: number; inProgress: number; blocked: number };
  commits: Array<{ hash: string; msg: string; time: string }>;
  services: Array<{ name: string; status: string }>;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(' ');
}

function countTodos(): { open: number; inProgress: number; blocked: number } {
  const todosDir = path.join(getProjectDir(), '.claude', 'state', 'todos');
  const counts = { open: 0, inProgress: 0, blocked: 0 };

  try {
    const files = fs.readdirSync(todosDir).filter(f => f.endsWith('.json') && !f.startsWith('.'));
    for (const file of files) {
      // Parse status from filename: {priority}-{status}-{id}-{slug}.json
      const parts = file.split('-');
      if (parts.length >= 2) {
        const status = parts[1];
        if (status === 'open') counts.open++;
        else if (status === 'in' || status === 'inProgress') counts.inProgress++;
        else if (status === 'blocked') counts.blocked++;
        // 'completed' todos are not counted
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return counts;
}

function getRecentCommits(): Array<{ hash: string; msg: string; time: string }> {
  try {
    const output = execSync(
      'git log -3 --pretty=format:"%h|%s|%ci"',
      { cwd: getProjectDir(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!output) return [];

    return output.split('\n').map(line => {
      const [hash, msg, time] = line.split('|');
      return { hash: hash ?? '', msg: msg ?? '', time: time ?? '' };
    });
  } catch {
    return [];
  }
}

function getServiceStatuses(): Array<{ name: string; status: string }> {
  const services: Array<{ name: string; status: string }> = [];

  // tmux session
  services.push({
    name: 'tmux',
    status: sessionExists() ? 'active' : 'stopped',
  });

  // Telegram
  services.push({
    name: 'telegram',
    status: config.channels.telegram.enabled ? 'enabled' : 'disabled',
  });

  // Agent comms
  services.push({
    name: 'agent-comms',
    status: config['agent-comms']?.enabled ? 'enabled' : 'disabled',
  });

  // Scheduler
  services.push({
    name: 'scheduler',
    status: 'running',  // If we're responding, scheduler is running
  });

  return services;
}

async function getExtendedStatus(): Promise<ExtendedStatus> {
  // Get health summary
  const healthReport = await runHealthCheck();
  let health: 'ok' | 'warn' | 'error' = 'ok';
  if (healthReport.summary.errors > 0) health = 'error';
  else if (healthReport.summary.warnings > 0) health = 'warn';

  return {
    agent: config.agent.name,
    timestamp: new Date().toISOString(),
    uptime: formatUptime(process.uptime()),
    health,
    todos: countTodos(),
    commits: getRecentCommits(),
    services: getServiceStatuses(),
  };
}

// ── Logs API ─────────────────────────────────────────────────

interface LogEntry {
  ts: string;
  level: string;
  module: string;
  msg: string;
  data?: Record<string, unknown>;
}

function readLogs(options: {
  limit?: number;
  module?: string;
  level?: string;
  search?: string;
}): LogEntry[] {
  const logPath = path.join(getProjectDir(), 'logs', 'daemon.log');
  const { limit = 100, module, level, search } = options;

  try {
    if (!fs.existsSync(logPath)) return [];

    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Parse and filter
    let entries: LogEntry[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LogEntry;

        // Apply filters
        if (module && entry.module !== module) continue;
        if (level && entry.level !== level) continue;
        if (search && !line.toLowerCase().includes(search.toLowerCase())) continue;

        entries.push(entry);
      } catch {
        // Skip malformed lines
      }
    }

    // Return last N entries (most recent)
    return entries.slice(-limit);
  } catch {
    return [];
  }
}

// ── Memory Sync ──────────────────────────────────────────────

interface MemorySyncPayload {
  from: string;
  memories: Array<{
    filename: string;
    subject: string;
    category: string;
    content: string;
  }>;
}

interface MemorySyncResult {
  ok: boolean;
  accepted: number;
  skipped: number;
  updated: number;
  conflicts: number;
  details: string[];
}

const PRIVATE_CATEGORIES = ['account'];
const PRIVATE_TAGS = ['pii', 'credential', 'financial', 'keychain', 'secret', 'password'];

function isPrivateMemory(content: string): boolean {
  const lowerContent = content.toLowerCase();

  // Check for private tags in frontmatter
  for (const tag of PRIVATE_TAGS) {
    if (lowerContent.includes(tag)) return true;
  }

  // Check for keychain references
  if (lowerContent.includes('keychain:') || lowerContent.includes('credential-')) return true;

  return false;
}

function parseMemoryFrontmatter(content: string): { source?: string; subject?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter = match[1];
  const sourceMatch = frontmatter.match(/source:\s*(.+)/);
  const subjectMatch = frontmatter.match(/subject:\s*(.+)/);

  return {
    source: sourceMatch?.[1]?.trim(),
    subject: subjectMatch?.[1]?.trim(),
  };
}

async function handleMemorySync(payload: MemorySyncPayload): Promise<MemorySyncResult> {
  const memoryDir = path.join(getProjectDir(), '.claude', 'state', 'memory', 'memories');
  const result: MemorySyncResult = {
    ok: true,
    accepted: 0,
    skipped: 0,
    updated: 0,
    conflicts: 0,
    details: [],
  };

  // Ensure memory directory exists
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  for (const mem of payload.memories) {
    try {
      // Skip private memories
      if (PRIVATE_CATEGORIES.includes(mem.category) || isPrivateMemory(mem.content)) {
        result.skipped++;
        result.details.push(`Skipped (private): ${mem.filename}`);
        continue;
      }

      const localPath = path.join(memoryDir, mem.filename);

      // Check if local file exists
      if (fs.existsSync(localPath)) {
        const localContent = fs.readFileSync(localPath, 'utf8');
        const localMeta = parseMemoryFrontmatter(localContent);

        // source:user always wins
        if (localMeta.source === 'user') {
          result.skipped++;
          result.details.push(`Skipped (local user source): ${mem.filename}`);
          continue;
        }

        // Check for conflict (same subject, different content)
        if (localMeta.subject === mem.subject && localContent !== mem.content) {
          // Don't overwrite - flag as conflict
          result.conflicts++;
          result.details.push(`Conflict: ${mem.filename} (local vs peer-${payload.from})`);
          continue;
        }

        // Same content - skip
        if (localContent === mem.content) {
          result.skipped++;
          continue;
        }

        // Update with peer content
        const updatedContent = addProvenanceLine(mem.content, payload.from);
        fs.writeFileSync(localPath, updatedContent);
        result.updated++;
        result.details.push(`Updated: ${mem.filename}`);
      } else {
        // New memory from peer - add provenance and save
        const newContent = addProvenanceLine(mem.content, payload.from);
        fs.writeFileSync(localPath, newContent);
        result.accepted++;
        result.details.push(`Accepted: ${mem.filename}`);
      }
    } catch (err) {
      result.details.push(`Error processing ${mem.filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Log and notify if conflicts
  if (result.conflicts > 0) {
    log.warn(`Memory sync: ${result.conflicts} conflict(s) from peer-${payload.from}`);
    injectText(`[Memory Sync] ${result.conflicts} conflict(s) from peer-${payload.from}. Review needed.`);
  }

  log.info(`Memory sync from ${payload.from}`, {
    accepted: result.accepted,
    skipped: result.skipped,
    updated: result.updated,
    conflicts: result.conflicts,
  });

  return result;
}

function addProvenanceLine(content: string, fromPeer: string): string {
  // Update source in frontmatter to peer-{from}
  const sourceRegex = /^(---\n[\s\S]*?)(source:\s*.+)([\s\S]*?\n---)/;
  const match = content.match(sourceRegex);

  if (match) {
    return content.replace(sourceRegex, `$1source: peer-${fromPeer}$3`);
  }

  // If no source field, add it after the opening ---
  return content.replace(/^(---\n)/, `$1source: peer-${fromPeer}\n`);
}

function getLogModules(): string[] {
  const logPath = path.join(getProjectDir(), 'logs', 'daemon.log');
  const modules = new Set<string>();

  try {
    if (!fs.existsSync(logPath)) return [];

    const content = fs.readFileSync(logPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LogEntry;
        if (entry.module) modules.add(entry.module);
      } catch {
        // Skip malformed lines
      }
    }

    return Array.from(modules).sort();
  } catch {
    return [];
  }
}

// ── HTTP Server ──────────────────────────────────────────────

const telegramRouter = config.channels.telegram.enabled
  ? createTelegramRouter()
  : null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${config.daemon.port}`);

  // Health endpoint
  if (req.method === 'GET' && url.pathname === '/health') {
    const report = await runHealthCheck();
    const accept = req.headers.accept ?? '';

    if (accept.includes('text/plain')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(formatReport(report));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(report, null, 2));
    }
    return;
  }

  // Status endpoint (quick)
  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      daemon: 'running',
      agent: config.agent.name,
      session: sessionExists() ? 'active' : 'stopped',
      uptime: process.uptime(),
    }));
    return;
  }

  // Extended status endpoint (for ops dashboard)
  if (req.method === 'GET' && url.pathname === '/status/extended') {
    try {
      const extendedStatus = await getExtendedStatus();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',  // Allow cross-origin for dashboard
      });
      res.end(JSON.stringify(extendedStatus, null, 2));
    } catch (err) {
      log.error('Extended status error', { error: err instanceof Error ? err.message : String(err) });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to gather status' }));
    }
    return;
  }

  // Logs endpoint — returns filtered JSON logs
  if (req.method === 'GET' && url.pathname === '/logs') {
    const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
    const module = url.searchParams.get('module') ?? undefined;
    const level = url.searchParams.get('level') ?? undefined;
    const search = url.searchParams.get('search') ?? undefined;

    const logs = readLogs({ limit, module, level, search });

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(logs, null, 2));
    return;
  }

  // Logs modules endpoint — returns list of unique modules
  if (req.method === 'GET' && url.pathname === '/logs/modules') {
    const modules = getLogModules();

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(modules));
    return;
  }

  // Tasks list endpoint — returns available tasks
  if (req.method === 'GET' && url.pathname === '/tasks') {
    const tasks = getTaskList();

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(tasks));
    return;
  }

  // Task runner endpoint — POST /tasks/:name/run to trigger a task
  const taskRunMatch = url.pathname.match(/^\/tasks\/([^/]+)\/run$/);
  if (req.method === 'POST' && taskRunMatch) {
    const taskName = taskRunMatch[1];
    const result = await runTaskByName(taskName);

    res.writeHead(result.ok ? 200 : 400, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(result));
    return;
  }

  // Session clear endpoint — injects /clear into the tmux session
  if (req.method === 'POST' && url.pathname === '/session/clear') {
    const ok = injectText('/clear');
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok, injected: '/clear' }));
    return;
  }

  // Typing-done endpoint (used by transcript stream to stop typing)
  if (req.method === 'POST' && url.pathname === '/typing-done') {
    if (telegramRouter) {
      telegramRouter.stopTyping();
    }
    res.writeHead(200);
    res.end('ok');
    return;
  }

  // Hook notification endpoint (called by PostToolUse + Stop hooks)
  if (req.method === 'POST' && url.pathname === '/hook/response') {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      res.writeHead(200);
      res.end('ok');

      let hookEvent: string | undefined;
      try {
        const payload = JSON.parse(body);
        hookEvent = payload.hook_event;
        onHookNotification(payload.transcript_path, hookEvent);
      } catch {
        // No body or invalid JSON — still trigger a read
        onHookNotification();
      }

      // Update agent state from hook event (replaces pane-scraping heuristics)
      if (hookEvent) {
        updateAgentState(hookEvent);
      }

    });
    return;
  }

  // Telegram webhook
  if (req.method === 'POST' && url.pathname === (config.channels.telegram.webhook_path ?? '/telegram')) {
    if (!telegramRouter) {
      res.writeHead(404);
      res.end('Telegram not enabled');
      return;
    }

    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', async () => {
      // Respond immediately (Telegram expects fast 200)
      res.writeHead(200);
      res.end('ok');

      try {
        const update = JSON.parse(body);
        await telegramRouter.handleUpdate(update);
      } catch (err) {
        log.error('Telegram webhook parse error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    return;
  }

  // Siri Shortcut endpoint
  if (req.method === 'POST' && url.pathname === '/shortcut') {
    if (!telegramRouter) {
      res.writeHead(404);
      res.end('Telegram not enabled');
      return;
    }

    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const result = await telegramRouter.handleShortcut(data);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  // Voice endpoints: /voice/*
  if (url.pathname.startsWith('/voice/')) {
    const handled = await handleVoiceRequest(req, res, url.pathname);
    if (handled) return;
  }

  // Browser timeout: POST /browser/timeout-warning — forward timeout warnings to Telegram and Claude
  if (req.method === 'POST' && url.pathname === '/browser/timeout-warning') {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', async () => {
      res.writeHead(200);
      res.end('ok');

      try {
        const data = JSON.parse(body) as { type: string; message: string; url?: string; contextName?: string };
        log.info('Browser timeout warning', { type: data.type });

        // Forward to Telegram
        if (config.channels.telegram.enabled) {
          sendTelegramMessage(data.message);
        }

        // Inject into Claude session for awareness
        if (sessionExists()) {
          injectText(`[Browser] ${data.message}`);
        }

        // If it's a hand-off idle timeout, deactivate hand-off and create retry to-do
        if (data.type === 'handoff-idle-timeout') {
          await deactivateHandoff();
          createRetryTodo(data.url, data.contextName);
        }

        // If session died, deactivate hand-off
        if (data.type === 'session-died') {
          await deactivateHandoff();
        }
      } catch {
        // Invalid JSON — ignore
      }
    });
    return;
  }

  // Browser hand-off: POST /browser/handoff/start — activate hand-off mode
  if (req.method === 'POST' && url.pathname === '/browser/handoff/start') {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', async () => {
      let replyChatId: string | undefined;
      try {
        const data = JSON.parse(body);
        replyChatId = data.replyChatId;
      } catch {
        // No body or invalid JSON — use default
      }
      const ok = await activateHandoff(replyChatId);
      res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ok ? { active: true } : { error: 'Sidecar not ready' }));
    });
    return;
  }

  // Browser hand-off: POST /browser/handoff/stop — deactivate hand-off mode
  if (req.method === 'POST' && url.pathname === '/browser/handoff/stop') {
    await deactivateHandoff();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ active: false }));
    return;
  }

  // Browser hand-off: GET /browser/handoff/status — check hand-off state
  if (req.method === 'GET' && url.pathname === '/browser/handoff/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ active: isHandoffActive() }));
    return;
  }

  // Agent comms: POST /agent/message — receive message from peer
  if (req.method === 'POST' && url.pathname === '/agent/message') {
    if (!config['agent-comms'].enabled) {
      res.writeHead(404);
      res.end('Agent comms not enabled');
      return;
    }

    const remoteAddr = req.socket.remoteAddress ?? 'unknown';
    log.info('Inbound agent message', { from: remoteAddr });

    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const authHeader = req.headers.authorization ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        log.warn('Agent message: invalid JSON', { from: remoteAddr });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      const result = handleAgentMessage(token, parsed);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });
    return;
  }

  // Agent comms: GET /agent/status — lightweight presence check (no auth required)
  if (req.method === 'GET' && url.pathname === '/agent/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getAgentStatus()));
    return;
  }

  // Agent comms: POST /agent/send — trigger outgoing message (local-only, no auth)
  if (req.method === 'POST' && url.pathname === '/agent/send') {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body) as { peer: string; type?: string; text?: string };
        if (!data.peer || !data.text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "'peer' and 'text' are required" }));
          return;
        }
        const result = await sendAgentMessage(
          data.peer,
          (data.type as 'text') ?? 'text',
          data.text,
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  // Agent comms: POST /agent/memory-sync — receive memory sync from peer
  if (req.method === 'POST' && url.pathname === '/agent/memory-sync') {
    if (!config['agent-comms']?.enabled) {
      res.writeHead(404);
      res.end('Agent comms not enabled');
      return;
    }

    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token || !validateAgentCommsAuth(token)) {
      log.warn('Memory sync rejected: invalid auth');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body) as MemorySyncPayload;

        if (!payload.from || !Array.isArray(payload.memories)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid payload: requires from and memories array' }));
          return;
        }

        const result = await handleMemorySync(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        log.error('Memory sync error', { error: err instanceof Error ? err.message : String(err) });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
});

// ── Start modules ────────────────────────────────────────────

server.listen(config.daemon.port, () => {
  log.info(`HTTP server listening on port ${config.daemon.port}`);

  // Phase 2: Communications
  if (config.channels.telegram.enabled || config.channels.email.enabled) {
    initChannelRouter();
    startTranscriptStream();
    log.info('Communications module started');
  }

  // Voice
  initVoiceServer();

  // Browser sidecar
  initBrowserSidecar();

  // Agent-to-Agent Comms
  initAgentComms();

  // Phase 3: Automation
  startScheduler();
  log.info('Scheduler started');
});

// ── Graceful shutdown ────────────────────────────────────────

function shutdown(signal: string) {
  log.info(`Shutting down (${signal})`);
  stopTranscriptStream();
  stopVoiceServer();
  stopBrowserSidecar();
  stopAgentComms();
  stopScheduler();
  server.close(() => {
    log.info('Daemon stopped');
    process.exit(0);
  });
  // Force exit after 5s if graceful shutdown stalls
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

log.info('Daemon initialized');
