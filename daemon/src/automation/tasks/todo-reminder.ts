/**
 * Todo Reminder — prompts Claude to work on pending todos.
 *
 * Replaces: todo-reminder.sh + com.assistant.todo-reminder launchd job
 */

import fs from 'node:fs';
import { resolveProjectPath } from '../../core/config.js';
import { injectText } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('todo-reminder');

async function run(): Promise<void> {
  const todosDir = resolveProjectPath('.claude', 'state', 'todos');

  if (!fs.existsSync(todosDir)) return;

  // Count open and in-progress todos
  const files = fs.readdirSync(todosDir);
  const openCount = files.filter(f =>
    (f.includes('-open-') || f.includes('-in-progress-')) && f.endsWith('.json'),
  ).length;

  if (openCount === 0) {
    log.debug('No open todos');
    return;
  }

  log.info(`Reminding about ${openCount} open todo(s)`);

  const reminder = `[System] You have ${openCount} open todo(s). Run /todo list, pick the highest priority one, and start working on it now.`;
  injectText(reminder);
}

registerTask({ name: 'todo-reminder', run });
