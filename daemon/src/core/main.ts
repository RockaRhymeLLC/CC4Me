/**
 * CC4Me Daemon — single entry point.
 *
 * Starts the HTTP server, initializes all modules based on config,
 * and serves as the unified runtime for comms + automation.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { loadConfig, getProjectDir } from './config.js';
import { initLogger, createLogger } from './logger.js';
import { runHealthCheck, formatReport } from './health.js';
import { getExtendedStatus } from './extended-status.js';
import { sessionExists, injectText, updateAgentState } from './session-bridge.js';

// Comms imports (Phase 2)
import { startTranscriptStream, stopTranscriptStream, onHookNotification, getDeliveryStats } from '../comms/transcript-stream.js';
import { initChannelRouter } from '../comms/channel-router.js';
import { createTelegramRouter } from '../comms/adapters/telegram.js';

// Agent comms imports
import { initAgentComms, stopAgentComms, handleAgentMessage, getAgentStatus, updatePeerState, sendAgentMessage } from '../comms/agent-comms.js';
import { handleMemorySync } from '../automation/tasks/memory-sync.js';

// Network imports
import { registerWithRelay, checkRegistrationStatus } from '../comms/network/registration.js';
import { initNetworkSDK, stopNetworkSDK, handleIncomingP2P } from '../comms/network/sdk-bridge.js';

// Voice imports
import { handleVoiceRequest, initVoiceServer, stopVoiceServer } from '../voice/voice-server.js';

// Browser sidecar imports
import { initBrowserSidecar, stopBrowserSidecar, getSidecarPort } from '../browser/browser-sidecar.js';
import { activateHandoff, deactivateHandoff, isHandoffActive, sendMessage as sendTelegramMessage } from '../comms/adapters/telegram.js';

// Automation imports (Phase 3)
import { startScheduler, stopScheduler, runTaskByName, listTasks } from '../automation/scheduler.js';

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
// BMO-specific tasks (not in R2's fork):
// import '../automation/tasks/a2a-digest.js';
import '../automation/tasks/backup.js';
import '../automation/tasks/transcript-cleanup.js';
import '../automation/tasks/memory-sync.js';
// import '../automation/tasks/weekly-progress-report.js';
// import '../automation/tasks/bounty-scanner.js';
// import '../automation/tasks/supabase-keep-alive.js';
import '../automation/tasks/relay-inbox-poll.js';

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

// ── HTTP Server ──────────────────────────────────────────────

const telegramRouter = config.channels.telegram.enabled
  ? createTelegramRouter()
  : null;

/** Returns true if the request came through Cloudflare tunnel (external). */
function isExternalRequest(req: http.IncomingMessage): boolean {
  return !!req.headers['cf-connecting-ip'];
}

