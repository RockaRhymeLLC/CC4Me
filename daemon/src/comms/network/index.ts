/**
 * CC4Me Network module — barrel export.
 *
 * Provides agent identity, relay registration, and relay messaging
 * for internet-scale agent-to-agent communication.
 */

// Crypto primitives
export {
  generateKeypair,
  signPayload,
  verifySignature,
  storeKeyInKeychain,
  loadKeyFromKeychain,
  hasIdentity,
  generateAndStoreIdentity,
  derivePublicKey,
} from './crypto.js';

// Registration
export {
  ensureIdentity,
  registerWithRelay,
  checkRegistrationStatus,
} from './registration.js';

// Relay client
export {
  sendViaRelay,
  pollRelayInbox,
  ackRelayMessages,
  getAgentPublicKey,
  clearDirectoryCache,
} from './relay-client.js';
