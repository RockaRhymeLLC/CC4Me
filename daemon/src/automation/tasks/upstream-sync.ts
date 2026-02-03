/**
 * Upstream Sync — weekly check for upstream updates and fork divergence.
 *
 * Fetches upstream/main, compares with the fork's main, and reports:
 * 1. New upstream commits the fork should pull in
 * 2. Fork-only commits that may be worth contributing upstream
 *
 * Injects a summary into Claude's session with actionable next steps.
 * Skips quietly if there's nothing new in either direction.
 */

import { execSync } from 'node:child_process';
import { getProjectDir } from '../../core/config.js';
import { isBusy, injectText } from '../../core/session-bridge.js';
import { createLogger } from '../../core/logger.js';
import { registerTask } from '../scheduler.js';

const log = createLogger('upstream-sync');

/**
 * Run a git command in the project directory silently.
 * Returns stdout trimmed, or null on failure.
 */
function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd: getProjectDir(),
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` },
    }).trim();
  } catch (err) {
    log.error(`git ${args.split(' ')[0]} failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Parse one-line log output into structured entries.
 * Format: "hash subject" from `git log --oneline`
 */
function parseLogLines(output: string): Array<{ hash: string; subject: string }> {
  if (!output) return [];
  return output.split('\n').filter(Boolean).map(line => {
    const spaceIdx = line.indexOf(' ');
    return {
      hash: line.substring(0, spaceIdx),
      subject: line.substring(spaceIdx + 1),
    };
  });
}

async function run(): Promise<void> {
  // Fetch upstream (required before any comparison)
  const fetchResult = git('fetch upstream');
  if (fetchResult === null) {
    log.warn('Could not fetch upstream — is the remote configured?');
    return;
  }

  // Commits in upstream/main that aren't in our main
  const upstreamNew = git('log --oneline main..upstream/main');
  const upstreamCommits = parseLogLines(upstreamNew ?? '');

  // Commits in our main that aren't in upstream/main
  const forkOnly = git('log --oneline upstream/main..main');
  const forkCommits = parseLogLines(forkOnly ?? '');

  // Check for any open PRs from our fork
  let openPRs = '';
  try {
    openPRs = execSync(
      'gh pr list --repo RockaRhyme/CC4Me --author @me --state open --json number,title --jq \'.[] | "#\\(.number): \\(.title)"\'',
      {
        cwd: getProjectDir(),
        encoding: 'utf8',
        timeout: 15_000,
        env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}` },
      },
    ).trim();
  } catch {
    // gh CLI may not be available or authenticated — non-fatal
    log.debug('Could not check open PRs (gh CLI issue)');
  }

  // Nothing to report? Skip silently.
  if (upstreamCommits.length === 0 && forkCommits.length === 0 && !openPRs) {
    log.info('Upstream sync: everything in sync, nothing to report');
    return;
  }

  log.info(`Upstream sync: ${upstreamCommits.length} upstream new, ${forkCommits.length} fork-only`);

  if (isBusy()) {
    log.info('Claude is busy — deferring upstream sync report to next run');
    return;
  }

  // Build the report
  const parts: string[] = [
    '[System] Weekly upstream sync report:',
  ];

  if (upstreamCommits.length > 0) {
    parts.push(
      '',
      `**${upstreamCommits.length} new upstream commit${upstreamCommits.length === 1 ? '' : 's'}** (not in your fork):`,
    );
    for (const c of upstreamCommits.slice(0, 15)) {
      parts.push(`  - \`${c.hash}\` ${c.subject}`);
    }
    if (upstreamCommits.length > 15) {
      parts.push(`  - ... and ${upstreamCommits.length - 15} more`);
    }
    parts.push(
      '',
      'Action: Review these and merge upstream changes into your fork:',
      '  `git merge upstream/main` (or cherry-pick specific commits)',
    );
  }

  if (forkCommits.length > 0) {
    parts.push(
      '',
      `**${forkCommits.length} fork-only commit${forkCommits.length === 1 ? '' : 's'}** (not in upstream):`,
    );
    for (const c of forkCommits.slice(0, 15)) {
      parts.push(`  - \`${c.hash}\` ${c.subject}`);
    }
    if (forkCommits.length > 15) {
      parts.push(`  - ... and ${forkCommits.length - 15} more`);
    }
    parts.push(
      '',
      'Review these for potential upstream contributions. Use `/upstream prepare` for any worth contributing.',
    );
  }

  if (openPRs) {
    parts.push(
      '',
      '**Open PRs against upstream:**',
    );
    for (const pr of openPRs.split('\n').filter(Boolean)) {
      parts.push(`  - ${pr}`);
    }
  }

  if (upstreamCommits.length === 0 && forkCommits.length > 0) {
    parts.push(
      '',
      'Your fork is ahead of upstream but not behind — no merge needed, just review fork-only commits for upstreaming.',
    );
  }

  const prompt = parts.join('\n');
  log.info('Injecting upstream sync report');
  injectText(prompt);
}

registerTask({ name: 'upstream-sync', run });
