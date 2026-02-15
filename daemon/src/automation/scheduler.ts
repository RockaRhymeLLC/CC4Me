/**
 * Scheduler — cron/interval task runner.
 *
 * Replaces 5+ launchd jobs with a single in-process scheduler.
 * Each task gets its own interval or cron schedule from config.
 * Tasks only run when the agent is idle (based on hook-event state tracking).
 * Individual tasks can opt out via requiresSession: false.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, parseInterval, type TaskScheduleConfig } from '../core/config.js';
import { isAgentIdle, sessionExists } from '../core/session-bridge.js';
import { createLogger } from '../core/logger.js';
import { CronExpressionParser } from 'cron-parser';

const log = createLogger('scheduler');

export interface ScheduledTask {
  name: string;
  run: () => Promise<void>;
  /** If false, task handles session checks internally (e.g. has a fallback). Default: true. */
  requiresSession?: boolean;
}

interface RunningTask {
  config: TaskScheduleConfig;
  task: ScheduledTask;
  timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null;
  lastRun: number;
  nextCronTime: number | null;
  successCount: number;
  failureCount: number;
  lastError: string | null;
}

const _tasks = new Map<string, RunningTask>();
const _registry = new Map<string, ScheduledTask>();
let _cronCheckInterval: ReturnType<typeof setInterval> | null = null;

// Persistent state file for lastRun timestamps
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, '..', '..', '..', '.claude', 'state', 'scheduler-state.json');

interface TaskState {
  lastRun: number;
  successCount?: number;
  failureCount?: number;
  lastError?: string | null;
}

type SchedulerState = Record<string, number | TaskState>; // supports legacy (number) and new (object) format

function loadState(): SchedulerState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

/** Parse a state entry (handles legacy number format and new object format). */
function parseStateEntry(entry: number | TaskState): TaskState {
  if (typeof entry === 'number') {
    return { lastRun: entry };
  }
  return entry;
}