/** Block external access — returns true if blocked (response already sent). */
function blockExternal(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (isExternalRequest(req)) {
    res.writeHead(404);
    res.end('Not found');
    return true;
  }
  return false;
}

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

  // Extended status endpoint (for ops dashboard) — local only
  if (req.method === 'GET' && url.pathname === '/status/extended') {
    if (blockExternal(req, res)) return;
    const status = await getExtendedStatus();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(status, null, 2));
    return;
  }

  // Config: peer agents — local only (used by ops.html to discover peers)
  if (req.method === 'GET' && url.pathname === '/config/peers') {
    if (blockExternal(req, res)) return;
    const peers = config['agent-comms']?.peers ?? [];
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(peers));
    return;
  }

  // Delivery stats endpoint — local only
  if (req.method === 'GET' && url.pathname === '/delivery-stats') {
    if (blockExternal(req, res)) return;
    const stats = getDeliveryStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats, null, 2));
    return;
  }

  // API analytics aggregation — local only
  if (req.method === 'GET' && url.pathname === '/api/analytics') {
    if (blockExternal(req, res)) return;
    const services = [
      { name: 'webhook-api', port: 3850 },
      { name: 'url-metadata', port: 3860 },
      { name: 'qr-generator', port: 3861 },
      { name: 'hash-tools', port: 3862 },
      { name: 'cron-parser', port: 3863 },
      { name: 'json-tools', port: 3864 },
      { name: 'text-tools', port: 3865 },
      { name: 'email-validator', port: 3866 },
      { name: 'color-tools', port: 3867 },
      { name: 'regex-tools', port: 3868 },
      { name: 'markdown-tools', port: 3869 },
      { name: 'ip-tools', port: 3870 },
      { name: 'datetime-tools', port: 3871 },
      { name: 'csv-tools', port: 3872 },
      { name: 'placeholder-img', port: 3873 },
      { name: 'jwt-tools', port: 3874 },
      { name: 'useragent-parser', port: 3875 },
      { name: 'yaml-tools', port: 3876 },
      { name: 'convert-tools', port: 3877 },
      { name: 'lorem-tools', port: 3878 },
      { name: 'diff-tools', port: 3879 },
      { name: 'password-tools', port: 3880 },
      { name: 'encode-tools', port: 3881 },
      { name: 'uuid-tools', port: 3882 },
      { name: 'sql-tools', port: 3883 },
      { name: 'http-status', port: 3884 },
      { name: 'glob-tools', port: 3885 },
      { name: 'semver-tools', port: 3886 },
      { name: 'ascii-tools', port: 3887 },
      { name: 'status-page', port: 3888 },
      { name: 'faker-tools', port: 3889 },
    ];
    const results: Record<string, unknown> = {};
    let totalRequests = 0;
    await Promise.all(services.map(async (svc) => {
      try {
        const resp = await fetch(`http://localhost:${svc.port}/analytics`, { signal: AbortSignal.timeout(2000) });
        if (resp.ok) {
          const data = await resp.json() as { totalRequests?: number };
          results[svc.name] = data;
          totalRequests += data.totalRequests || 0;
        } else {
          results[svc.name] = { error: `HTTP ${resp.status}` };
        }
      } catch {
        results[svc.name] = { error: 'unreachable' };
      }
    }));
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ totalRequests, services: results }, null, 2));
    return;
  }

  // Session clear endpoint — local only
  if (req.method === 'POST' && url.pathname === '/session/clear') {
    if (blockExternal(req, res)) return;
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

  // Browser handoff proxy: forward /handoff/* and /session/* to sidecar
  // /handoff/* always proxied (token-gated by sidecar)
  // /session/* only proxied when handoff is active (wrapper UI needs these)
  const isHandoffPath = url.pathname.startsWith('/handoff/');
  const isSessionPath = url.pathname.startsWith('/session/');
  if (isHandoffPath || (isSessionPath && isHandoffActive())) {
    const sidecarPort = getSidecarPort();
    const proxyUrl = `http://localhost:${sidecarPort}${url.pathname}${url.search}`;
    const proxyReq = http.request(proxyUrl, { method: req.method, headers: req.headers }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Browser sidecar unavailable');
    });
    req.pipe(proxyReq);
    return;
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

  // P2P Network: POST /agent/p2p — receive E2E encrypted message from network peer
  if (req.method === 'POST' && url.pathname === '/agent/p2p') {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', async () => {
      let envelope: unknown;
      try {
        envelope = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      // handleIncomingP2P is async — group messages require decryption + member validation
      const ok = await handleIncomingP2P(envelope as import('cc4me-network').WireEnvelope);
      if (ok) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Failed to process message' }));
      }
    });
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

  // Agent comms: POST /agent/status — heartbeat state exchange (no auth required)
  // Peer sends their state, we reply with ours. Both sides cache each other's state.
  if (req.method === 'POST' && url.pathname === '/agent/status') {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body) as { agent?: string; status?: string };
        // Cache the peer's reported state
        if (data.agent && data.status) {
          updatePeerState(data.agent, {
            status: (data.status === 'idle' || data.status === 'busy') ? data.status : 'unknown',
            updatedAt: Date.now(),
          });
        }
      } catch {
        // Invalid JSON — still return our status
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getAgentStatus()));
    });
    return;
  }

  // Agent comms: POST /agent/send — local only
  if (req.method === 'POST' && url.pathname === '/agent/send') {
    if (blockExternal(req, res)) return;
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

  // Agent comms: POST /agent/memory-sync — receive memories from peer
  if (req.method === 'POST' && url.pathname === '/agent/memory-sync') {
    if (!config['agent-comms'].enabled) {
      res.writeHead(404);
      res.end('Agent comms not enabled');
      return;
    }

    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const authHeader = req.headers.authorization ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      const result = handleMemorySync(token, parsed);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });
    return;
  }

  // Memory conflicts: DELETE /agent/memory-conflicts — clear resolved conflicts (local only)
  if (req.method === 'DELETE' && url.pathname === '/agent/memory-conflicts') {
    if (blockExternal(req, res)) return;
    const { clearMemoryConflicts } = await import('../automation/tasks/memory-sync.js');
    const peer = url.searchParams.get('peer') ?? undefined;
    const cleared = clearMemoryConflicts(peer);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, cleared }));
    return;
  }

  // Worker signal: POST /worker/signal — local only
  if (req.method === 'POST' && url.pathname === '/worker/signal') {
    if (blockExternal(req, res)) return;
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body) as { worker?: string; status?: string; message?: string };
        if (!data.worker || !data.status) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: "'worker' and 'status' are required" }));
          return;
        }
        const validStatuses = ['done', 'stuck', 'error', 'working'];
        if (!validStatuses.includes(data.status)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Invalid status. Use: ${validStatuses.join(', ')}` }));
          return;
        }
        const emoji = data.status === 'done' ? '✅' : data.status === 'stuck' ? '🚧' : data.status === 'error' ? '❌' : '🔄';
        const notification = `[Worker] ${emoji} ${data.worker}: ${data.status}${data.message ? ' — ' + data.message : ''}`;
        log.info('Worker signal received', { worker: data.worker, status: data.status, message: data.message });
        injectText(notification);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // Admin: GET /tasks — local only
  if (req.method === 'GET' && url.pathname === '/tasks') {
    if (blockExternal(req, res)) return;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listTasks(), null, 2));
    return;
  }

  // Admin: POST /tasks/:name/run — local only
  const taskRunMatch = url.pathname.match(/^\/tasks\/([a-z0-9-]+)\/run$/);
  if (req.method === 'POST' && taskRunMatch) {
    if (blockExternal(req, res)) return;
    const taskName = taskRunMatch[1]!;
    const result = await runTaskByName(taskName);
    res.writeHead(result.ok ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // Admin: GET /logs — local only
  // Query params: ?limit=200&module=telegram&level=error&search=keyword
  if (req.method === 'GET' && url.pathname === '/logs') {
    if (blockExternal(req, res)) return;
    const logPath = path.join(projectDir, 'logs', 'daemon.log');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 2000);
    const filterModule = url.searchParams.get('module') ?? '';
    const filterLevel = url.searchParams.get('level') ?? '';
    const filterSearch = url.searchParams.get('search') ?? '';

    try {
      const raw = fs.readFileSync(logPath, 'utf8');
      const lines = raw.trim().split('\n');
      const entries: unknown[] = [];
      for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
        try {
          const entry = JSON.parse(lines[i]!) as { module?: string; level?: string; msg?: string };
          if (filterModule && entry.module !== filterModule) continue;
          if (filterLevel && entry.level !== filterLevel) continue;
          if (filterSearch && !(entry.msg ?? '').toLowerCase().includes(filterSearch.toLowerCase())) continue;
          entries.push(entry);
        } catch {
          // skip non-JSON lines
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(entries));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }

  // Admin: GET /logs/modules — local only
  if (req.method === 'GET' && url.pathname === '/logs/modules') {
    if (blockExternal(req, res)) return;
    const logPath = path.join(projectDir, 'logs', 'daemon.log');
    try {
      const raw = fs.readFileSync(logPath, 'utf8');
      const lines = raw.trim().split('\n');
      const modules = new Set<string>();
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as { module?: string };
          if (entry.module) modules.add(entry.module);
        } catch { /* skip */ }
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify([...modules].sort()));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }

  // Admin: GET /agent-comms/recent — local only
  if (req.method === 'GET' && url.pathname === '/agent-comms/recent') {
    if (blockExternal(req, res)) return;
    const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 200);
    const logPath = path.join(projectDir, 'logs', 'agent-comms.log');

    try {
      const raw = fs.readFileSync(logPath, 'utf8');
      const lines = raw.trim().split('\n');
      const messages: { ts: string; direction: string; from?: string; to?: string; type?: string; text?: string }[] = [];

      for (let i = lines.length - 1; i >= 0 && messages.length < limit; i--) {
        try {
          const entry = JSON.parse(lines[i]!) as Record<string, unknown>;
          if (entry.direction === 'heartbeat') continue;
          messages.push({
            ts: entry.ts as string,
            direction: entry.direction as string,
            from: entry.from as string | undefined,
            to: entry.to as string | undefined,
            type: entry.type as string | undefined,
            text: typeof entry.text === 'string' ? entry.text.slice(0, 300) : undefined,
          });
        } catch { /* skip non-JSON */ }
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(messages));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    }
    return;
  }

  // Admin: GET /git-status — local only
  if (req.method === 'GET' && url.pathname === '/git-status') {
    if (blockExternal(req, res)) return;
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', cwd: projectDir, timeout: 5_000 }).trim();
      const aheadBehind = execSync('git rev-list --left-right --count origin/main...HEAD 2>/dev/null || echo "0\t0"', { encoding: 'utf8', cwd: projectDir, timeout: 5_000 }).trim();
      const [behind, ahead] = aheadBehind.split('\t').map(Number);
      const dirty = execSync('git status --porcelain', { encoding: 'utf8', cwd: projectDir, timeout: 5_000 }).trim();
      const lastCommit = execSync('git log -1 --format="%h|%s|%ar"', { encoding: 'utf8', cwd: projectDir, timeout: 5_000 }).trim();
      const [hash, subject, relTime] = lastCommit.split('|');

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        branch,
        ahead: ahead ?? 0,
        behind: behind ?? 0,
        dirty: dirty ? dirty.split('\n').length : 0,
        lastCommit: { hash, subject, relativeTime: relTime },
      }));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ branch: 'unknown', ahead: 0, behind: 0, dirty: 0 }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ── Start modules ────────────────────────────────────────────

function startModules() {
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

  // CC4Me Network — register with relay if enabled, then start SDK
  if (config.network?.enabled) {
    registerWithRelay().then(async result => {
      if (result.ok) {
        log.info('Network: relay registration', { status: result.status });
      } else {
        log.warn('Network: relay registration issue', { error: result.error });
      }

      // Initialize SDK after registration (regardless of registration status)
      const sdkOk = await initNetworkSDK();
      if (sdkOk) {
        log.info('Network: SDK started — P2P messaging enabled');
      } else {
        log.info('Network: SDK not started — LAN-only mode');
      }
    }).catch(err => {
      log.warn('Network: relay registration failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // Phase 3: Automation
  startScheduler();
  log.info('Scheduler started');
}

const MAX_BIND_RETRIES = 3;
const BIND_RETRY_DELAY_MS = 1000;
let bindAttempt = 0;

function tryListen() {
  server.listen(config.daemon.port, startModules);
}

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE' && bindAttempt < MAX_BIND_RETRIES) {
    bindAttempt++;
    log.warn(`Port ${config.daemon.port} in use, retrying in ${BIND_RETRY_DELAY_MS}ms (attempt ${bindAttempt}/${MAX_BIND_RETRIES})`);
    setTimeout(tryListen, BIND_RETRY_DELAY_MS);
  } else {
    log.error(`Server error: ${err.message}`);
    process.exit(1);
  }
});

tryListen();

// ── Graceful shutdown ────────────────────────────────────────

function shutdown(signal: string) {
  log.info(`Shutting down (${signal})`);
  stopTranscriptStream();
  stopVoiceServer();
  stopBrowserSidecar();
  stopAgentComms();
  stopNetworkSDK();
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
