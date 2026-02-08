/**
 * Todo Reminder — prompts Claude to work on pending todos.
 *
 * Replaces: todo-reminder.sh + legacy launchd job
 */

import fs from 'node:fs';
import { resolveProjectPath } from '../../core/config.js';
import { injectText, isIdle, sessionExists } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('todo-reminder');

async function run(): Promise<void> {
  // We handle our own session/idle checks (requiresSession: false bypasses
  // the scheduler's isActivelyProcessing guard, which has false-positive
  // issues with the status line Unicode).

  if (!sessionExists()) {
    log.debug('Skipping reminder: no tmux session');
    return;
  }

  const todosDir = resolveProjectPath('.claude', 'state', 'todos');

  if (!fs.existsSync(todosDir)) return;

  // Count open and in-progress todos
  const files = fs.readdirSync(todosDir);
  const openTodos = files.filter(f =>
    (f.includes('-open-') || f.includes('-in-progress-')) && f.endsWith('.json'),
  );
  const openCount = openTodos.length;

  if (openCount === 0) {
    log.debug('No open todos');
    return;
  }

  // Only remind when idle — don't interrupt active work.
  // isIdle() checks for the ❯ prompt which is definitive "waiting for input".
  if (!isIdle()) {
    log.debug(`Skipping reminder: not idle (${openCount} open todos)`);
    return;
  }

  // Find the highest priority todo to suggest
  let suggestion = '';
  try {
    const sorted = openTodos.sort(); // Files sort by priority prefix (1-, 2-, 3-, 4-)
    const topFile = sorted[0];
    if (topFile) {
      const todo = JSON.parse(fs.readFileSync(`${todosDir}/${topFile}`, 'utf8'));
      suggestion = ` Highest priority: [${todo.id}] ${todo.title}`;
    }
  } catch {
    // Ignore parse errors, just omit the suggestion
  }

  log.info(`Reminding about ${openCount} open todo(s)`);

  const reminder = `[System] You have ${openCount} open todo(s).${suggestion} Run /todo list, pick one, and start working on it now.`;
  injectText(reminder);
}

registerTask({ name: 'todo-reminder', run, requiresSession: false });
