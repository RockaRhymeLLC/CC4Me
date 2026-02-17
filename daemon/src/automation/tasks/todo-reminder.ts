/**
 * Todo Reminder — prompts Claude to work on pending todos.
 *
 * Replaces: todo-reminder.sh + legacy launchd job
 */

import fs from 'node:fs';
import { resolveProjectPath } from '../../core/config.js';
import { injectText, sessionExists } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('todo-reminder');

async function run(): Promise<void> {
  // We handle our own session/idle checks (requiresSession: false bypasses
  // the scheduler's idle gate so we can check sessionExists separately).

  if (!sessionExists()) {
    log.debug('Skipping reminder: no tmux session');
    return;
  }

  const todosDir = resolveProjectPath('.claude', 'state', 'todos');

  if (!fs.existsSync(todosDir)) return;

  // Count open, in-progress, and blocked todos
  const files = fs.readdirSync(todosDir);
  const openTodos = files.filter(f =>
    (f.includes('-open-') || f.includes('-in-progress-') || f.includes('-blocked-')) && f.endsWith('.json'),
  );
  const openCount = openTodos.length;

  if (openCount === 0) {
    log.debug('No open todos');
    return;
  }

  // Categorize todos: actionable vs blocked
  let blockedCount = 0;
  const actionable: { id: string; title: string; file: string }[] = [];
  for (const file of openTodos) {
    try {
      const todo = JSON.parse(fs.readFileSync(`${todosDir}/${file}`, 'utf8'));
      if (todo.status === 'blocked' || file.includes('-blocked-')) {
        blockedCount++;
      } else {
        actionable.push({ id: todo.id, title: todo.title, file });
      }
    } catch {
      // Ignore parse errors
    }
  }

  // If ALL todos are blocked, skip the nag — just log it
  if (actionable.length === 0 && blockedCount > 0) {
    log.debug(`All ${blockedCount} todo(s) are blocked — skipping reminder`);
    return;
  }

  // Find the highest priority actionable todo to suggest
  let suggestion = '';
  const sorted = actionable.sort((a, b) => a.file.localeCompare(b.file));
  if (sorted[0]) {
    suggestion = ` Highest priority: [${sorted[0].id}] ${sorted[0].title}`;
  }

  const blockedNote = blockedCount > 0 ? ` (${blockedCount} blocked)` : '';
  log.info(`Reminding about ${actionable.length} actionable todo(s)${blockedNote}`);

  const reminder = `[System] You have ${actionable.length} actionable todo(s)${blockedNote}.${suggestion} Run /todo list, pick one, and start working on it now.`;
  injectText(reminder);
}

registerTask({ name: 'todo-reminder', run, requiresSession: false });
