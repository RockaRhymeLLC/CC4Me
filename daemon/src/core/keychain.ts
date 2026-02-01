/**
 * macOS Keychain access — single implementation used by all modules.
 * Replaces the duplicated `security find-generic-password` calls scattered
 * across gateway.js, graph.js, jmap.js, telegram-send.sh, etc.
 */

import { execSync } from 'node:child_process';
import { createLogger } from './logger.js';

const log = createLogger('keychain');

// In-memory cache to avoid repeated Keychain lookups within a session
const _cache = new Map<string, string>();

/**
 * Get a credential from macOS Keychain by service name.
 * Uses the `security` CLI tool. Caches results in memory.
 *
 * @param service - The Keychain service name (e.g. "credential-telegram-bot")
 * @returns The password/value, or null if not found
 */
export function getCredential(service: string): string | null {
  if (_cache.has(service)) {
    return _cache.get(service)!;
  }

  try {
    const value = execSync(
      `security find-generic-password -s "${service}" -w`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    _cache.set(service, value);
    return value;
  } catch {
    log.debug(`Credential not found: ${service}`);
    return null;
  }
}

/**
 * Store a credential in macOS Keychain.
 *
 * @param service - The Keychain service name
 * @param value - The password/value to store
 * @param account - The account name (default: "assistant")
 */
export function setCredential(service: string, value: string, account = 'assistant'): void {
  try {
    execSync(
      `security add-generic-password -a "${account}" -s "${service}" -w "${value}" -U`,
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    _cache.set(service, value);
    log.info(`Stored credential: ${service}`);
  } catch (err) {
    log.error(`Failed to store credential: ${service}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Clear the in-memory credential cache.
 * Useful if credentials were rotated externally.
 */
export function clearCache(): void {
  _cache.clear();
}

// ── Convenience accessors for known credentials ──────────────

export function getTelegramBotToken(): string | null {
  return getCredential('credential-telegram-bot');
}

export function getTelegramChatId(): string | null {
  return getCredential('credential-telegram-chat-id');
}

export function getAzureCredentials() {
  return {
    clientId: getCredential('credential-azure-client-id'),
    tenantId: getCredential('credential-azure-tenant-id'),
    clientSecret: getCredential('credential-azure-secret-value'),
    userEmail: getCredential('credential-graph-user-email'),
  };
}

export function getFastmailCredentials() {
  return {
    email: getCredential('credential-fastmail-email'),
    token: getCredential('credential-fastmail-token'),
  };
}

export function getShortcutAuthToken(): string | null {
  return getCredential('credential-shortcut-auth');
}
