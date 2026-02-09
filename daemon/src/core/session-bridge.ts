/**
 * Session Bridge — all tmux interaction in one place.
 *
 * Handles:
 * - Hook-based agent state tracking (idle/busy from Stop/PostToolUse events)
 * - Session existence check
 * - Text injection into the Claude Code pane
 * - Pane capture for reading current screen content
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, getProjectDir } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('session-bridge');

// ── Hook-based agent state tracking ─────────────────────────
// Definitive agent state derived from hook events, not pane scraping.
// Stop → idle, PostToolUse/SubagentStop/UserPromptSubmit → busy.

let _agentState: 'idle' | 'busy' = 'idle';
let _agentStateUpdatedAt: number = 0;

const STALE_STATE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Update agent state from a hook event.
 * Called by the /hook/response handler in main.ts.
 */
export function updateAgentState(hookEvent: string): void {
  const prev = _agentState;
  if (hookEvent === 'Stop') {
    _agentState = 'idle';
  } else {
    // PostToolUse, SubagentStop, UserPromptSubmit, etc. — agent is working
    _agentState = 'busy';
  }
  _agentStateUpdatedAt = Date.now();
  if (prev !== _agentState) {
    log.info(`Agent state: ${prev} → ${_agentState} (hook: ${hookEvent})`);
  }
}

/**
 * Check if the agent is idle based on hook events.
 * Returns true if the last hook event was Stop (agent finished responding).
 * Falls back to true if no hook events received yet (fresh daemon start)
 * or if the last state update is stale (>10min — hooks may have stopped firing).
 */
export function isAgentIdle(): boolean {
  // If no hook events yet, assume idle (daemon just started)
  if (_agentStateUpdatedAt === 0) return true;

  // Staleness guard: if no hooks for 10 minutes, fall back to idle.
  // Prevents stuck-busy state if hooks stop firing (daemon restart,
  // hook script failure, etc.)
  if (Date.now() - _agentStateUpdatedAt > STALE_STATE_MS) {
    if (_agentState === 'busy') {
      log.info('Agent state stale (>10min) — falling back to idle');
      _agentState = 'idle';
    }
    return true;
  }

  return _agentState === 'idle';
}

/**
 * Get the Claude Code transcript directory for a project path.
 * Claude Code mangles the path by replacing both `/` and `_` with `-`.
 */
function getTranscriptDir(projectDir: string): string {
  const projectDirMangled = projectDir.replace(/[/_]/g, '-');
  return path.join(
    os.homedir(),
    '.claude',
    'projects',
    projectDirMangled,
  );
}

function getTmuxCmd(): string {
  const config = loadConfig();
  const socket = config.tmux.socket ?? `/private/tmp/tmux-${process.getuid?.() ?? 502}/default`;
  return `/opt/homebrew/bin/tmux -S ${socket}`;
}

function getSessionName(): string {
  return loadConfig().tmux.session;
}

/**
 * Check if the tmux session exists.
 */
export function sessionExists(): boolean {
  try {
    execSync(`${getTmuxCmd()} has-session -t ${getSessionName()} 2>/dev/null`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture the current tmux pane content.
 */
export function capturePane(): string {
  try {
    return execSync(`${getTmuxCmd()} capture-pane -t ${getSessionName()} -p`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return '';
  }
}


/**
 * Inject text into the Claude Code session.
 * Sends the text followed by Enter to submit it.
 *
 * Pre-injection cleanup: sends Escape (dismiss any autocomplete/menu)
 * and Ctrl-U (clear any partial input) before typing new text.
 *
 * Enter is sent with retry logic — if the text is still visible in
 * the pane after the first Enter, we retry up to 2 more times.
 *
 * @param text - Text to inject (will be escaped for tmux)
 * @param pressEnter - Whether to press Enter after (default: true)
 */
export function injectText(text: string, pressEnter = true): boolean {
  if (!sessionExists()) {
    log.warn('Cannot inject: no tmux session');
    return false;
  }

  const session = getSessionName();
  const tmux = getTmuxCmd();

  try {
    // Use -l flag for literal text (handles special chars)
    const sanitized = text.replace(/'/g, "'\\''");
    execSync(`${tmux} send-keys -t ${session} -l '${sanitized}'`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (pressEnter) {
      // Longer delay before Enter to ensure text is fully rendered
      execSync('sleep 0.3', { stdio: ['pipe', 'pipe', 'pipe'] });

      // Send Enter with retry — sometimes the first one doesn't register
      const MAX_ENTER_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ENTER_ATTEMPTS; attempt++) {
        execSync(`${tmux} send-keys -t ${session} Enter`, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Wait and verify the text was submitted (pane should no longer
        // contain our injected text on the input line)
        execSync('sleep 0.3', { stdio: ['pipe', 'pipe', 'pipe'] });

        if (attempt < MAX_ENTER_ATTEMPTS) {
          // Check if text is still sitting in the input line
          const pane = capturePane();
          const lines = pane.split('\n').filter(l => l.trim().length > 0);
          const lastLines = lines.slice(-5);
          const textStillPending = lastLines.some(l => l.includes(text.slice(0, 40)));

          if (!textStillPending) {
            break; // Text was submitted successfully
          }
          log.warn(`Enter attempt ${attempt} may not have fired — retrying`);
        }
      }
    }

    log.debug(`Injected text (${text.length} chars)`);
    return true;
  } catch (err) {
    log.error('Failed to inject text', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Get the path to the newest transcript file for this project.
 */
export function getNewestTranscript(): string | null {
  const projectDir = getProjectDir();
  const transcriptDir = getTranscriptDir(projectDir);

  try {
    const files = fs.readdirSync(transcriptDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: path.join(transcriptDir, f),
        mtime: fs.statSync(path.join(transcriptDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    return files[0]?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * Start the Claude Code tmux session if not running.
 * Runs the start-tmux.sh script in detached mode.
 */
export function startSession(): boolean {
  if (sessionExists()) return true;

  const startScript = path.join(getProjectDir(), 'scripts', 'start-tmux.sh');
  if (!fs.existsSync(startScript)) {
    log.error('start-tmux.sh not found');
    return false;
  }

  try {
    execSync(`"${startScript}" --detach`, {
      cwd: getProjectDir(),
      stdio: 'inherit',
    });
    log.info('Started Claude Code session');
    return true;
  } catch (err) {
    log.error('Failed to start session', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
