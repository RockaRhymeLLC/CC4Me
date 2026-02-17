/**
 * Peer Heartbeat task — periodic state exchange with A2A peers.
 *
 * POSTs our state to each peer's /agent/status endpoint every 5 minutes.
 * Peer replies with their state. Both sides cache each other's status.
 * Falls back to peer IP if hostname DNS resolution fails.
 *
 * Logs results to agent-comms.log with direction='heartbeat'.
 */

import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { loadConfig, resolveProjectPath, type AgentCommsPeerConfig } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import { updatePeerState } from '../../comms/agent-comms.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('peer-heartbeat');

interface HeartbeatLogEntry {
  ts: string;
  direction: 'heartbeat';
  peer: string;
  host: string;
  port: number;
  reachable: boolean;
  myStatus?: 'idle' | 'busy';
  peerStatus?: 'idle' | 'busy';
  latencyMs?: number;
  httpStatus?: number;
  usedFallbackIp?: boolean;
  error?: string;
}

// Track last logged state per peer to reduce heartbeat log noise.
// Only log when state changes or hourly for uptime stats.
const _lastLoggedState = new Map<string, { reachable: boolean; peerStatus?: string; loggedAt: number }>();
const HEARTBEAT_LOG_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Log a heartbeat result to agent-comms.log JSONL.
 * Only logs when peer state changes or once per hour (for uptime stats).
 */
function logHeartbeat(entry: HeartbeatLogEntry): void {
  const now = Date.now();
  const prev = _lastLoggedState.get(entry.peer);

  const stateChanged = !prev
    || prev.reachable !== entry.reachable
    || prev.peerStatus !== entry.peerStatus;
  const intervalElapsed = !prev || (now - prev.loggedAt) >= HEARTBEAT_LOG_INTERVAL_MS;

  if (!stateChanged && !intervalElapsed) return;

  _lastLoggedState.set(entry.peer, {
    reachable: entry.reachable,
    peerStatus: entry.peerStatus,
    loggedAt: now,
  });

  const logPath = resolveProjectPath('logs', 'agent-comms.log');

  // Ensure logs directory exists
  const logDir = resolveProjectPath('logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logPath, line);
}

interface ExchangeResult {
  reachable: boolean;
  peerStatus?: 'idle' | 'busy';
  latencyMs?: number;
  httpStatus?: number;
  usedFallbackIp?: boolean;
  error?: string;
}

/**
 * Make a single HTTP request via curl and parse the result.
 */
function curlRequest(
  method: 'GET' | 'POST',
  url: string,
  payload?: string,
): Promise<{ httpStatus: number; body: string; latencyMs: number } | { error: string; latencyMs: number }> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const args = [
      '-s',
      '-w', '\n%{http_code}',
      '-X', method,
      '--connect-timeout', '5',
      '--max-time', '10',
      ...(payload ? ['-H', 'Content-Type: application/json', '--data-raw', payload] : []),
      url,
    ];

    execFile('curl', args, { timeout: 15000 }, (err, stdout, stderr) => {
      const latencyMs = Date.now() - startTime;
      if (err) {
        resolve({ error: stderr?.trim() || err.message || 'connection failed', latencyMs });
        return;
      }
      const lines = stdout.trimEnd().split('\n');
      const httpStatus = parseInt(lines.pop() ?? '', 10) || 0;
      resolve({ httpStatus, body: lines.join('\n'), latencyMs });
    });
  });
}

/**
 * Parse peer status from a JSON response body.
 */
function parsePeerStatus(body: string): 'idle' | 'busy' | undefined {
  try {
    const data = JSON.parse(body) as { status?: string };
    if (data.status === 'idle' || data.status === 'busy') return data.status;
  } catch { /* not JSON */ }
  return undefined;
}

/**
 * POST our state to a peer's /agent/status and get their state back.
 * Falls back to GET if peer doesn't support POST (404).
 * Falls back to peer IP if hostname DNS resolution fails.
 */
