/**
 * Channel Router — reads the active channel and routes outgoing messages.
 *
 * Channels:
 *   terminal          - no external sending (default)
 *   telegram          - send text responses to Telegram
 *   telegram-verbose  - send text + thinking blocks to Telegram
 *   silent            - no sending anywhere
 *   voice             - voice pipeline (responses captured via voice-pending callback)
 */

import fs from 'node:fs';
import { resolveProjectPath } from '../core/config.js';
import { createLogger } from '../core/logger.js';

const log = createLogger('channel-router');

export type Channel = 'terminal' | 'telegram' | 'telegram-verbose' | 'silent' | 'voice';

type MessageHandler = (text: string) => void;

let _telegramHandler: MessageHandler | null = null;
let _startTypingHandler: (() => void) | null = null;
let _stopTypingHandler: (() => void) | null = null;
let _voicePendingCallback: MessageHandler | null = null;

/**
 * Initialize the channel router.
 */
export function initChannelRouter(): void {
  log.info(`Channel router initialized (current: ${getChannel()})`);
}

/**
 * Register the Telegram send handler.
 * Called by the Telegram adapter when it initializes.
 *
 * @param handler - Function to send a message via Telegram
 * @param startTyping - Optional function to start the typing indicator
 * @param stopTyping - Optional function to stop the typing indicator
 */
export function registerTelegramHandler(handler: MessageHandler, startTyping?: () => void, stopTyping?: () => void): void {
  _telegramHandler = handler;
  _startTypingHandler = startTyping ?? null;
  _stopTypingHandler = stopTyping ?? null;
  log.debug('Telegram handler registered');
}

/**
 * Start the Telegram typing indicator.
 * Used when voice input arrives on a telegram channel, so the user
 * sees "typing..." while waiting for the assistant's response.
 */
export function startTypingIndicator(): void {
  if (_startTypingHandler) {
    _startTypingHandler();
    log.debug('Typing indicator started');
  }
}

/**
 * Signal that a response has been fully delivered.
 * Stops the typing indicator if one is active.
 * Called by transcript-stream after successful delivery or retry exhaustion.
 */
export function signalResponseComplete(): void {
  if (_stopTypingHandler) {
    _stopTypingHandler();
    log.debug('Response complete — typing stopped');
  }
}

/**
 * Register a one-shot callback for the next assistant response (voice pipeline).
 * When set, the next assistant message is routed to the callback instead of
 * the normal channel (Telegram, etc.).
 */
export function registerVoicePending(callback: MessageHandler): void {
  _voicePendingCallback = callback;
  log.debug('Voice-pending callback registered');
}

/**
 * Clear any pending voice callback (e.g., on timeout).
 */
export function clearVoicePending(): void {
  if (_voicePendingCallback) {
    _voicePendingCallback = null;
    log.debug('Voice-pending callback cleared');
  }
}

/**
 * Check if a voice request is waiting for a response.
 */
export function isVoicePending(): boolean {
  return _voicePendingCallback !== null;
}

/**
 * Send a message directly to Telegram, bypassing channel checks.
 * Used for immediate feedback (e.g., voice transcription echo).
 */
export function sendDirectTelegram(text: string): boolean {
  if (!_telegramHandler) {
    log.warn('sendDirectTelegram: no handler registered');
    return false;
  }
  try {
    _telegramHandler(text);
    return true;
  } catch (err) {
    log.error('sendDirectTelegram error', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Get the current channel from state file.
 */
export function getChannel(): Channel {
  try {
    const channelFile = resolveProjectPath('.claude', 'state', 'channel.txt');
    const content = fs.readFileSync(channelFile, 'utf8').trim();
    if (['terminal', 'telegram', 'telegram-verbose', 'silent', 'voice'].includes(content)) {
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
 * If a voice-pending callback is registered, the message is routed there
 * instead of the normal channel. This prevents Telegram double-delivery.
 *
 * @param text - The assistant's text output
 * @param thinking - Optional thinking block content (sent in verbose mode)
 */
export function routeOutgoingMessage(text: string, thinking?: string): void {
  // Voice-pending takes priority — intercept the message for the voice pipeline
  if (_voicePendingCallback) {
    const cb = _voicePendingCallback;
    _voicePendingCallback = null;
    log.info('Routing response to voice pipeline', { chars: text.length });
    try {
      cb(text);
    } catch (err) {
      log.error('Voice callback error', { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  const channel = getChannel();

  switch (channel) {
    case 'terminal':
    case 'silent':
    case 'voice':
      // No external delivery (voice responses are captured via voice-pending callback above)
      log.debug(`Channel is ${channel}, not forwarding: ${text.length} chars`);
      return;

    case 'telegram':
      log.info(`Routing to telegram: ${text.length} chars, handler=${!!_telegramHandler}`);
      if (_telegramHandler) {
        try {
          log.info('Calling telegram handler now');
          _telegramHandler(text);
          log.info('Telegram handler returned');
        } catch (err) {
          log.error('Telegram handler error', { error: err instanceof Error ? err.message : String(err) });
        }
      } else {
        log.warn('Telegram message dropped: no handler registered');
      }
      return;

    case 'telegram-verbose':
      if (_telegramHandler) {
        try {
          // In verbose mode, prepend thinking blocks if present
          if (thinking) {
            _telegramHandler(`💭 ${thinking}`);
          }
          _telegramHandler(text);
        } catch (err) {
          log.error('Telegram handler error (verbose)', { error: err instanceof Error ? err.message : String(err) });
        }
      } else {
        log.warn('Telegram message dropped: no handler registered');
      }
      return;
  }
}
