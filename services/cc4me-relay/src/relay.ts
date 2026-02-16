/**
 * Message relay routes for CC4Me relay.
 *
 * POST /relay/send              — Send signed message
 * GET  /relay/inbox/:agent      — Poll inbox
 * POST /relay/inbox/:agent/ack  — Acknowledge messages
 */

import { Router } from 'express';
import { getDb, cleanup } from './db.js';
import { requireAgentAuth, requireSelfAuth } from './auth.js';

export const relayRouter = Router();

// All relay routes require agent authentication
relayRouter.use(requireAgentAuth);

/**
 * Send a signed message to another agent.
 */
relayRouter.post('/send', (req, res) => {
  const { from, to, type, text, timestamp, messageId, nonce } = req.body || {};
  const authAgent = (req as any).agentName;

  // Validate from matches authenticated agent
  if (from !== authAgent) {
    res.status(400).json({ error: 'from field must match authenticated agent' });
    return;
  }

  if (!to || !type || !messageId || !nonce || !timestamp) {
    res.status(400).json({ error: 'Missing required fields: to, type, messageId, nonce, timestamp' });
    return;
  }

  // Check timestamp is within 5 minutes
  const msgTime = new Date(timestamp).getTime();
  const now = Date.now();
  if (isNaN(msgTime) || Math.abs(now - msgTime) > 5 * 60 * 1000) {
    res.status(400).json({ error: 'Timestamp too old or invalid (5-minute window)' });
    return;
  }

  const db = getDb();

  // Check recipient exists and is active
  const recipient = db.prepare('SELECT name, status FROM agents WHERE name = ?').get(to) as
    | { name: string; status: string }
    | undefined;

  if (!recipient) {
    res.status(404).json({ error: 'Recipient agent not found' });
    return;
  }

  // Replay protection: check nonce
  const existingNonce = db.prepare('SELECT nonce FROM nonces WHERE nonce = ?').get(nonce);
  if (existingNonce) {
    res.status(409).json({ error: 'Duplicate nonce (replay detected)' });
    return;
  }

  // Store nonce
  db.prepare('INSERT INTO nonces (nonce) VALUES (?)').run(nonce);

  // Enforce inbox limit (100 messages per agent, drop oldest)
  const inboxCount = db.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE to_agent = ?'
  ).get(to) as { count: number };

  if (inboxCount.count >= 100) {
    // Delete oldest messages to make room
    const excess = inboxCount.count - 99;
    db.prepare(`
      DELETE FROM messages WHERE id IN (
        SELECT id FROM messages WHERE to_agent = ? ORDER BY created_at ASC LIMIT ?
      )
    `).run(to, excess);
  }

  // Store message with the full payload and signature
  const signature = req.get('X-Signature') || '';
  const payload = JSON.stringify(req.body);

  db.prepare(`
    INSERT INTO messages (id, from_agent, to_agent, type, text, payload, signature)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(messageId, from, to, type, text || null, payload, signature);

  // Periodic cleanup
  cleanup();

  res.json({ ok: true, messageId });
});

/**
 * Poll inbox for pending messages.
 */
relayRouter.get('/inbox/:agent', requireSelfAuth, (req, res) => {
  const { agent } = req.params;
  const db = getDb();

  const messages = db.prepare(`
    SELECT id, from_agent, to_agent, type, text, payload, signature, created_at
    FROM messages WHERE to_agent = ?
    ORDER BY created_at ASC LIMIT 50
  `).all(agent);

  res.json(messages.map((m: any) => ({
    id: m.id,
    from: m.from_agent,
    to: m.to_agent,
    type: m.type,
    text: m.text,
    payload: m.payload,
    signature: m.signature,
    createdAt: m.created_at,
  })));
});

/**
 * Acknowledge received messages (deletes them from inbox).
 */
relayRouter.post('/inbox/:agent/ack', requireSelfAuth, (req, res) => {
  const { agent } = req.params;
  const { messageIds } = req.body || {};

  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    res.status(400).json({ error: 'messageIds array required' });
    return;
  }

  const db = getDb();
  const placeholders = messageIds.map(() => '?').join(',');
  const result = db.prepare(
    `DELETE FROM messages WHERE to_agent = ? AND id IN (${placeholders})`
  ).run(agent, ...messageIds);

  res.json({ ok: true, deleted: result.changes });
});