async function exchangeState(peer: AgentCommsPeerConfig, myStatus: 'idle' | 'busy'): Promise<ExchangeResult> {
  const config = loadConfig();
  const payload = JSON.stringify({
    agent: config.agent.name,
    status: myStatus,
  });

  // Try hostname first, fall back to IP on DNS failure
  const hosts = [peer.host];
  if (peer.ip && peer.ip !== peer.host) {
    hosts.push(peer.ip);
  }

  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i];
    const usedFallback = i > 0;
    const baseUrl = `http://${host}:${peer.port}/agent/status`;

    // Try POST first (state exchange)
    const postResult = await curlRequest('POST', baseUrl, payload);

    if ('error' in postResult) {
      // Connection failed — try next host
      if (i < hosts.length - 1) {
        log.info(`Connection failed for ${peer.name} (${host}), trying fallback IP ${hosts[i + 1]}`);
        continue;
      }
      return { reachable: false, latencyMs: postResult.latencyMs, usedFallbackIp: usedFallback, error: postResult.error };
    }

    if (postResult.httpStatus >= 200 && postResult.httpStatus < 400) {
      // POST succeeded — peer supports state exchange
      return {
        reachable: true,
        peerStatus: parsePeerStatus(postResult.body),
        latencyMs: postResult.latencyMs,
        httpStatus: postResult.httpStatus,
        usedFallbackIp: usedFallback,
      };
    }

    if (postResult.httpStatus === 404) {
      // Peer doesn't support POST yet — fall back to GET
      log.debug(`Peer ${peer.name} doesn't support POST /agent/status, falling back to GET`);
      const getResult = await curlRequest('GET', baseUrl);

      if ('error' in getResult) {
        return { reachable: false, latencyMs: getResult.latencyMs, usedFallbackIp: usedFallback, error: getResult.error };
      }

      if (getResult.httpStatus >= 200 && getResult.httpStatus < 400) {
        return {
          reachable: true,
          peerStatus: parsePeerStatus(getResult.body),
          latencyMs: postResult.latencyMs + getResult.latencyMs,
          httpStatus: getResult.httpStatus,
          usedFallbackIp: usedFallback,
        };
      }
    }

    // Other error — if more hosts to try, continue
    if (i < hosts.length - 1) {
      log.info(`HTTP ${postResult.httpStatus} for ${peer.name} (${host}), trying fallback IP ${hosts[i + 1]}`);
      continue;
    }

    return {
      reachable: false,
      latencyMs: postResult.latencyMs,
      httpStatus: postResult.httpStatus,
      usedFallbackIp: usedFallback,
      error: `HTTP ${postResult.httpStatus}`,
    };
  }

  return { reachable: false, error: 'all hosts exhausted' };
}

/**
 * Run heartbeat state exchange for all configured peers.
 */
async function run(): Promise<void> {
  const config = loadConfig();
  const agentComms = config['agent-comms'];

  if (!agentComms?.enabled) {
    log.debug('Agent comms disabled, skipping heartbeat');
    return;
  }

  const peers = agentComms.peers || [];
  if (peers.length === 0) {
    log.debug('No peers configured, skipping heartbeat');
    return;
  }

  const myStatus: 'idle' | 'busy' = 'idle'; // Always report idle — busy detection removed
  log.debug(`Running heartbeat exchange for ${peers.length} peer(s)`);

  for (const peer of peers) {
    const result = await exchangeState(peer, myStatus);

    // Cache peer's reported state
    if (result.reachable) {
      updatePeerState(peer.name, {
        status: result.peerStatus ?? 'unknown',
        updatedAt: Date.now(),
        latencyMs: result.latencyMs,
      });
    } else {
      updatePeerState(peer.name, {
        status: 'unknown',
        updatedAt: Date.now(),
      });
    }

    const entry: HeartbeatLogEntry = {
      ts: new Date().toISOString(),
      direction: 'heartbeat',
      peer: peer.name,
      host: result.usedFallbackIp && peer.ip ? peer.ip : peer.host,
      port: peer.port,
      reachable: result.reachable,
      myStatus,
      ...(result.peerStatus && { peerStatus: result.peerStatus }),
      ...(result.latencyMs !== undefined && { latencyMs: result.latencyMs }),
      ...(result.httpStatus !== undefined && { httpStatus: result.httpStatus }),
      ...(result.usedFallbackIp && { usedFallbackIp: true }),
      ...(result.error && { error: result.error }),
    };

    logHeartbeat(entry);

    // Only log to daemon log on state changes or problems
    const prev = _lastLoggedState.get(peer.name);
    const stateChanged = !prev || prev.reachable !== result.reachable || prev.peerStatus !== result.peerStatus;

    if (result.reachable) {
      if (stateChanged) {
        log.info(`Peer ${peer.name}: ${result.peerStatus ?? 'unknown'}`, {
          latencyMs: result.latencyMs,
          usedFallbackIp: result.usedFallbackIp,
        });
      }
    } else {
      log.warn(`Peer ${peer.name} unreachable`, {
        host: peer.host,
        error: result.error,
        usedFallbackIp: result.usedFallbackIp,
      });
    }
  }
}

registerTask({ name: 'peer-heartbeat', run });
