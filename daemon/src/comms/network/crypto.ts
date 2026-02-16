/**
 * Ed25519 crypto utilities for CC4Me Network.
 *
 * Handles keypair generation, message signing, signature verification,
 * and macOS Keychain integration for private key storage.
 *
 * Uses only Node.js built-in crypto module — no external dependencies.
 */

import { generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey } from 'node:crypto';
import { getCredential, setCredential } from '../../core/keychain.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger('network:crypto');

const AGENT_KEY_SERVICE = 'credential-cc4me-agent-key';

export interface Keypair {
  /** Base64-encoded Ed25519 public key (raw 32 bytes) */
  publicKey: string;
  /** Base64-encoded Ed25519 private key (raw 32-byte seed) */
  privateKey: string;
}

/**
 * Generate a new Ed25519 keypair.
 * Returns base64-encoded raw key bytes for compact storage and transport.
 */
export function generateKeypair(): Keypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  // Export raw key bytes (32 bytes each) as base64
  const pubRaw = publicKey.export({ type: 'spki', format: 'der' });
  const privRaw = privateKey.export({ type: 'pkcs8', format: 'der' });

  return {
    publicKey: Buffer.from(pubRaw).toString('base64'),
    privateKey: Buffer.from(privRaw).toString('base64'),
  };
}

/**
 * Sign a payload string with an Ed25519 private key.
 *
 * @param payload - The string to sign (typically JSON)
 * @param privateKeyBase64 - Base64-encoded PKCS8 DER private key
 * @returns Base64-encoded signature
 */
export function signPayload(payload: string, privateKeyBase64: string): string {
  const keyObj = createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });

  const signature = sign(null, Buffer.from(payload), keyObj);
  return signature.toString('base64');
}

/**
 * Verify an Ed25519 signature against a payload and public key.
 *
 * Returns false (never throws) for invalid signatures, wrong keys,
 * empty strings, or malformed base64.
 *
 * @param payload - The original signed string
 * @param signatureBase64 - Base64-encoded signature to verify
 * @param publicKeyBase64 - Base64-encoded SPKI DER public key
 * @returns true if the signature is valid
 */
export function verifySignature(
  payload: string,
  signatureBase64: string,
  publicKeyBase64: string,
): boolean {
  try {
    if (!signatureBase64 || !publicKeyBase64) return false;

    const keyObj = createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });

    return verify(null, Buffer.from(payload), keyObj, Buffer.from(signatureBase64, 'base64'));
  } catch {
    // Any error (malformed base64, wrong key format, etc.) → false
    return false;
  }
}

/**
 * Store an Ed25519 private key in macOS Keychain.
 */
export function storeKeyInKeychain(privateKeyBase64: string): void {
  setCredential(AGENT_KEY_SERVICE, privateKeyBase64);
  log.info('Agent private key stored in Keychain');
}

/**
 * Load the Ed25519 private key from macOS Keychain.
 * Returns null if no key is stored.
 */
export function loadKeyFromKeychain(): string | null {
  return getCredential(AGENT_KEY_SERVICE);
}

/**
 * Derive the Ed25519 public key from a private key.
 * Useful when the keypair was generated in a previous session
 * and we only have the private key stored in Keychain.
 */
export function derivePublicKey(privateKeyBase64: string): string {
  const privKeyObj = createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const pubKeyObj = createPublicKey(privKeyObj);
  const pubDer = pubKeyObj.export({ type: 'spki', format: 'der' });
  return Buffer.from(pubDer).toString('base64');
}

/**
 * Check whether this agent already has a network identity (key in Keychain).
 */
export function hasIdentity(): boolean {
  return loadKeyFromKeychain() !== null;
}

/**
 * Generate a keypair and store the private key in Keychain.
 * Returns the public key for registration.
 * If a key already exists, returns null (idempotent — won't overwrite).
 */
export function generateAndStoreIdentity(): Keypair | null {
  if (hasIdentity()) {
    log.info('Agent identity already exists in Keychain, skipping generation');
    return null;
  }

  const keypair = generateKeypair();
  storeKeyInKeychain(keypair.privateKey);
  log.info('Generated new Ed25519 identity and stored in Keychain');
  return keypair;
}
