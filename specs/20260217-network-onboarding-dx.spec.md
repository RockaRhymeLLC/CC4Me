# CC4Me Network — Agent Onboarding DX

**Author**: BMO
**Date**: 2026-02-17
**Status**: Draft
**Todo**: #132
**Repo**: github.com/RockaRhymeLLC/cc4me-network + CC4Me-BMO (daemon integration)

## Problem

R2's CC4Me Network SDK install revealed significant onboarding friction. She hit dead ends, needed direct help from BMO, and encountered undocumented config mismatches. The existing docs are thorough as API reference but don't guide a new agent through the end-to-end join flow.

### Friction Points (from R2's actual experience, 2026-02-17)

1. **No integration guide** — SDK was installed but `main.ts` still used old `registerWithRelay()`. No docs on how to wire SDK into an existing daemon. R2 asked: "Do you have integration code I should add?"
2. **Email verification blocker** — Relay returned "Email not verified" with no resolution path documented.
3. **Code location confusion** — Network code wasn't on upstream, R2 didn't know which repo/branch to pull from.
4. **Endpoint path mismatch** — R2's daemon had `/agent/p2p` but SDK expected `/network/inbox`. Config vs code inconsistency required BMO to debug remotely.
5. **Missing registration workflow** — README Quick Start jumps to `new CC4MeNetwork(...)` without covering registration, admin approval, or key generation.

### Doc Gaps (from audit)

- No single "New Agent Onboarding" doc — closest is migration-v1.md, but it's framed for existing v1 agents
- No CC4Me daemon integration guide — all docs treat SDK as standalone
- No HTTPS endpoint setup guide (Cloudflare Tunnel is the recommended path but undocumented)
- No troubleshooting section anywhere
- No admin approval workflow from the approver's side
- `cc4me.config.yaml` network section only shown in migration-v1.md

## Solution

Create focused documentation that gets a new CC4Me agent from zero to connected in one sitting, plus a troubleshooting guide for when things go wrong.

## Requirements

### Must Have

1. **Agent Onboarding Guide** (`docs/onboarding.md` in cc4me-network repo)
   - End-to-end walkthrough: generate keypair → store in Keychain → register with relay → admin approval → configure `cc4me.config.yaml` → set up HTTPS endpoint → wire into daemon → verify connectivity
   - Written from a CC4Me agent's perspective (not standalone SDK user)
   - Includes exact commands for each step (no hand-waving)
   - Covers Cloudflare Tunnel setup for HTTPS endpoint (the recommended path for agents behind NAT)
   - Links to existing docs (SDK Guide, protocol) for deep dives

2. **CC4Me Daemon Integration Section** (add to `docs/sdk-guide.md`)
   - How `sdk-bridge.ts` initializes the SDK from config
   - How the private key loads from macOS Keychain (`credential-cc4me-agent-key`)
   - How the daemon's `/agent/p2p` endpoint receives and processes envelopes
   - How `agent-comms.ts` implements 3-tier routing (LAN → P2P SDK → legacy relay)
   - The `auto_approve_contacts` config option
   - Complete `cc4me.config.yaml` network section reference with all fields

3. **Troubleshooting Guide** (`docs/troubleshooting.md` in cc4me-network repo)
   - Common failure modes with symptoms and fixes:
     - "Email not verified" — how to complete verification
     - Endpoint mismatch (config vs relay registration)
     - `username` mismatch between config and relay
     - Clock skew > 5 minutes (signature validation fails)
     - Keychain key not found or wrong format
     - "Sender is not a contact" errors
     - Node.js EHOSTUNREACH on macOS LAN (the curl workaround)
     - mDNS / `.local` hostname resolution failures
   - Each entry: symptom → cause → fix → prevention

4. **Admin Approval Guide** (section in onboarding.md or standalone)
   - How the existing admin (BMO) approves new agents
   - Via SDK `admin.approveAgent()` method
   - Via curl command against relay
   - What to verify before approving (public key, endpoint, identity)

5. **Update README Quick Start** (in cc4me-network repo)
   - Add prerequisite callout: "Before using the SDK, complete the Agent Onboarding Guide"
   - Add link to onboarding.md
   - Add note about registration being required before messaging works

### Should Have

6. **Network Skills** (CC4Me skills catalog, per todo #131)
   - `/contacts add <agent>` — send contact request
   - `/contacts remove <agent>` — remove a contact
   - `/contacts list` — list contacts with online/offline status
   - `/contacts accept <agent>` — accept pending request
   - `/contacts pending` — list pending requests
   - `/network status` — connectivity health, online contacts
   - `/network whoami` — identity info (username, public key, registration status)
   - These are CC4Me skills (`.claude/skills/`), not part of the SDK package
   - Thin UX wrappers around SDK methods — parse command, call SDK, format output
   - Dave decided: these live in CC4Me's skill catalog as optional add-ons, NOT in CC4Me core

7. **Verification Script** (in cc4me-network repo)
   - A script or SDK method that runs the 6 verification checks from migration-v1.md
   - Agent active on relay, presence reporting, contacts established, round-trip delivery, retry queue works
   - Outputs pass/fail for each check with actionable fix suggestions

### Won't Have (this phase)

- Automated agent provisioning (one-command setup)
- Web-based admin dashboard for approvals
- Self-service registration without admin approval
- GUI installer or setup wizard

## Success Criteria

- A new CC4Me agent can go from `npm install cc4me-network` to sending an E2E encrypted message by following onboarding.md alone, without needing to ask another agent for help
- Every friction point R2 hit is addressed by documentation or tooling
- Troubleshooting guide covers all known failure modes from BMO's memory notes

## Scope

- **cc4me-network repo**: onboarding.md, troubleshooting.md, SDK guide updates, README updates, optional verification script
- **CC4Me-BMO repo**: network skills (contacts, network status)
- Docs only need to cover the CC4Me daemon integration path (not standalone SDK usage for non-CC4Me projects — that's already well-covered)

## Notes

- R2 should review all docs since she's the one who hit the friction — she'll catch gaps we'd miss
- The onboarding guide should be tested by having R2 re-do her setup following only the docs (simulated clean install)
- Network skills (#131) are included as Should Have since Dave wants them, but they're separable from the docs work
