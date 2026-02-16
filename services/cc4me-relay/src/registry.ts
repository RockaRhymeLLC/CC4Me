/**
 * Agent registry routes for CC4Me relay.
 *
 * POST /registry/agents          — Register (unauthenticated)
 * GET  /registry/agents          — Directory (unauthenticated)
 * POST /registry/agents/:name/approve  — Admin approve
 * POST /registry/agents/:name/revoke   — Admin revoke
 */

import { Router } from 'express';
import { getDb } from './db.js';
import { requireAdminAuth } from './auth.js';

export const registryRouter = Router();

/**
 * Register a new agent. Unauthenticated — new agents can't sign yet.
 */
registryRouter.post('/agents', (req, res) => {
  const { name, publicKey, ownerEmail } = req.body || {};

  if (!name || !publicKey) {
    res.status(400).json({ error: 'name and publicKey are required' });
    return;
  }

  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    res.status(400).json({ error: 'Invalid agent name (alphanumeric, dash, underscore, max 64 chars)' });
    return;
  }

  const db = getDb();

  // Check for existing agent
  const existing = db.prepare('SELECT name FROM agents WHERE name = ?').get(name);
  if (existing) {
    res.status(409).json({ error: 'Agent already exists' });
    return;
  }

  db.prepare(
    'INSERT INTO agents (name, public_key, owner_email) VALUES (?, ?, ?)'
  ).run(name, publicKey, ownerEmail || null);

  console.log(`[registry] New agent registered: ${name} (pending approval)`);

  res.status(201).json({
    name,
    status: 'pending',
    message: 'Registration pending admin approval',
  });
});

/**
 * List all registered agents. Unauthenticated — public directory.
 */
registryRouter.get('/agents', (_req, res) => {
  const db = getDb();
  const agents = db.prepare(
    'SELECT name, public_key, status, teams, registered_at, approved_at FROM agents'
  ).all();

  res.json(agents.map((a: any) => ({
    name: a.name,
    publicKey: a.public_key,
    status: a.status,
    teams: JSON.parse(a.teams || '[]'),
    registeredAt: a.registered_at,
    approvedAt: a.approved_at,
  })));
});

/**
 * Admin: Approve a pending agent.
 */
registryRouter.post('/agents/:name/approve', requireAdminAuth, (req, res) => {
  const { name } = req.params;
  const db = getDb();

  const agent = db.prepare('SELECT name, status FROM agents WHERE name = ?').get(name) as
    | { name: string; status: string }
    | undefined;

  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  if (agent.status === 'active') {
    res.json({ name, status: 'active', message: 'Already active' });
    return;
  }

  db.prepare(
    "UPDATE agents SET status = 'active', approved_at = datetime('now') WHERE name = ?"
  ).run(name);

  console.log(`[registry] Agent approved: ${name}`);
  res.json({ name, status: 'active' });
});

/**
 * Admin: Revoke an agent.
 */
registryRouter.post('/agents/:name/revoke', requireAdminAuth, (req, res) => {
  const { name } = req.params;
  const db = getDb();

  const agent = db.prepare('SELECT name, status FROM agents WHERE name = ?').get(name) as
    | { name: string; status: string }
    | undefined;

  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  db.prepare("UPDATE agents SET status = 'revoked' WHERE name = ?").run(name);

  console.log(`[registry] Agent revoked: ${name}`);
  res.json({ name, status: 'revoked' });
});
