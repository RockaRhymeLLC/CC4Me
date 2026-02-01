/**
 * System health checks — disk, memory, processes, network, state files.
 * Replaces health-check.sh with a structured, programmatic implementation.
 */

import { execSync } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, resolveProjectPath, getProjectDir } from './config.js';
import { sessionExists } from './session-bridge.js';
import { createLogger } from './logger.js';

const log = createLogger('health');

export type Severity = 'ok' | 'warn' | 'error';

export interface HealthResult {
  severity: Severity;
  category: string;
  message: string;
  detail?: string;
}

export interface HealthReport {
  timestamp: string;
  summary: { ok: number; warnings: number; errors: number };
  results: HealthResult[];
}

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

// ── Individual checks ────────────────────────────────────────

function checkDisk(): HealthResult[] {
  const results: HealthResult[] = [];
  const output = exec("df -h / | awk 'NR==2 {print $5, $4}'");
  if (output) {
    const [usagePct, available] = output.split(' ');
    const usage = parseInt(usagePct!.replace('%', ''), 10);
    const severity: Severity = usage >= 90 ? 'error' : usage >= 75 ? 'warn' : 'ok';
    results.push({ severity, category: 'Disk', message: `Root volume ${usage}% full`, detail: `${available} available` });
  }
  return results;
}

function checkMemory(): HealthResult[] {
  const results: HealthResult[] = [];
  const pressure = exec('sysctl -n kern.memorystatus_vm_pressure_level');
  const level = parseInt(pressure, 10) || 0;
  const severity: Severity = level >= 4 ? 'error' : level >= 2 ? 'warn' : 'ok';
  const label = level >= 4 ? 'CRITICAL' : level >= 2 ? 'WARNING' : 'normal';
  results.push({ severity, category: 'Memory', message: `Memory pressure: ${label}` });

  const swapOutput = exec('sysctl -n vm.swapusage');
  const swapMatch = swapOutput.match(/used = (\S+)/);
  if (swapMatch && swapMatch[1] !== '0.00M' && swapMatch[1] !== '0M') {
    results.push({ severity: 'warn', category: 'Memory', message: `Swap in use: ${swapMatch[1]}` });
  }

  return results;
}

function checkLogs(): HealthResult[] {
  const results: HealthResult[] = [];
  const logDir = resolveProjectPath(loadConfig().daemon.log_dir);

  if (!fs.existsSync(logDir)) {
    results.push({ severity: 'warn', category: 'Logs', message: 'Log directory not found' });
    return results;
  }

  let totalSize = 0;
  const largeFiles: string[] = [];

  const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
  for (const file of files) {
    const filePath = path.join(logDir, file);
    const stats = fs.statSync(filePath);
    totalSize += stats.size;
    if (stats.size > 1_048_576) {
      largeFiles.push(`${file}: ${(stats.size / 1_048_576).toFixed(1)}MB`);
    }
  }

  const totalMB = totalSize / 1_048_576;
  const severity: Severity = totalMB > 100 ? 'error' : totalMB > 10 ? 'warn' : 'ok';
  const sizeLabel = totalMB > 1 ? `${totalMB.toFixed(1)}MB` : `${(totalSize / 1024).toFixed(1)}KB`;
  results.push({ severity, category: 'Logs', message: `Total log size: ${sizeLabel}` });

  for (const lg of largeFiles) {
    results.push({ severity: 'warn', category: 'Logs', message: `Large log: ${lg}` });
  }

  return results;
}

function checkProcesses(): HealthResult[] {
  const results: HealthResult[] = [];

  // tmux session
  if (sessionExists()) {
    results.push({ severity: 'ok', category: 'Procs', message: `tmux session '${loadConfig().tmux.session}' active` });
  } else {
    results.push({ severity: 'error', category: 'Procs', message: `tmux session '${loadConfig().tmux.session}' not found` });
  }

  // Cloudflare tunnel
  const cfPid = exec('pgrep -f cloudflared');
  if (cfPid) {
    results.push({ severity: 'ok', category: 'Procs', message: 'Cloudflare tunnel running' });
  } else {
    results.push({ severity: 'warn', category: 'Procs', message: 'Cloudflare tunnel not running' });
  }

  return results;
}

