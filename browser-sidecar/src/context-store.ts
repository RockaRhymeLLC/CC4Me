/**
 * context-store.ts — JSON manifest for Browserbase context persistence
 *
 * Maps site names to Browserbase context IDs with metadata.
 * Written atomically (temp + rename) to prevent corruption on crash.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Browserbase from '@browserbasehq/sdk';

// ── Types ────────────────────────────────────────────────────

export interface ContextEntry {
  contextId: string;
  domain: string;
  lastUsed: string;    // ISO timestamp
  lastVerified: string; // ISO timestamp — when cookies were last confirmed valid
  createdAt: string;    // ISO timestamp
}

export type ContextManifest = Record<string, ContextEntry>;

// ── State ────────────────────────────────────────────────────

let manifestPath: string = '';
let manifest: ContextManifest = {};
let bb: Browserbase | null = null;
let projectId: string = '';

// ── Init ─────────────────────────────────────────────────────

export function init(opts: {
  manifestPath: string;
  bb: Browserbase;
  projectId: string;
}): void {
  manifestPath = opts.manifestPath;
  bb = opts.bb;
  projectId = opts.projectId;
  load();
}

// ── Load / Save ──────────────────────────────────────────────

function load(): void {
  try {
    const data = fs.readFileSync(manifestPath, 'utf8');
    manifest = JSON.parse(data);
  } catch {
    manifest = {};
  }
}

function save(): void {
  const tmpPath = manifestPath + '.tmp.' + randomUUID().slice(0, 8);
  const data = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(tmpPath, data, 'utf8');
  fs.renameSync(tmpPath, manifestPath);
}

// ── Public API ───────────────────────────────────────────────

export function getContext(name: string): ContextEntry | null {
  return manifest[name] ?? null;
}

export function listContexts(): ContextManifest {
  return { ...manifest };
}

export async function getOrCreateContext(name: string, domain: string): Promise<string> {
  const existing = manifest[name];
  if (existing) {
    return existing.contextId;
  }

  // Create a new context via Browserbase API
  if (!bb) throw new Error('Context store not initialized');

  const context = await bb.contexts.create({ projectId });
  const now = new Date().toISOString();

  manifest[name] = {
    contextId: context.id,
    domain,
    lastUsed: now,
    lastVerified: now,
    createdAt: now,
  };
  save();

  return context.id;
}

export function updateLastUsed(name: string): void {
  if (manifest[name]) {
    manifest[name].lastUsed = new Date().toISOString();
    save();
  }
}

export function updateLastVerified(name: string): void {
  if (manifest[name]) {
    manifest[name].lastVerified = new Date().toISOString();
    save();
  }
}

export function markExpired(name: string): void {
  if (manifest[name]) {
    // Set lastVerified to epoch to indicate cookies are expired
    manifest[name].lastVerified = '1970-01-01T00:00:00.000Z';
    save();
  }
}

export function deleteContext(name: string): boolean {
  const entry = manifest[name];
  if (!entry) return false;

  // Note: Browserbase SDK doesn't expose a context delete API.
  // We remove from our manifest — the context will expire on Browserbase's side.
  delete manifest[name];
  save();
  return true;
}
