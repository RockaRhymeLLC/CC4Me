/**
 * Authentication middleware for CC4Me relay.
 *
 * Two auth modes:
 * 1. Agent auth: X-Agent + X-Signature headers (Ed25519 signature verification)
 * 2. Admin auth: X-Admin-Secret header
 *
 * Some endpoints are unauthenticated (registration, directory).
 */

import { verify, createPublicKey } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getDb } from './db.js';

const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

/**
 * Verify an Ed25519 signature.
 */
function verifyEd25519(payload: string, signatureBase64: string, publicKeyBase64: string): boolean {
  try {
    if (!signatureBase64 || !publicKeyBase64) return false;
    const keyObj = createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return verify(null, Buffer.from(payload), keyObj, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

/**
 * Build the signing payload for a request.
 * - POST/PUT/PATCH: the request body (JSON string)
 * - GET/DELETE: "METHOD /path TIMESTAMP" from X-Timestamp header
 */
function getSigningPayload(req: Request): string {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    // Body is the raw JSON string
    return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  // For bodyless requests, sign method + path + timestamp
  const timestamp = req.get('X-Timestamp') || '';
  return `${req.method} ${req.path} ${timestamp}`;
}

/**
 * Middleware: Verify agent signature.
 * Requires X-Agent and X-Signature headers.
 * Attaches req.agent (name) and req.agentStatus on success.
 */
export function requireAgentAuth(req: Request, res: Response, next: NextFunction): void {
  const agentName = req.get('X-Agent');
  const signature = req.get('X-Signature');

  if (!agentName || !signature) {
    res.status(401).json({ error: 'Missing X-Agent or X-Signature header' });
    return;
  }

  const db = getDb();
  const agent = db.prepare('SELECT name, public_key, status FROM agents WHERE name = ?').get(agentName) as
    | { name: string; public_key: string; status: string }
    | undefined;

  if (!agent) {
    res.status(401).json({ error: 'Unknown agent' });
    return;
  }

  if (agent.status === 'revoked') {
    res.status(403).json({ error: 'Agent revoked' });
    return;
  }

  if (agent.status === 'pending') {
    res.status(403).json({ error: 'Agent pending approval' });
    return;
  }

  const payload = getSigningPayload(req);
  if (!verifyEd25519(payload, signature, agent.public_key)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  // Attach agent info to request
  (req as any).agentName = agent.name;
  (req as any).agentStatus = agent.status;
  next();
}

/**
 * Middleware: Verify admin secret.
 * Requires X-Admin-Secret header.
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = req.get('X-Admin-Secret');

  if (!secret || secret !== ADMIN_SECRET) {
    res.status(401).json({ error: 'Invalid admin secret' });
    return;
  }

  next();
}

/**
 * Middleware: Verify the authenticated agent matches the :agent URL param.
 * Must be used AFTER requireAgentAuth.
 */
export function requireSelfAuth(req: Request, res: Response, next: NextFunction): void {
  const urlAgent = req.params.agent;
  const authAgent = (req as any).agentName;

  if (urlAgent !== authAgent) {
    res.status(403).json({ error: 'Cannot access another agent\'s resources' });
    return;
  }

  next();
}

/**
 * Simple per-agent rate limiter. 10 req/s per agent.
 */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const agent = req.get('X-Agent') || req.ip || 'anon';
  const now = Date.now();
  let bucket = rateBuckets.get(agent);

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 1000 };
    rateBuckets.set(agent, bucket);
  }

  bucket.count++;
  if (bucket.count > 10) {
    res.status(429).json({ error: 'Rate limit exceeded (10 req/s)' });
    return;
  }

  next();
}