function saveState(): void {
  const state: SchedulerState = {};
  for (const [name, running] of _tasks) {
    if (running.lastRun > 0) {
      state[name] = {
        lastRun: running.lastRun,
        successCount: running.successCount,
        failureCount: running.failureCount,
        lastError: running.lastError,
      };
    }
  }
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
  } catch (err) {
    log.warn('Failed to persist scheduler state', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Register a task implementation. Call before startScheduler().
 */
export function registerTask(task: ScheduledTask): void {
  _registry.set(task.name, task);
}

/**
 * Execute a task with busy-check guard.
 * Returns true if the task actually ran, false if skipped.
 */
async function executeTask(running: RunningTask): Promise<boolean> {
  // Frequent interval tasks (< 30m) log at debug to reduce noise
  const intervalMs = running.config.interval ? parseInterval(running.config.interval) : 0;
  const isFrequent = intervalMs > 0 && intervalMs < 30 * 60 * 1000;
  const taskLog = isFrequent ? log.debug.bind(log) : log.info.bind(log);

  // Skip if Claude is busy (based on hook events, not pane scraping)
  const needsSession = running.task.requiresSession !== false;

  if (needsSession && !isAgentIdle()) {
    taskLog(`Skipping ${running.task.name}: agent is busy`);
    return false;
  }

  // Skip if no session (for tasks that need to inject)
  if (needsSession && !sessionExists()) {
    log.warn(`Skipping ${running.task.name}: no tmux session`);
    return false;
  }

  try {
    taskLog(`Running task: ${running.task.name}`);
    await running.task.run();
    running.lastRun = Date.now();
    running.successCount++;
    running.lastError = null;
    saveState();
    taskLog(`Task completed: ${running.task.name}`);
    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    running.lastRun = Date.now();
    running.failureCount++;
    running.lastError = errorMsg;
    saveState();
    log.error(`Task failed: ${running.task.name}`, { error: errorMsg });
    return true; // Count failures as "ran" so we don't retry in a loop
  }
}

/**
 * Check all cron-based tasks and run any that are due.
 * Tasks that are skipped (busy/no session) keep their current nextCronTime
 * so they retry on the next 30-second check instead of being lost until tomorrow.
 */
async function checkCronTasks(): Promise<void> {
  const now = Date.now();

  for (const running of _tasks.values()) {
    if (!running.config.cron) continue;
    if (running.nextCronTime === null) continue;
    if (now < running.nextCronTime) continue;

    // Time to run — only advance nextCronTime if the task actually executed
    const didRun = await executeTask(running);

    if (didRun) {
      // Calculate next run time
      try {
        const expr = CronExpressionParser.parse(running.config.cron);
        running.nextCronTime = expr.next().toDate().getTime();
      } catch {
        running.nextCronTime = null;
      }
    }
    // If skipped, nextCronTime stays in the past so it retries next check
  }
}

/**
 * Start the scheduler. Reads config and starts all enabled tasks.
 */
export function startScheduler(): void {
  const config = loadConfig();
  const savedState = loadState();

  for (const taskConfig of config.scheduler.tasks) {
    if (!taskConfig.enabled) continue;

    const task = _registry.get(taskConfig.name);
    if (!task) {
      log.warn(`No implementation registered for task: ${taskConfig.name}`);
      continue;
    }

    const saved = savedState[taskConfig.name] ? parseStateEntry(savedState[taskConfig.name]!) : null;
    const running: RunningTask = {
      config: taskConfig,
      task,
      timer: null,
      lastRun: saved?.lastRun ?? 0,
      nextCronTime: null,
      successCount: saved?.successCount ?? 0,
      failureCount: saved?.failureCount ?? 0,
      lastError: saved?.lastError ?? null,
    };

    // Set up interval-based tasks
    if (taskConfig.interval) {
      const ms = parseInterval(taskConfig.interval);
      running.timer = setInterval(() => executeTask(running), ms);
      log.info(`Scheduled ${taskConfig.name} every ${taskConfig.interval}`);
    }

    // Set up cron-based tasks
    if (taskConfig.cron) {
      try {
        const expr = CronExpressionParser.parse(taskConfig.cron);
        running.nextCronTime = expr.next().toDate().getTime();
        log.info(`Scheduled ${taskConfig.name} (cron: ${taskConfig.cron}), next: ${running.nextCronTime ? new Date(running.nextCronTime).toISOString() : 'unknown'}`);
      } catch (err) {
        log.error(`Invalid cron for ${taskConfig.name}: ${taskConfig.cron}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    _tasks.set(taskConfig.name, running);
  }

  // Check cron tasks every 30 seconds
  _cronCheckInterval = setInterval(checkCronTasks, 30_000);

  log.info(`Scheduler started with ${_tasks.size} tasks`);
}

/**
 * List all registered task names and their last run time.
 */
export function listTasks(): { name: string; lastRun: number; nextRun?: number; interval?: string; cron?: string; successCount: number; failureCount: number; lastError: string | null }[] {
  return Array.from(_tasks.entries()).map(([name, running]) => ({
    name,
    lastRun: running.lastRun,
    ...(running.nextCronTime ? { nextRun: running.nextCronTime } : {}),
    interval: running.config.interval,
    cron: running.config.cron,
    successCount: running.successCount,
    failureCount: running.failureCount,
    lastError: running.lastError,
  }));
}

/**
 * Stop all scheduled tasks.
 */
export function stopScheduler(): void {
  for (const running of _tasks.values()) {
    if (running.timer) clearInterval(running.timer);
  }
  _tasks.clear();

  if (_cronCheckInterval) {
    clearInterval(_cronCheckInterval);
    _cronCheckInterval = null;
  }

  log.info('Scheduler stopped');
}

/**
 * Run a task by name (for manual trigger via API).
 * Bypasses idle check since it's an explicit request.
 */
export async function runTaskByName(name: string): Promise<{ ok: boolean; error?: string }> {
  const running = _tasks.get(name);
  if (!running) {
    // Check if task is registered but not enabled
    if (_registry.has(name)) {
      return { ok: false, error: `Task '${name}' is registered but not enabled in config` };
    }
    return { ok: false, error: `Task '${name}' not found` };
  }

  try {
    log.info(`Manual trigger: ${name}`);
    await running.task.run();
    running.lastRun = Date.now();
    log.info(`Manual trigger completed: ${name}`);
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`Manual trigger failed: ${name}`, { error });
    return { ok: false, error };
  }
}

/**
 * Get list of available tasks for the API.
 */
export function getTaskList(): Array<{ name: string; enabled: boolean; lastRun: number | null }> {
  const result: Array<{ name: string; enabled: boolean; lastRun: number | null }> = [];

  for (const [name, task] of _registry.entries()) {
    const running = _tasks.get(name);
    result.push({
      name,
      enabled: !!running,
      lastRun: running?.lastRun || null,
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}
