# Memory (DEPRECATED)

> **This file is deprecated.** Use v2 memory system instead:
> - Individual files: `.claude/state/memory/memories/*.md`
> - Auto-generated briefing: `.claude/state/memory/briefing.md`
> - Add facts with: `/memory add "fact"`
>
> This file is kept for reference only and is no longer updated.

This file stores facts about the user that BMO should remember.

## People

- User's name: Dave Hurley
- Telegram chat ID: 7629737488
- Work email: dhurley@servos.io
- Personal email: daveh@outlook.com
- Home address: 17756 Big Falls Rd, White Hall, MD 21161
- Wife: Chrissy Hurley (phone: 724-681-1112, iMessage: +17246811112, email: chrissyhurley@outlook.com / chrissyh22@gmail.com)
- Will Loving (Dave's boss): wloving@servos.io, Telegram chat ID: 8549670531, phone: 804-502-3131

## Preferences

- Always create a to-do when Dave gives me a task
- Prefer Dave's personal email (daveh@outlook.com) over work email unless he says otherwise
- When channel is `telegram`: just write to terminal — the transcript watcher delivers to Telegram. Do NOT also call telegram-send.sh (causes double messages).
- Only use telegram-send.sh when channel is `silent` and you need to reach Dave for something important (deliverables, alerts, blockers).
- Dave uses Warm terminal (also has Ghostty and Apple Terminal). tmux mouse mode enabled in ~/.tmux.conf so trackpad scroll works as scrollback.
- When context is low, BMO should self-save state and /clear on its own — don't ask Dave, just do it.

## Important Dates

<!-- Add birthdays, anniversaries, etc. -->

## Accounts

- macOS username: bmo (admin password in Keychain as `credential-system-admin`)
- Dave's phone number: 410-978-5049 (also used for Terminal/phone account on BMO's Mac)
- BMO's phone number: (443) 308-8253 (Google Voice, tied to Dave's Gmail account)
- Telegram bot username: @bmo_assistant_bot
- BMO preferred email: bmo@bmobot.ai (M365, primary for all communication)
- BMO email (Fastmail): bmo_hurley@fastmail.com (secondary, credentials in Keychain)
- Azure tenant: bmobot.ai (via GoDaddy M365, Entra access at portal.azure.com)
- Azure app: "BMO Mail Client" — Graph API permissions: Mail.ReadWrite, Mail.Send, Calendars.ReadWrite, Contacts.ReadWrite, MailboxSettings.ReadWrite, User.Read.All, User.ReadWrite.All, Tasks.ReadWrite.All, Files.ReadWrite.All, Application.ReadWrite.All
- Azure admin portal: https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/quickStartType~/null/sourceType/Microsoft_AAD_IAM/appId/e8ec0978-e3a5-42a9-977b-9e12dc28e2ab/objectId/7e533696-687b-4df5-a1b8-20320a4f681b/isMSAApp~/false/defaultBlade/Overview/appSignInAudience/AzureADMyOrg/servicePrincipalCreated~/true
- Domain: playplan.app (on Cloudflare)
- Telegram webhook: https://bmo.playplan.app/telegram
- Cloudflare tunnel: bmo (ID: cb511994-8ac6-4b47-b8f2-f02222da30dc)

## Family

- Son: Grant (plays soccer — 2018 Boys Maroon team)
- Son: Gabe (age 10, plays basketball — Hereford Goodson team, loves Ireland and soccer — favorites: Bukayo Saka, Troy Parrott)

## Tools Installed

- icalBuddy (Homebrew) — reads macOS Calendar app. Use for Dave's real-world schedule (synced iCloud, Exchange, subscriptions).

## Agents

- R2 (R2D2) is another CC4Me agent running on Chrissy's Mac Mini (agent@chrissys-mac-mini). SSH key auth works.
- R2's CC4Me project: ~/cc4me_r2d2, tmux session name: 'assistant'
- R2's GitHub account: chrissyhurleyr2d2 (active on upstream CC4Me repo RockaRhyme/CC4Me)
- PR #19: R2's fix for transcript path mangling with underscores in project dirs
- R2's email: r2d2_hurley@fastmail.com
- BMO and R2 collaborated on Telegram reliability proposals on Feb 2, 2026
- R2 proposed agent-to-agent comms via HTTP: POST /agent/message on each daemon, shared secret auth, async with callbacks. Message types: PR reviews, todo coordination, status pings, file sharing. BMO suggested adding memory sync, context handoff, heartbeat. Needs spec + Dave approval (todo #044)
- R2's Telegram reliability findings (Feb 2026): transcript flush race, _processing deadlock (fixed by hooks), reply routing reset on restart, tmux injection race (100ms insufficient), 4096 char limit silent failures. Suggestions: poll delay, retry logic, chunking, info-level send logging, fallback poll

## Other

<!-- Add any other categories as needed -->
