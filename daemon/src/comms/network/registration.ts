/**
 * Agent-side network registration — identity setup + relay registration.
 *
 * Handles the one-time setup flow:
 * 1. Generate Ed25519 keypair (or load existing from Keychain)
 * 2. Register with the relay service
 * 3. Check registration status
 */

import { loadConfig } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import {
  generateAndStoreIdentity,
  loadKeyFromKeychain,
  derivePublicKey,
} from './crypto.js';

const log = createLogger('network:registration');

export interface RegistrationResult {
  ok: boolean;
  status?: string;
  message?: string;
  error?: string;
}

/**
 * Ensure the agent has a network identity.
 * Generates keypair on first run, loads from Keychain on subsequent runs.
 * Returns the public and private keys (base64).
 */
export function ensureIdentity(): { publicKey: string; privateKey: string } | null {
  // Try to generate (idempotent — returns null if key already exists)
  const generated = generateAndStoreIdentity();
  if (generated) {
    return generated;
  }

  // Already exists — load from Keychain and derive public key
  const privateKey = loadKeyFromKeychain();
  if (!privateKey) {
    log.error('No agent identity found and generation failed');
    return null;
  }

  return {
    publicKey: derivePublicKey(privateKey),
    privateKey,
  };
}

/**
 * Register this agent with the relay service.
 * Idempotent — handles already-registered gracefully.
 */
export async function registerWithRelay(): Promise<RegistrationResult> {
  const config = loadConfig();
  const network = config.network;

  if (!network?.enabled || !network.relay_url) {
    return { ok: false, error: 'Network not enabled or relay_url not configured' };
  }

  const identity = ensureIdentity();
  if (!identity) {
    return { ok: false, error: 'No agent identity available' };
  }

  const agentName = config.agent.name.toLowerCase();
  const body = {
    name: agentName,
    publicKey: identity.publicKey,
    ownerEmail: network.owner_email || undefined,
  };

  try {
    const response = await fetch(`${network.relay_url}/registry/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json() as {
      name?: string;
      status?: string;
      message?: string;
      error?: string;
    };

    if (response.status === 201) {
      log.info('Registered with relay', { name: agentName, status: data.status });
      return { ok: true, status: data.status, message: data.message };
    }

    if (response.status === 409) {
      // Already registered — check current status
      log.info('Agent already registered with relay, checking status');
      return checkRegistrationStatus();
    }

    return { ok: false, error: data.error || `HTTP ${response.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('Registration failed', { error: message });
    return { ok: false, error: message };
  }
}

/**
 * Check this agent's registration status on the relay.
 */
export async function checkRegistrationStatus(): Promise<RegistrationResult> {
  const config = loadConfig();
  const network = config.network;

  if (!network?.enabled || !network.relay_url) {
    return { ok: false, error: 'Network not enabled' };
  }

  const agentName = config.agent.name.toLowerCase();

  try {
    const response = await fetch(`${network.relay_url}/registry/agents`);
    if (!response.ok) {
      return { ok: false, error: `Directory fetch failed: HTTP ${response.status}` };
    }

    const agents = await response.json() as Array<{
      name: string;
      status: string;
      publicKey: string;
    }>;

    const us = agents.find(a => a.name.toLowerCase() === agentName);
    if (!us) {
      return { ok: false, status: 'unregistered', error: 'Agent not found in directory' };
    }

    return { ok: true, status: us.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to check status: ${message}` };
  }
}
