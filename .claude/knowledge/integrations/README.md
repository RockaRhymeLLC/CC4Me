# Integration Knowledge Base

This directory contains how-to documentation for external service integrations.

## Purpose

When the assistant needs to connect to an external service, it references these docs for:
- Setup instructions
- API patterns and examples
- Credential storage conventions
- Common operations

## Available Integrations

| File | Service | Purpose |
|------|---------|---------|
| `telegram.md` | Telegram Bot API | Receive and send messages |
| `fastmail.md` | Fastmail | Email send/receive |
| `keychain.md` | macOS Keychain | Secure credential storage |

## Adding New Integrations

When connecting to a new service:

1. Create `{service-name}.md` in this directory
2. Document:
   - Prerequisites and setup steps
   - Credential storage (use Keychain naming convention)
   - API/SDK usage patterns
   - Common operations with examples
   - Troubleshooting tips

3. Reference the doc from relevant skills

## Credential Naming Convention

All credentials stored in macOS Keychain follow this pattern:
- `credential-{service}-{identifier}` - API keys, passwords
- `pii-{category}` - Personal identifiable information
- `financial-{type}-{identifier}` - Payment/banking info

See `keychain.md` for full details.