/**
 * Check network connectivity using Node.js native HTTPS.
 * execSync('curl ...') fails from launchd context, but Node's https works fine.
 */
function checkNetwork(): Promise<HealthResult[]> {
  return new Promise((resolve) => {
    const results: HealthResult[] = [];

    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/',
      method: 'GET',
      timeout: 10_000,
    }, (res) => {
      // Any HTTP response means the API is reachable
      results.push({ severity: 'ok', category: 'Network', message: 'Telegram API reachable' });
      res.resume(); // drain response
      resolve(results);
    });

    req.on('timeout', () => {
      req.destroy();
      results.push({ severity: 'warn', category: 'Network', message: 'Telegram API timeout' });
      resolve(results);
    });

    req.on('error', (err) => {
      results.push({ severity: 'warn', category: 'Network', message: `Telegram API unreachable: ${err.message}` });
      resolve(results);
    });

    req.end();
  });
}

function checkState(): HealthResult[] {
  const results: HealthResult[] = [];
  const stateDir = resolveProjectPath('.claude', 'state');

  const required = ['autonomy.json', 'identity.json', 'channel.txt', 'safe-senders.json'];
  for (const file of required) {
    const filePath = path.join(stateDir, file);
    if (fs.existsSync(filePath)) {
      results.push({ severity: 'ok', category: 'State', message: `${file} exists` });
    } else {
      results.push({ severity: 'warn', category: 'State', message: `${file} missing` });
    }
  }

  // Check context usage freshness
  const ctxFile = path.join(stateDir, 'context-usage.json');
  if (fs.existsSync(ctxFile)) {
    const age = Math.floor((Date.now() - fs.statSync(ctxFile).mtimeMs) / 1000);
    if (age > 600) {
      results.push({ severity: 'warn', category: 'State', message: `context-usage.json stale (${age}s old)`, detail: 'Claude may be idle' });
    } else {
      results.push({ severity: 'ok', category: 'State', message: `context-usage.json fresh (${age}s old)` });
    }
  }

  return results;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Run all health checks and return a structured report.
 */
export async function runHealthCheck(): Promise<HealthReport> {
  const networkResults = await checkNetwork();
  const results = [
    ...checkDisk(),
    ...checkMemory(),
    ...checkLogs(),
    ...checkProcesses(),
    ...networkResults,
    ...checkState(),
  ];

  const summary = {
    ok: results.filter(r => r.severity === 'ok').length,
    warnings: results.filter(r => r.severity === 'warn').length,
    errors: results.filter(r => r.severity === 'error').length,
  };

  const report: HealthReport = {
    timestamp: new Date().toISOString(),
    summary,
    results,
  };

  log.info(`Health check: ${summary.ok} ok, ${summary.warnings} warnings, ${summary.errors} errors`);

  return report;
}

/**
 * Format a health report as readable text.
 */
export function formatReport(report: HealthReport, quiet = false): string {
  const lines: string[] = [];
  lines.push(`## System Health Check -- ${report.timestamp}`);
  lines.push('');

  let currentCategory = '';
  for (const r of report.results) {
    if (quiet && r.severity === 'ok') continue;

    if (r.category !== currentCategory) {
      lines.push('');
      lines.push(`### ${r.category}`);
      currentCategory = r.category;
    }

    const icon = r.severity === 'ok' ? 'OK' : r.severity === 'warn' ? 'WARN' : 'ERROR';
    const detail = r.detail ? ` -- ${r.detail}` : '';
    lines.push(`  [${icon}] ${r.message}${detail}`);
  }

  lines.push('');
  lines.push('---');
  lines.push(`Summary: ${report.summary.ok} ok, ${report.summary.warnings} warnings, ${report.summary.errors} errors`);

  return lines.join('\n');
}
