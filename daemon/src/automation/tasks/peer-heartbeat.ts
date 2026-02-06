/**
 * Peer Heartbeat task — periodic connectivity check for A2A peers.
 *
 * Pings each configured peer's /health endpoint every 5 minutes.
 * Logs results to agent-comms.log with direction='heartbeat'.
 * Proactively detects connectivity issues before message delivery fails.
 */

import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { loadConfig, resolveProjectPath, type AgentCommsPeerConfig } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('peer-heartbeat');

interface HeartbeatLogEntry {
  ts: string;
  direction: 'heartbeat';
  peer: string;
  host: string;
  port: number;
  reachable: boolean;
  latencyMs?: number;
  httpStatus?: number;
  error?: string;
}

/**
 * Log a heartbeat result to agent-comms.log JSONL.
 */
function logHeartbeat(entry: HeartbeatLogEntry): void {
  const logPath = resolveProjectPath('logs', 'agent-comms.log');

  // Ensure logs directory exists
  const logDir = resolveProjectPath('logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logPath, line);
}

/**
 * Ping a single peer's /health endpoint.
 * Returns { reachable, latencyMs, httpStatus, error }
 */
async function pingPeer(peer: AgentCommsPeerConfig): Promise<{
  reachable: boolean;
  latencyMs?: number;
  httpStatus?: number;
  error?: string;
}> {
  const url = `http://${peer.host}:${peer.port}/health`;
  const startTime = Date.now();

  return new Promise((resolve) => {
    // Use curl with timing info
    // -w outputs timing, -o /dev/null discards body, -s silent
    const args = [
      '-s',
      '-o', '/dev/null',
      '-w', '%{http_code},%{time_total}',
      '--connect-timeout', '5',
      '--max-time', '10',
      url,
    ];

    execFile('curl', args, { timeout: 15000 }, (err, stdout, stderr) => {
      const elapsed = Date.now() - startTime;

      if (err) {
        // Connection failed entirely
        const errorDetail = stderr?.trim() || err.message || 'connection failed';
        resolve({
          reachable: false,
          latencyMs: elapsed,
          error: errorDetail,
        });
        return;
      }

      // Parse curl output: "200,0.042" (http_code,time_total)
      const parts = stdout.trim().split(',');
      const httpStatus = parseInt(parts[0], 10);
      const curlTime = parseFloat(parts[1]) * 1000; // convert to ms

      if (httpStatus === 0 || isNaN(httpStatus)) {
        resolve({
          reachable: false,
          latencyMs: elapsed,
          error: 'no response',
        });
        return;
      }

      resolve({
        reachable: httpStatus >= 200 && httpStatus < 400,
        latencyMs: Math.round(curlTime),
        httpStatus,
      });
    });
  });
}

/**
 * Run heartbeat checks for all configured peers.
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

  log.info(`Running heartbeat check for ${peers.length} peer(s)`);

  for (const peer of peers) {
    const result = await pingPeer(peer);

    const entry: HeartbeatLogEntry = {
      ts: new Date().toISOString(),
      direction: 'heartbeat',
      peer: peer.name,
      host: peer.host,
      port: peer.port,
      reachable: result.reachable,
      ...(result.latencyMs !== undefined && { latencyMs: result.latencyMs }),
      ...(result.httpStatus !== undefined && { httpStatus: result.httpStatus }),
      ...(result.error && { error: result.error }),
    };

    logHeartbeat(entry);

    if (result.reachable) {
      log.info(`Peer ${peer.name} reachable`, {
        latencyMs: result.latencyMs,
        httpStatus: result.httpStatus,
      });
    } else {
      log.warn(`Peer ${peer.name} unreachable`, {
        host: peer.host,
        error: result.error,
      });
    }
  }
}

registerTask({ name: 'peer-heartbeat', run });
