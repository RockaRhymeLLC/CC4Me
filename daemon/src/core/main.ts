/**
 * CC4Me Daemon — single entry point.
 *
 * Starts the HTTP server, initializes all modules based on config,
 * and serves as the unified runtime for comms + automation.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, getProjectDir } from './config.js';
import { initLogger, createLogger } from './logger.js';
import { runHealthCheck, formatReport } from './health.js';
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
import { startScheduler, stopScheduler } from '../automation/scheduler.js';

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
        onHookNotification(payload.transcript_path);
      } catch {
        // No body or invalid JSON — still trigger a read
        onHookNotification();
      }

      // Update agent state from hook event (replaces pane-scraping heuristics)
      if (hookEvent) {
        updateAgentState(hookEvent);
      }

      // On Stop events, deliver any queued Telegram messages.
      // This ensures messages arrive between responses, not mid-response.
      if (hookEvent === 'Stop' && telegramRouter) {
        telegramRouter.deliverPending();
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
