/**
 * Scheduler — cron/interval task runner with built-in busy checks.
 *
 * Replaces 5+ launchd jobs with a single in-process scheduler.
 * Each task gets its own interval or cron schedule from config.
 * Tasks run when Claude is not actively processing (no spinner/esc-to-interrupt).
 * Individual tasks handle their own busy-state logic internally if needed.
 */

import { loadConfig, parseInterval, type TaskScheduleConfig } from '../core/config.js';
import { isActivelyProcessing, sessionExists } from '../core/session-bridge.js';
import { createLogger } from '../core/logger.js';
import { CronExpressionParser } from 'cron-parser';

const log = createLogger('scheduler');

export interface ScheduledTask {
  name: string;
  run: () => Promise<void>;
}

interface RunningTask {
  config: TaskScheduleConfig;
  task: ScheduledTask;
  timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null;
  lastRun: number;
  nextCronTime: number | null;
}

const _tasks = new Map<string, RunningTask>();
const _registry = new Map<string, ScheduledTask>();
let _cronCheckInterval: ReturnType<typeof setInterval> | null = null;

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
  // Skip if Claude is actively processing (mid-response)
  // Individual tasks handle their own busy-state logic if they need
  // the stricter check (e.g., context-watchdog uses isBusy() internally)
  if (isActivelyProcessing()) {
    log.debug(`Skipping ${running.task.name}: Claude is actively processing`);
    return false;
  }

  // Skip if no session (for tasks that need to inject)
  if (!sessionExists()) {
    log.debug(`Skipping ${running.task.name}: no session`);
    return false;
  }

  try {
    log.info(`Running task: ${running.task.name}`);
    await running.task.run();
    running.lastRun = Date.now();
    log.info(`Task completed: ${running.task.name}`);
    return true;
  } catch (err) {
    log.error(`Task failed: ${running.task.name}`, {
      error: err instanceof Error ? err.message : String(err),
    });
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

  for (const taskConfig of config.scheduler.tasks) {
    if (!taskConfig.enabled) continue;

    const task = _registry.get(taskConfig.name);
    if (!task) {
      log.warn(`No implementation registered for task: ${taskConfig.name}`);
      continue;
    }

    const running: RunningTask = {
      config: taskConfig,
      task,
      timer: null,
      lastRun: 0,
      nextCronTime: null,
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
