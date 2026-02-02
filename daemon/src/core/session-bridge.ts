/**
 * Session Bridge — all tmux interaction in one place.
 *
 * Replaces the 5+ independent "is Claude busy?" checks scattered across
 * scripts with a single implementation. Handles:
 * - Session existence check
 * - Busy detection (spinner, "esc to interrupt", recent transcript activity)
 * - Text injection into the Claude Code pane
 * - Pane capture for reading current screen content
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, getProjectDir } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('session-bridge');

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
 * Check if Claude is actively generating a response.
 * Looks for: spinner characters, "esc to interrupt" text, recent transcript modification.
 */
export function isBusy(): boolean {
  if (!sessionExists()) return false;

  const pane = capturePane();

  // Check for "esc to interrupt" — Claude is processing
  if (pane.includes('esc to interrupt')) {
    log.debug('Busy: "esc to interrupt" visible');
    return true;
  }

  // Check for Unicode spinner characters
  if (/[✶✷✸✹✺✻✼✽✾✿❀❁❂❃⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(pane)) {
    log.debug('Busy: spinner visible');
    return true;
  }

  // Check if transcript was modified in the last 10 seconds
  const projectDir = getProjectDir();
  const projectDirMangled = projectDir.replace(/\//g, '-');
  const transcriptDir = path.join(
    process.env.HOME ?? '',
    '.claude',
    'projects',
    projectDirMangled,
  );

  try {
    const files = fs.readdirSync(transcriptDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        path: path.join(transcriptDir, f),
        mtime: fs.statSync(path.join(transcriptDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > 0) {
      const age = Date.now() - files[0]!.mtime;
      if (age < 10_000) {
        log.debug(`Busy: transcript modified ${Math.round(age / 1000)}s ago`);
        return true;
      }
    }
  } catch {
    // Transcript dir might not exist yet
  }

  return false;
}

/**
 * Inject text into the Claude Code session.
 * Sends the text followed by Enter to submit it.
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
      execSync(`${tmux} send-keys -t ${session} Enter`, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
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
  const projectDirMangled = projectDir.replace(/\//g, '-');
  const transcriptDir = path.join(
    process.env.HOME ?? '',
    '.claude',
    'projects',
    projectDirMangled,
  );

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
