/**
 * Access Control — centralized sender classification and 3rd-party state management.
 *
 * Classification tiers (checked in order):
 *   1. blocked  → silently drop
 *   2. safe     → full access (existing safe-senders.json)
 *   3. approved → inject with [3rdParty] tag
 *   4. denied   → re-trigger approval flow
 *   5. unknown  → hold, notify primary, wait for approval
 */

import fs from 'node:fs';
import { loadConfig, resolveProjectPath } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('access-control');

// ── Types ───────────────────────────────────────────────────

export type SenderTier = 'blocked' | 'safe' | 'approved' | 'denied' | 'unknown';

export interface ApprovedSender {
  id: string;
  channel: string;
  name: string;
  type: 'human' | 'agent';
  approved_date: string;
  approved_by: string;
  expires: string | null;
  notes: string;
}

export interface DeniedSender {
  id: string;
  channel: string;
  name: string;
  denied_date: string;
  denial_count: number;
  reason: string;
}

export interface BlockedSender {
  id: string;
  channel: string;
  name: string;
  blocked_date: string;
  blocked_by: 'agent' | 'primary';
  reason: string;
}

export interface PendingSender {
  id: string;
  channel: string;
  name: string;
  requested_date: string;
  message: string;
}

export interface ThirdPartySendersState {
  approved: ApprovedSender[];
  denied: DeniedSender[];
  blocked: BlockedSender[];
  pending: PendingSender[];
}

// ── State file I/O ──────────────────────────────────────────

function getStateFilePath(): string {
  return resolveProjectPath(loadConfig().security.third_party_senders_file);
}

function getSafeSendersPath(): string {
  return resolveProjectPath(loadConfig().security.safe_senders_file);
}

/**
 * Read state fresh from disk every time (no stale cache).
 */
export function readState(): ThirdPartySendersState {
  try {
    const raw = fs.readFileSync(getStateFilePath(), 'utf8');
    return JSON.parse(raw) as ThirdPartySendersState;
  } catch {
    return { approved: [], denied: [], blocked: [], pending: [] };
  }
}

