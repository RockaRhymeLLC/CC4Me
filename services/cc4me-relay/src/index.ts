/**
 * CC4Me Relay Service — Agent registry + message relay.
 *
 * A lightweight Express app that provides:
 * - Agent identity management (register, approve, revoke, directory)
 * - Signed message relay (send, poll inbox, acknowledge)
 * - SQLite persistence with WAL mode
 * - Scale-to-zero compatible (stateless HTTP)
 */

import express from 'express';
import { registryRouter } from './registry.js';
import { relayRouter } from './relay.js';
import { rateLimit } from './auth.js';
import { getDb, closeDb } from './db.js';

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);
const startTime = Date.now();

// Parse JSON bodies
app.use(express.json({ limit: '512kb' }));

// Trust proxy for Azure/Cloudflare
app.set('trust proxy', true);

// Rate limiting
app.use(rateLimit);

// Health endpoint (unauthenticated)
app.get('/health', (_req, res) => {
  const db = getDb();
  const agentCount = (db.prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number }).count;
  const messageQueueDepth = (db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number }).count;

  res.json({
    status: 'ok',
    service: 'cc4me-relay',
    version: '1.0.0',
    agentCount,
    messageQueueDepth,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

// Routes
app.use('/registry', registryRouter);
app.use('/relay', relayRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[relay] SIGTERM received, shutting down...');
  closeDb();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[relay] SIGINT received, shutting down...');
  closeDb();
  process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  // Initialize DB on startup (creates tables if needed)
  getDb();
  console.log(`[relay] CC4Me relay listening on port ${PORT}`);
});

export { app };
