# CC4Me Setup — Will's Homework

Prepared by Dave & BMO | January 30, 2026

---

## What's Happening

Dave and BMO (Dave's AI assistant) are going to set up a personal AI assistant on your Mac. Before they can do that, they need a few things from you. This is your homework — gather these items and make a couple decisions, and Dave will handle the rest.

---

## Checklist

- [ ] 1. **Mac access** — grant Dave remote access to your Mac
- [ ] 2. **Claude subscription** — sign up for Claude Pro or Max
- [ ] 3. **Telegram bot** — create one in the Telegram app (5 minutes)
- [ ] 4. **Email decision** — pick Fastmail or Microsoft 365
- [ ] 5. **Email credentials** — sign up and grab your API token
- [ ] 6. **Domain name** (optional) — buy one if you want Telegram messaging
- [ ] 7. **Assistant name** — what do you want to call it?

---

## Details

### 1. Mac Access

**What you need to do:** Grant Dave remote access to your Mac so he and BMO can run the installation.

**How:** Dave will walk you through this — likely Screen Sharing, SSH, or a remote desktop tool. Make sure you know your Mac's admin password.

**Requirements:**
- macOS Ventura 13 or newer (check: Apple menu > About This Mac)
- Stable internet connection
- Admin password ready

**Optional but recommended:** Create a dedicated macOS user account for the assistant. Go to System Settings > Users & Groups > Add User. Give it a name like "assistant" or whatever you decide to name it in item #7. This keeps the assistant's files separate from yours. Dave can also do this during install if you prefer.

---

### 2. Claude Subscription

**What:** Sign up for a Claude account with a paid plan.

**Why:** The assistant runs on Claude, Anthropic's AI. The paid subscription gives it the horsepower to work autonomously.

**How:**
1. Go to [claude.ai](https://claude.ai)
2. Create an account (or log in if you have one)
3. Subscribe to **Pro** ($20/month) or **Max** ($100/month)

**Which plan?** Max gives significantly higher usage limits, which matters if the assistant will be running a lot. Pro is fine to start — you can upgrade anytime.

**Give Dave:** Your Claude login credentials (email + password), OR log in on the Mac yourself before Dave starts the install. Claude Code authenticates through the browser — Dave just needs it logged in once.

---

### 3. Telegram Bot

**What:** A Telegram bot that lets you message your assistant from your phone.

**Why:** Instead of sitting at your Mac, you can text your assistant from anywhere. Send it tasks, ask questions, send photos or documents — it replies right in the chat.

**How:**
1. Install [Telegram](https://telegram.org) on your phone if you haven't already
2. Open Telegram and search for **@BotFather**
3. Send the message: `/newbot`
4. It will ask for a **display name** — pick something (e.g., "Will's Assistant")
5. It will ask for a **username** ending in "bot" (e.g., "wills_assistant_bot")
6. BotFather replies with a **bot token** — it looks like `7123456789:AAF...` — copy this

Then get your **chat ID:**
1. Send any message to your new bot (just say "hi")
2. Open this URL in a browser (paste your token in place of YOUR_TOKEN):
   ```
   https://api.telegram.org/botYOUR_TOKEN/getUpdates
   ```
3. Look for `"chat":{"id":` followed by a number — that's your chat ID

**Give Dave:**
- Bot token
- Your chat ID

**Skip if:** You don't care about mobile messaging and are fine using the terminal only.

---

### 4. Email Decision

**What:** Choose how your assistant sends and reads email.

**Your options:**

| | Fastmail | Microsoft 365 |
|---|---|---|
| **Cost** | $3-5/month | $6/month + domain (~$12/year) |
| **Setup** | Easy | Moderate |
| **Email address** | you@fastmail.com | you@yourdomain.com |
| **Best for** | Getting started fast | Professional/branded email |

**Our recommendation:** Start with **Fastmail**. It works in 15 minutes. You can always add M365 later if you want a custom domain.

**Tell Dave:** Which option you want (or both).

---

### 5. Email Credentials

Based on your choice in #4:

#### If Fastmail:
1. Sign up at [fastmail.com](https://fastmail.com)
2. Go to Settings > Privacy & Security > Integrations > API tokens
3. Click "New" to create an API token

**Give Dave:**
- Your Fastmail email address
- The API token

#### If Microsoft 365:
This is more involved — Dave and BMO may handle most of it. But you'll need:
1. A domain name (see #6)
2. An M365 Business Basic subscription ($6/month) — sign up at [microsoft.com/microsoft-365](https://www.microsoft.com/microsoft-365/business) or through GoDaddy
3. Access to [portal.azure.com](https://portal.azure.com) (comes with your M365 subscription)

**Give Dave:** Your M365 admin login so he can configure the API access.

**Skip if:** You don't need email integration.

---

### 6. Domain Name (Optional)

**What:** A domain name like `willsassistant.com`.

**Why:** Needed for two things:
- Telegram integration requires a public URL for webhooks (the domain gets pointed at your Mac through a Cloudflare tunnel)
- M365 email gives your assistant a custom address (`assistant@yourdomain.com`)

**How:** Buy one from any registrar:
- [Cloudflare](https://www.cloudflare.com/products/registrar/) (recommended — integrates with the tunnel)
- [Namecheap](https://www.namecheap.com/)
- [GoDaddy](https://www.godaddy.com/)

A `.com` is about $10-12/year.

**Give Dave:** The domain name and registrar login (so he can configure DNS).

**Skip if:** You're not doing Telegram or M365 email.

---

### 7. Assistant Name

**What:** Pick a name for your assistant. It'll use this name to refer to itself and it shapes its personality.

**Examples:** Jarvis, Friday, Atlas, Sage, Echo — or anything you want.

**Tell Dave:** The name, and optionally any personality traits (e.g., "professional and concise" or "friendly and casual").

---

## Summary — What to Send Dave

Once you've done your homework, send Dave:

| Item | What to Send |
|------|-------------|
| Mac access | Remote access setup (Dave will coordinate) |
| Claude | Logged in on the Mac, or credentials |
| Telegram bot token | The token from BotFather |
| Telegram chat ID | The number from getUpdates |
| Email choice | Fastmail, M365, or both |
| Email credentials | Fastmail: email + API token / M365: admin login |
| Domain (if applicable) | Domain name + registrar login |
| Assistant name | The name + personality preference |

Dave and BMO will take it from there. The actual installation runs in about 30 minutes once they have everything.
