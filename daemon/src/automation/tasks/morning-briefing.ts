/**
 * Morning Briefing — sends Dave a daily summary at 7am.
 *
 * Gathers: calendar events, weather, open todos, overnight messages.
 * If a Claude session is active, injects data as a prompt for a nicely
 * formatted briefing. If no session, sends a plain-text version directly
 * via Telegram so the briefing always arrives on time.
 */

import { execSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { injectText, sessionExists } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { getProjectDir } from '../../core/config.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('morning-briefing');

function gatherCalendar(): string {
  try {
    const output = execSync(
      'icalbuddy -n -nc -nrd -npn -ea -eep notes,url -b "• " -iep title,datetime,attendees eventsToday+1',
      { encoding: 'utf8', timeout: 10_000 },
    ).trim();
    return output || 'No events today.';
  } catch {
    log.warn('icalbuddy failed or not available');
    return 'Calendar unavailable.';
  }
}

function gatherWeather(): string {
  try {
    const output = execSync(
      'curl -s "wttr.in/White+Hall+MD?format=%c+%t+%h+humidity,+%w+wind,+%p+precip"',
      { encoding: 'utf8', timeout: 10_000 },
    ).trim();
    return output || 'Weather unavailable.';
  } catch {
    log.warn('Weather fetch failed');
    return 'Weather unavailable.';
  }
}

function gatherTodos(): string {
  const todoDir = path.join(getProjectDir(), '.claude/state/todos');
  try {
    const files = fs.readdirSync(todoDir).filter(f => f.endsWith('.json') && !f.includes('-completed-'));
    if (files.length === 0) return 'No open to-dos.';

    const todos: string[] = [];
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(todoDir, file), 'utf8'));
        const priority = (data.priority ?? 'medium').toUpperCase();
        const due = data.due ? ` (due: ${data.due})` : '';
        todos.push(`[${data.id}] ${priority} — ${data.title}${due}`);
      } catch {
        // skip malformed files
      }
    }
    return todos.length > 0 ? todos.join('\n') : 'No open to-dos.';
  } catch {
    return 'To-do list unavailable.';
  }
}

function gatherOvernightMessages(): string {
  const logPath = path.join(getProjectDir(), 'logs/daemon.log');
  try {
    if (!fs.existsSync(logPath)) return 'No overnight messages.';

    const now = Date.now();
    const eightHoursAgo = now - 8 * 60 * 60 * 1000;
    const lines = fs.readFileSync(logPath, 'utf8').split('\n');

    const messages: string[] = [];
    for (const line of lines) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        const ts = new Date(entry.ts).getTime();
        if (ts < eightHoursAgo) continue;

        // Telegram incoming messages
        if (entry.module === 'telegram' && entry.msg?.includes('Injected message from')) {
          messages.push(`Telegram: ${entry.msg}`);
        }
        // Agent comms incoming
        if (entry.module === 'agent-comms' && entry.msg?.includes('Received message from')) {
          messages.push(`Agent: ${entry.msg}`);
        }
        // Emails received
        if (entry.module === 'email-check' && entry.msg?.includes('unread')) {
          messages.push(`Email: ${entry.msg}`);
        }
      } catch {
        // skip non-JSON lines
      }
    }

    if (messages.length === 0) return 'No overnight messages.';
    // Deduplicate and limit
    const unique = [...new Set(messages)];
    return unique.slice(-10).join('\n');
  } catch {
    return 'Message log unavailable.';
  }
}

/**
 * Send a plain-text briefing directly via Telegram (no Claude session needed).
 */
function sendDirectTelegram(text: string): void {
  const sendScript = path.join(getProjectDir(), 'scripts/telegram-send.sh');
  try {
    execFileSync('bash', [sendScript, text], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    log.info('Sent briefing directly via Telegram (no session fallback)');
  } catch (err) {
    log.error('Failed to send Telegram fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Format a plain-text briefing for direct Telegram delivery.
 */
function formatPlainBriefing(today: string, weather: string, calendar: string, todos: string, overnight: string): string {
  const lines = [
    `Good morning! Here's your briefing for ${today}.`,
    '',
    `Weather: ${weather}`,
    '',
    'Schedule:',
    calendar,
    '',
    'Open to-dos:',
    todos,
  ];

  if (overnight && overnight !== 'No overnight messages.') {
    lines.push('', 'Overnight:', overnight);
  }

  return lines.join('\n');
}

async function run(): Promise<void> {
  log.info('Gathering morning briefing data');

  const calendar = gatherCalendar();
  const weather = gatherWeather();
  const todos = gatherTodos();
  const overnight = gatherOvernightMessages();

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  // If a Claude session is running, inject as a prompt for a nicely formatted briefing
  if (sessionExists()) {
    const prompt = [
      `[System] Morning briefing time! Today is ${today}.`,
      'Send Dave a concise, friendly morning briefing via Telegram with the data below.',
      'Format it nicely but keep it short — a snapshot, not an essay.',
      'Include any notable items and a cheerful greeting.',
      '',
      `WEATHER: ${weather}`,
      '',
      `CALENDAR:\n${calendar}`,
      '',
      `OPEN TO-DOS:\n${todos}`,
      '',
      `OVERNIGHT MESSAGES:\n${overnight}`,
    ].join('\n');

    log.info('Injecting morning briefing prompt');
    injectText(prompt);
  } else {
    // No session — send a plain-text briefing directly via Telegram
    log.warn('No Claude session available — sending plain-text briefing via Telegram');
    const briefing = formatPlainBriefing(today, weather, calendar, todos, overnight);
    sendDirectTelegram(briefing);
  }
}

registerTask({ name: 'morning-briefing', run, requiresSession: false });
