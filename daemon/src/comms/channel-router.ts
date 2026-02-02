/**
 * Channel Router — reads the active channel and routes outgoing messages.
 *
 * Channels:
 *   terminal          - no external sending (default)
 *   telegram          - send text responses to Telegram
 *   telegram-verbose  - send text + thinking blocks to Telegram
 *   silent            - no sending anywhere
 */

import fs from 'node:fs';
import { resolveProjectPath } from '../core/config.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('channel-router');

export type Channel = 'terminal' | 'telegram' | 'telegram-verbose' | 'silent';

type MessageHandler = (text: string) => void;

let _telegramHandler: MessageHandler | null = null;

/**
 * Initialize the channel router.
 */
export function initChannelRouter(): void {
  log.info(`Channel router initialized (current: ${getChannel()})`);
}

/**
 * Register the Telegram send handler.
 * Called by the Telegram adapter when it initializes.
 */
export function registerTelegramHandler(handler: MessageHandler): void {
  _telegramHandler = handler;
  log.debug('Telegram handler registered');
}

/**
 * Get the current channel from state file.
 */
export function getChannel(): Channel {
  try {
    const channelFile = resolveProjectPath('.claude', 'state', 'channel.txt');
    const content = fs.readFileSync(channelFile, 'utf8').trim();
    if (['terminal', 'telegram', 'telegram-verbose', 'silent'].includes(content)) {
      return content as Channel;
    }
  } catch {
    // File doesn't exist or can't be read
  }
  return 'terminal';
}

/**
 * Set the current channel.
 */
export function setChannel(channel: Channel): void {
  const channelFile = resolveProjectPath('.claude', 'state', 'channel.txt');
  fs.writeFileSync(channelFile, channel + '\n');
  log.info(`Channel set to: ${channel}`);
}

/**
 * Route an outgoing message to the active channel.
 * Called by transcript-stream when it detects a new assistant message.
 *
 * @param text - The assistant's text output
 * @param thinking - Optional thinking block content (sent in verbose mode)
 */
export function routeOutgoingMessage(text: string, thinking?: string): void {
  const channel = getChannel();

  switch (channel) {
    case 'terminal':
    case 'silent':
      // No external delivery
      return;

    case 'telegram':
      if (_telegramHandler) {
        _telegramHandler(text);
      } else {
        log.warn('Telegram message dropped: no handler registered');
      }
      return;

    case 'telegram-verbose':
      if (_telegramHandler) {
        // In verbose mode, prepend thinking blocks if present
        if (thinking) {
          _telegramHandler(`💭 ${thinking}`);
        }
        _telegramHandler(text);
      } else {
        log.warn('Telegram message dropped: no handler registered');
      }
      return;
  }
}
