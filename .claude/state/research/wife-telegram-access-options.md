# Wife Telegram Access — Options & Recommendations

## Context
Dave wants to give his wife Telegram access to BMO. Requirements:
- She's not technical
- Telegram only (no terminal/CLI access)
- Must not be able to request changes that break things
- Easy onboarding

## Current Architecture
Messages flow: Telegram → Webhook → Gateway (safe-sender check) → tmux injection → Claude processes → transcript watcher sends reply.

The safe-senders check is a simple array of allowed chat IDs. No roles or permissions exist yet.

---

## Option 1: Role-Based Safe Senders (Recommended)

**How it works:** Extend safe-senders.json to include roles. Add instructions to CLAUDE.md that define what each role can do. The gateway tags messages with the sender's role (e.g., `[Telegram:member] Name: message`), and Claude follows role-based rules.

**safe-senders.json change:**
```json
{
  "telegram": {
    "users": {
      "7629737488": { "name": "Dave", "role": "admin" },
      "WIFE_CHAT_ID": { "name": "Name", "role": "member" }
    }
  }
}
```

**What "member" role CAN do:**
- Ask general questions (research, recommendations, trivia)
- Check calendar and schedule
- View todo list
- Ask about BMO's status
- Request emails to safe contacts
- Add todos (non-destructive)
- Get weather, directions, restaurant recommendations, etc.

**What "member" role CANNOT do:**
- Modify code, scripts, or configuration files
- Run builds, specs, or plans
- Change autonomy settings or safe-senders
- Access credentials, API keys, or PII
- Git operations (commit, push, etc.)
- Install software or modify system
- Change BMO's identity, skills, or hooks
- Delete files or data
- Add/remove other users

**Implementation effort:** Medium
- Update gateway.js to read roles and tag messages (~20 lines)
- Update safe-senders.json schema (backward compatible)
- Add role enforcement section to CLAUDE.md (~30 lines of instructions)

**Pros:**
- Good balance of useful and safe
- She can do everything a non-technical person would want
- No risk of breaking anything
- Enforcement is reliable (Claude follows system instructions well)
- Gateway-level tagging means the role is visible in every message

**Cons:**
- Requires code changes to gateway.js
- Claude-based enforcement isn't 100% foolproof (but very reliable)
- Need to define boundaries clearly upfront

---

## Option 2: Full Access (Simplest)

**How it works:** Add her chat ID to the existing safe-senders array. Same access as Dave.

**Implementation effort:** None — just add the ID to the JSON file.

**Pros:**
- Zero code changes
- Instant setup
- She can do anything Dave can do

**Cons:**
- No guardrails whatsoever
- She could accidentally request destructive changes
- "Delete all my todos" or "rewrite that script" would be executed
- No way to distinguish her messages from Dave's in logs
- Dave specifically asked for guardrails, so this doesn't meet requirements

---

## Option 3: Chat-Only Mode (Most Conservative)

**How it works:** Similar to Option 1, but with a very restricted "chat" role. BMO treats her messages as conversation only — answering questions, chatting, being helpful — but refuses ANY action that modifies state.

**What "chat" role CAN do:**
- Ask questions and have conversations
- Get information (weather, facts, recommendations)
- Ask BMO about its status

**What "chat" role CANNOT do:**
- Anything in the "cannot" list from Option 1
- PLUS: no adding todos, no sending emails, no calendar changes
- Essentially read-only + conversation

**Implementation effort:** Same as Option 1 (role infrastructure is the same).

**Pros:**
- Virtually zero risk
- Simple mental model: "she can talk to BMO but BMO won't do anything"

**Cons:**
- May feel frustratingly limited
- Can't even add a grocery item to a todo list
- She might feel like a second-class user

---

## Recommendation: Option 1 (Role-Based)

Option 1 gives her genuine utility while protecting against breaking changes. The key insight is that the dangerous actions (code changes, system config, git, installs) are things a non-technical user would never intentionally request. The guardrails protect against accidental harm, not intentional misuse.

**Onboarding would be simple:**
1. She messages @bmo_assistant_bot on Telegram
2. BMO greets her by name and explains what it can help with
3. She asks questions naturally — "What's on Dave's calendar today?" / "Add milk to the shopping list" / "Find me a good recipe for chicken soup"
4. If she asks something outside her role, BMO politely explains it can't do that and suggests asking Dave

**Next steps when Dave is ready:**
1. Get her Telegram chat ID (she messages the bot, gateway logs it)
2. I implement the role system (~1 hour of work)
3. Test with her ID before going live
4. Brief her on what BMO can help with