function writeState(state: ThirdPartySendersState): void {
  fs.writeFileSync(getStateFilePath(), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// ── Safe sender check ───────────────────────────────────────

function isSafeSender(id: string, channel: string): boolean {
  try {
    const raw = fs.readFileSync(getSafeSendersPath(), 'utf8');
    const data = JSON.parse(raw);
    if (channel === 'telegram') {
      return (data.telegram?.users ?? []).includes(id);
    }
    if (channel === 'email') {
      return (data.email?.addresses ?? []).includes(id);
    }
    return false;
  } catch {
    return false;
  }
}

// ── Classification ──────────────────────────────────────────

/**
 * Classify a sender into one of the five tiers.
 * Reads state fresh from disk each call.
 */
export function classifySender(id: string, channel: string): SenderTier {
  const state = readState();

  // 1. Blocked — check first (highest priority)
  if (state.blocked.some(s => s.id === id && s.channel === channel)) {
    return 'blocked';
  }

  // 2. Safe sender (existing safe-senders.json)
  if (isSafeSender(id, channel)) {
    return 'safe';
  }

  // 3. Approved 3rd party (with expiry check)
  const approved = state.approved.find(s => s.id === id && s.channel === channel);
  if (approved) {
    if (approved.expires && new Date(approved.expires) < new Date()) {
      // Expired — treat as unknown (triggers re-approval)
      return 'unknown';
    }
    return 'approved';
  }

  // 4. Denied (recently)
  if (state.denied.some(s => s.id === id && s.channel === channel)) {
    return 'denied';
  }

  // 5. Unknown
  return 'unknown';
}

// ── CRUD operations ─────────────────────────────────────────

export function addApproved(sender: Omit<ApprovedSender, 'approved_date'>): void {
  const state = readState();

  // Remove from denied/pending if present
  state.denied = state.denied.filter(s => !(s.id === sender.id && s.channel === sender.channel));
  state.pending = state.pending.filter(s => !(s.id === sender.id && s.channel === sender.channel));

  // Remove existing approval if re-approving
  state.approved = state.approved.filter(s => !(s.id === sender.id && s.channel === sender.channel));

  state.approved.push({
    ...sender,
    approved_date: new Date().toISOString(),
  });

  writeState(state);
  log.info(`Added approved sender: ${sender.name} (${sender.id}) on ${sender.channel}`);
}

export function addDenied(id: string, channel: string, name: string, reason: string): void {
  const state = readState();

  // Remove from pending if present
  state.pending = state.pending.filter(s => !(s.id === id && s.channel === channel));

  // Increment denial count if already denied, else add new
  const existing = state.denied.find(s => s.id === id && s.channel === channel);
  if (existing) {
    existing.denial_count += 1;
    existing.denied_date = new Date().toISOString();
    existing.reason = reason;
  } else {
    state.denied.push({
      id,
      channel,
      name,
      denied_date: new Date().toISOString(),
      denial_count: 1,
      reason,
    });
  }

  writeState(state);
  log.info(`Denied sender: ${name} (${id}) on ${channel} — reason: ${reason}`);
}

export function addBlocked(id: string, channel: string, name: string, blockedBy: 'agent' | 'primary', reason: string): void {
  const state = readState();

  // Remove from denied/pending/approved if present
  state.denied = state.denied.filter(s => !(s.id === id && s.channel === channel));
  state.pending = state.pending.filter(s => !(s.id === id && s.channel === channel));
  state.approved = state.approved.filter(s => !(s.id === id && s.channel === channel));

  // Don't double-add
  if (!state.blocked.some(s => s.id === id && s.channel === channel)) {
    state.blocked.push({
      id,
      channel,
      name,
      blocked_date: new Date().toISOString(),
      blocked_by: blockedBy,
      reason,
    });
  }

  writeState(state);
  log.info(`Blocked sender: ${name} (${id}) on ${channel} — by: ${blockedBy}, reason: ${reason}`);
}

export function addPending(id: string, channel: string, name: string, message: string): void {
  const state = readState();

  // Don't double-add
  if (state.pending.some(s => s.id === id && s.channel === channel)) {
    return;
  }

  state.pending.push({
    id,
    channel,
    name,
    requested_date: new Date().toISOString(),
    message,
  });

  writeState(state);
  log.info(`Added pending sender: ${name} (${id}) on ${channel}`);
}

export function removeSender(id: string, channel: string): void {
  const state = readState();
  state.approved = state.approved.filter(s => !(s.id === id && s.channel === channel));
  state.denied = state.denied.filter(s => !(s.id === id && s.channel === channel));
  state.blocked = state.blocked.filter(s => !(s.id === id && s.channel === channel));
  state.pending = state.pending.filter(s => !(s.id === id && s.channel === channel));
  writeState(state);
  log.info(`Removed sender ${id} from all lists on ${channel}`);
}

export function unblockSender(id: string, channel: string): void {
  const state = readState();
  state.blocked = state.blocked.filter(s => !(s.id === id && s.channel === channel));
  writeState(state);
  log.info(`Unblocked sender ${id} on ${channel}`);
}

/**
 * Get the denial count for a sender. Used for auto-block threshold.
 */
export function getDenialCount(id: string, channel: string): number {
  const state = readState();
  const entry = state.denied.find(s => s.id === id && s.channel === channel);
  return entry?.denial_count ?? 0;
}

/**
 * Get a pending sender entry by ID and channel.
 */
export function getPending(id: string, channel: string): PendingSender | undefined {
  const state = readState();
  return state.pending.find(s => s.id === id && s.channel === channel);
}

/**
 * Check if a sender has a pending approval request.
 */
export function isPending(id: string, channel: string): boolean {
  return getPending(id, channel) !== undefined;
}

// ── Rate limiting ───────────────────────────────────────────

// In-memory sliding window for incoming messages per sender
const _incomingWindows: Map<string, number[]> = new Map();

/**
 * Check and record an incoming message for rate limiting.
 * Returns true if the message is within limits, false if rate-limited.
 */
export function checkIncomingRate(senderId: string, channel: string): boolean {
  const config = loadConfig();
  const maxPerMinute = config.security.rate_limits.incoming_max_per_minute;
  const key = `${channel}:${senderId}`;
  const now = Date.now();
  const windowMs = 60_000;

  let timestamps = _incomingWindows.get(key) ?? [];
  // Prune old entries
  timestamps = timestamps.filter(t => now - t < windowMs);

  if (timestamps.length >= maxPerMinute) {
    _incomingWindows.set(key, timestamps);
    return false; // rate-limited
  }

  timestamps.push(now);
  _incomingWindows.set(key, timestamps);
  return true;
}

// In-memory token bucket for outgoing messages per recipient
const _outgoingBuckets: Map<string, { tokens: number; lastRefill: number }> = new Map();

/**
 * Check and consume an outgoing message token for rate limiting.
 * Returns true if the message can be sent, false if rate-limited.
 */
export function checkOutgoingRate(recipientId: string, channel: string): boolean {
  const config = loadConfig();
  const maxPerMinute = config.security.rate_limits.outgoing_max_per_minute;
  const key = `${channel}:${recipientId}`;
  const now = Date.now();

  let bucket = _outgoingBuckets.get(key);
  if (!bucket) {
    bucket = { tokens: maxPerMinute, lastRefill: now };
    _outgoingBuckets.set(key, bucket);
  }

  // Refill tokens based on time elapsed
  const elapsed = now - bucket.lastRefill;
  const tokensToAdd = (elapsed / 60_000) * maxPerMinute;
  bucket.tokens = Math.min(maxPerMinute, bucket.tokens + tokensToAdd);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    return false; // rate-limited
  }

  bucket.tokens -= 1;
  return true;
}
