/**
 * CC4Me Daemon — single entry point.
 *
 * Starts the HTTP server, initializes all modules based on config,
 * and serves as the unified runtime for comms + automation.
 */

import http from 'node:http';
import path from 'node:path';
import { loadConfig, getProjectDir } from './config.js';
import { initLogger, createLogger } from './logger.js';
import { runHealthCheck, formatReport } from './health.js';
import { sessionExists } from './session-bridge.js';

// Comms imports (Phase 2)
import { startTranscriptStream, stopTranscriptStream } from '../comms/transcript-stream.js';
import { initChannelRouter } from '../comms/channel-router.js';
import { createTelegramRouter } from '../comms/adapters/telegram.js';

// Automation imports (Phase 3)
import { startScheduler, stopScheduler } from '../automation/scheduler.js';

// Task registrations — importing these files causes registerTask() calls
import '../automation/tasks/context-watchdog.js';
import '../automation/tasks/todo-reminder.js';
import '../automation/tasks/email-check.js';
import '../automation/tasks/nightly-todo.js';
import '../automation/tasks/health-check.js';
import '../automation/tasks/memory-consolidation.js';

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

  // Phase 3: Automation
  startScheduler();
  log.info('Scheduler started');
});

// ── Graceful shutdown ────────────────────────────────────────

function shutdown(signal: string) {
  log.info(`Shutting down (${signal})`);
  stopTranscriptStream();
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
