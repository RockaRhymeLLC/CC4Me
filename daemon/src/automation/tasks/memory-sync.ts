/**
 * Memory Sync task — share memories with peer agents.
 *
 * Phase 4 of Knowledge Management v2 spec.
 * Sends shareable memories to configured peers every 30 minutes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { loadConfig, getProjectDir } from '../../core/config.js';
import { getAgentCommsSecret } from '../../core/keychain.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('memory-sync');

const PRIVATE_CATEGORIES = ['account'];
const PRIVATE_TAGS = ['pii', 'credential', 'financial', 'keychain', 'secret', 'password'];

interface MemoryFile {
  filename: string;
  subject: string;
  category: string;
  content: string;
}

function isPrivateMemory(content: string): boolean {
  const lowerContent = content.toLowerCase();

  for (const tag of PRIVATE_TAGS) {
    if (lowerContent.includes(tag)) return true;
  }

  if (lowerContent.includes('keychain:') || lowerContent.includes('credential-')) return true;

  return false;
}

function isPeerSourced(content: string): boolean {
  // Don't echo back memories we received from peers
  return /source:\s*peer-/i.test(content);
}

function parseCategory(content: string): string {
  const match = content.match(/category:\s*(\S+)/);
  return match?.[1] ?? 'other';
}

function parseSubject(content: string): string {
  const match = content.match(/subject:\s*(.+)/);
  return match?.[1]?.trim() ?? 'unknown';
}

function getShareableMemories(): MemoryFile[] {
  const memoryDir = path.join(getProjectDir(), '.claude', 'state', 'memory', 'memories');
  const memories: MemoryFile[] = [];

  if (!fs.existsSync(memoryDir)) return memories;

  const files = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'));

  for (const filename of files) {
    try {
      const filepath = path.join(memoryDir, filename);
      const content = fs.readFileSync(filepath, 'utf8');
      const category = parseCategory(content);

      // Skip private
      if (PRIVATE_CATEGORIES.includes(category)) continue;
      if (isPrivateMemory(content)) continue;

      // Skip peer-sourced (no echo)
      if (isPeerSourced(content)) continue;

      memories.push({
        filename,
        subject: parseSubject(content),
        category,
        content,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return memories;
}

async function syncToPeer(peerName: string, peerHost: string, peerPort: number): Promise<void> {
  const config = loadConfig();
  const secret = getAgentCommsSecret();

  if (!secret) {
    log.warn('Memory sync: no agent-comms secret configured');
    return;
  }

  const memories = getShareableMemories();
  if (memories.length === 0) {
    log.info('Memory sync: no shareable memories to send');
    return;
  }

  const payload = JSON.stringify({
    from: config.agent.name.toLowerCase(),
    memories,
  });

  const url = `http://${peerHost}:${peerPort}/agent/memory-sync`;

  return new Promise((resolve) => {
    execFile('curl', [
      '-s',
      '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${secret}`,
      '--connect-timeout', '10',
      '--max-time', '60',
      '-d', payload,
      url,
    ], { timeout: 65000 }, (err, stdout, stderr) => {
      if (err) {
        log.error(`Memory sync to ${peerName} failed`, {
          error: err.message,
          stderr,
        });
        resolve();
        return;
      }

      try {
        const result = JSON.parse(stdout) as {
          ok: boolean;
          accepted: number;
          skipped: number;
          updated: number;
          conflicts: number;
        };

        log.info(`Memory sync to ${peerName} complete`, {
          sent: memories.length,
          accepted: result.accepted,
          skipped: result.skipped,
          updated: result.updated,
          conflicts: result.conflicts,
        });
      } catch {
        log.warn(`Memory sync to ${peerName}: unexpected response`, { stdout: stdout.slice(0, 200) });
      }

      resolve();
    });
  });
}

async function run(): Promise<void> {
  const config = loadConfig();
  const agentComms = config['agent-comms'];

  if (!agentComms?.enabled || !agentComms.peers?.length) {
    return;
  }

  log.info('Starting memory sync cycle');

  for (const peer of agentComms.peers) {
    await syncToPeer(peer.name, peer.host, peer.port);
  }
}

registerTask({ name: 'memory-sync', run, requiresSession: false });
