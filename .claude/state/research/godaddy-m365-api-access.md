# GoDaddy-Provisioned Microsoft 365: API Access & Admin Limitations

**Research Date:** January 29, 2026
**Context:** User has a GoDaddy-provisioned M365 email account (bmo@bmobot.ai) and needs API access (Microsoft Graph) for programmatic email operations. The Entra admin center redirects to GoDaddy's admin page.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [The Core Problem: Federated Tenants](#the-core-problem-federated-tenants)
3. [Admin Access Limitations](#admin-access-limitations)
4. [App Registration & Graph API Access](#app-registration--graph-api-access)
5. [GoDaddy M365 Plan Tiers](#godaddy-m365-plan-tiers)
6. [Community Reports & Known Issues](#community-reports--known-issues)
7. [Alternative Email Access Methods](#alternative-email-access-methods)
8. [Workarounds While Still Federated](#workarounds-while-still-federated)
9. [The Defederation Path](#the-defederation-path)
10. [EWS Deprecation Timeline](#ews-deprecation-timeline)
11. [Recommendations](#recommendations)

---

## Executive Summary

**GoDaddy's Microsoft 365 offering is a "federated" (also called "syndicated") version of M365 with severely restricted admin access.** When you purchase M365 through GoDaddy, they federate your domain and tenant, becoming the delegated administrator. This locks you out of:

- The Microsoft 365 Admin Center (redirects to GoDaddy)
- Microsoft Entra (Azure AD) Admin Center (blocked or limited)
- App Registrations (required for Graph API, OAuth2)
- Full PowerShell admin access
- Advanced security and compliance features

**No GoDaddy plan tier unlocks full Entra admin access.** The restriction is architectural, not plan-based. The only permanent solution is to **defederate** from GoDaddy, which Microsoft now officially documents and supports.

There are partial workarounds (detailed below), but for full Graph API access via a registered app, defederation is the most reliable path.

---

## The Core Problem: Federated Tenants

When you purchase Microsoft 365 through GoDaddy, the following happens:

1. **GoDaddy federates your domain**: Your custom domain (e.g., bmobot.ai) is set to "Federated" authentication mode, routing all sign-ins through GoDaddy's identity system.

2. **GoDaddy becomes the delegated admin**: They hold partner-level administrative control over the tenant. Your "admin" account is not a true Global Administrator in the Microsoft sense.

3. **Admin portal interception**: All attempts to access admin.microsoft.com, entra.microsoft.com, or the M365 admin center are redirected to GoDaddy's simplified admin dashboard.

4. **The tenant is locked**: The federation prevents transferring the tenant to a CSP (Cloud Solution Provider) or directly to Microsoft without a specific defederation process.

This is not a bug -- it is by design. GoDaddy's M365 product is marketed toward small businesses with no IT staff. They intentionally simplify (and restrict) the admin experience.

**Key fact:** Microsoft discontinued the federated vendor program in 2023 and is encouraging vendors like GoDaddy to migrate users to the standard platform. This migration process is called "defederation."

### Sources
- [Migrating from GoDaddy to Microsoft 365 and Avoiding Issues - Agile IT](https://agileit.com/news/migrating-from-godaddy-to-microsoft-365-and-avoiding-godaddy-issues/)
- [GoDaddy Office 365 vs. Microsoft 365 - Ryan Tech](https://ryantechinc.com/blog/GoDaddy-Office-365-vs.-Microsoft-365)
- [Why You Should Not Use GoDaddy for Microsoft 365 - C Solutions IT](https://csolutionsit.com/not-use-godaddy-microsoft-365/)

---

## Admin Access Limitations

### What GoDaddy Provides

GoDaddy provides access to a **limited set of "advanced admin centers"**:

| Admin Center | Available On | Access |
|---|---|---|
| **Exchange Admin** | All M365 email plans | Email settings, mail flow rules |
| **Teams Admin** | Business Essentials, Professional, Premium | Teams settings, call quality |
| **SharePoint Admin** | Business Essentials, Professional, Premium | SharePoint and OneDrive settings |

To access these: GoDaddy Dashboard > Email & Office > Microsoft 365 Admin > Advanced > Sign In with M365 credentials.

### What GoDaddy Does NOT Provide

- **Microsoft 365 Admin Center** (admin.microsoft.com) -- redirects to GoDaddy
- **Microsoft Entra Admin Center** (entra.microsoft.com) -- blocked or redirects
- **Azure Portal App Registrations** (portal.azure.com > Entra ID > App Registrations) -- access restricted
- **Full PowerShell connectivity** (Connect-ExchangeOnline, Connect-MgGraph with full admin)
- **Conditional Access policies**
- **Power BI, Power Platform, Dynamics** -- entirely unavailable, no upgrade path
- **Enterprise plans (E3, E5, F3)** -- not offered by GoDaddy
- **User limit**: GoDaddy caps at 300 users

### Microsoft's Position

Microsoft has confirmed:
- There is no way to access the M365 Admin Center when the subscription was purchased through GoDaddy
- Because M365 was purchased from GoDaddy, Microsoft cannot offer direct email/Exchange support
- For defederation, Microsoft refers users to GoDaddy's official documentation

### Sources
- [Access Advanced Admin Centers - GoDaddy Help](https://www.godaddy.com/help/access-advanced-admin-centers-32132)
- [I am unable to access Microsoft 365 Admin Center - Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/1299813/i-am-unable-to-access-microsoft-365-admin-center-b)
- [GoDaddy Office 365 vs. Microsoft 365 - TeckPath](https://teckpath.com/godaddy-office-365-vs-microsoft-365-understanding-the-differences-and-limitations/)

---

## App Registration & Graph API Access

### Can You Register Apps on a GoDaddy-Federated Tenant?

**Short answer: Probably not via the portal, and it is unreliable even via workarounds.**

The standard path to register an app for Microsoft Graph API is:
1. Go to portal.azure.com or entra.microsoft.com
2. Navigate to Microsoft Entra ID > App Registrations
3. Create a New Registration
4. Configure API permissions, client secrets/certificates

On a GoDaddy-federated tenant, users report:

- **Portal access blocked**: "Your administrator has disabled the App registrations experience in the Azure portal."
- **Redirected to GoDaddy**: The admin center routes back to GoDaddy's dashboard
- **Insufficient permissions**: Even when reaching the Azure portal, the federated admin account may not have the necessary roles (Global Admin, Application Administrator, Cloud Application Administrator)

### Why Graph API Requires App Registration

To use Microsoft Graph API, you **must** have an app registration in Entra ID. There is no alternative. The app registration provides:
- A Client ID (Application ID)
- A Client Secret or Certificate for authentication
- API permission grants (e.g., Mail.Read, Mail.Send)
- An OAuth2 token endpoint

Without an app registration, you cannot obtain OAuth2 tokens, and without tokens, you cannot call Graph API.

### OAuth2 for IMAP/SMTP Also Requires App Registration

Even if you bypass Graph API and use IMAP/SMTP with OAuth2 (Modern Authentication), you still need an app registration. The required permissions are:

| Protocol | Permission Scope (Delegated) | Permission Scope (Application/Daemon) |
|---|---|---|
| IMAP | `IMAP.AccessAsUser.All` | `IMAP.AccessAsApp` |
| POP | `POP.AccessAsUser.All` | `POP.AccessAsApp` |
| SMTP | `SMTP.Send` | `SMTP.SendAsApp` |

### Sources
- [Register an application - Microsoft Graph](https://learn.microsoft.com/en-us/graph/auth-register-app-v2)
- [Authenticate IMAP/POP/SMTP with OAuth - Microsoft Learn](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Godaddy Managed Microsoft 365 / Azure AD - Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5238311/godaddy-managed-microsoft-365-azure-ad)
- [Limited Access to use Azure AD App Registration - Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/2287560/limited-access-to-use-azure-ad-app-registration)

---

## GoDaddy M365 Plan Tiers

### Available Plans

| Plan | Email Storage | Office Apps | Key Features |
|---|---|---|---|
| **Email Essentials** | 10 GB | None | Email, calendar, contacts |
| **Email Plus** | 50 GB | None | Same as Essentials + more storage |
| **Online Business Essentials** | 50 GB | Web only | OneDrive (1TB), Teams, SharePoint |
| **Business Professional** | 50 GB | Desktop + Web | Full Office installs (5 devices) |
| **Business Premium** | 100 GB | Enterprise apps | Expandable OneDrive, compliance |

### Does a Higher Tier Unlock Entra Admin Access?

**No.** The admin restriction is not tier-dependent. It applies to all GoDaddy M365 plans equally. The federation/delegation model is the same regardless of which plan you purchase. No plan upgrade within GoDaddy's offerings will grant access to:
- Microsoft Entra Admin Center
- App Registrations
- Full M365 Admin Center
- PowerShell with Global Admin capabilities

### Pricing Comparison

GoDaddy often offers promotional first-year pricing (e.g., Business Professional at $8.99/user/month), but **renewal prices are significantly higher** (e.g., $19.99/user/month) compared to Microsoft direct pricing (e.g., M365 Business Standard at $12.50/user/month consistently).

### Sources
- [Compare Microsoft 365 email plans - GoDaddy Help](https://www.godaddy.com/help/compare-microsoft-365-email-plans-9014)
- [Microsoft 365 Email Plans Comparison - BranchLeaf Digital](https://www.branchleafdigital.com/microsoft-365-from-godaddy/microsoft-365-email-plans-comparison/)
- [GoDaddy vs Microsoft 365 Comparison (2025) - Forward Email](https://forwardemail.net/en/blog/godaddy-vs-microsoft-365-email-service-comparison)

---

## Community Reports & Known Issues

This is an extremely well-documented and widely reported issue. Community reports span Microsoft Q&A, Reddit, tech blogs, and MSP (Managed Service Provider) forums.

### Common Complaints

1. **"Admin center redirects to GoDaddy"** -- The single most common complaint, with dozens of Microsoft Q&A threads.

2. **"GoDaddy support has no clue"** -- Multiple users report that GoDaddy support cannot help with Azure AD / Entra issues and often claims "it's just not accessible."

3. **"Microsoft won't help either"** -- Microsoft directs users back to GoDaddy because the subscription was purchased through them.

4. **"Stripped down, more expensive version"** -- IT professionals consistently describe GoDaddy's M365 as a limited product that costs more than buying directly from Microsoft.

5. **"No PowerShell access"** -- Admins cannot use standard migration or management tools.

6. **"MFA lockout nightmare"** -- Only GoDaddy can reset MFA for the global admin, and only they can raise Microsoft support tickets.

### Key Forum Threads

- [Admin center redirects to GoDaddy - Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5155673/admin-center-redirects-to-godaddy)
- [Link is taking me to GoDaddy - Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/913577/link-is-taking-me-to-godaddy)
- [I have a Microsoft 365 account through GoDaddy, but it will not give me full admin privileges - Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5237279/i-have-a-microsoft-365-account-through-godaddy-but)
- [Unable to access Microsoft 365 Admin Portal - GoDaddy Community](https://community.godaddy.com/s/question/0D53t00006Vm3FOCAZ/unable-to-access-microsoft-365-admin-portal)
- [I can not access Microsoft 365 Admin Center from GoDaddy Subscription - Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5342228/i-can-not-access-microsoft-365-admin-center-from-g)
- [Unable to Find "App Password" Option in Microsoft 365 Email Through GoDaddy - Microsoft Community Hub](https://techcommunity.microsoft.com/discussions/admincenter/unable-to-find-app-password-option-in-microsoft-365-email-through-godaddy/4274215)
- [Can't sign into m365 admin - Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/5693464/cant-sign-into-m365-admin-logins-redirected-to-god)

---

## Alternative Email Access Methods

### IMAP/SMTP with Basic Auth (App Passwords)

**Status: DEPRECATED and being removed.**

- Microsoft deprecated Basic Authentication for Exchange Online protocols (IMAP, POP, SMTP, EWS) starting in 2022.
- App passwords are a form of Basic Auth and are affected by this deprecation.
- Some legacy connections may still work temporarily, but this is not a reliable long-term solution.
- GoDaddy's help pages note that "Microsoft 365 no longer supports POP and IMAP settings in Outlook, Apple Mail, Gmail and most email clients."

**If it still works for you**: The server settings are:

| Protocol | Server | Port | Encryption |
|---|---|---|---|
| IMAP | `outlook.office365.com` | 993 | SSL/TLS |
| POP | `outlook.office365.com` | 995 | SSL/TLS |
| SMTP | `smtp.office365.com` | 587 | STARTTLS |

**Authentication**: Your M365 email address and M365 password (not GoDaddy credentials).

### IMAP/SMTP with OAuth2 (Modern Auth)

**Status: Requires App Registration in Entra ID.**

Even modern IMAP/SMTP requires an OAuth2 app registration. The process:
1. Register app in Entra ID
2. Add API permissions (IMAP.AccessAsApp, SMTP.SendAsApp for daemon mode)
3. Get admin consent
4. Register service principal in Exchange Online via PowerShell
5. Grant mailbox permissions
6. Use SASL XOAUTH2 for authentication

This brings us back to the core problem: **you need Entra ID access to register the app.**

### Exchange Web Services (EWS)

**Status: DEPRECATED. Will be blocked October 1, 2026.**

- EWS was a viable programmatic email access method, but Microsoft announced its retirement.
- Starting March 1, 2026, EWS is blocked for certain license types (F3/frontline).
- By October 1, 2026, EWS requests will be blocked for all non-Microsoft apps.
- The replacement is Microsoft Graph API, which again requires an app registration.

### Exchange ActiveSync (EAS)

**Status: Also deprecated for Basic Auth. Modern auth requires app registration.**

### Microsoft Graph API

**Status: The recommended and future-proof method. Requires app registration.**

Graph API is the only officially supported long-term method for programmatic email access on Exchange Online. It requires:
- App registration in Microsoft Entra ID
- API permissions (Mail.Read, Mail.Send, etc.)
- OAuth2 authentication (delegated or application/daemon)

### Sources
- [Find my Microsoft 365 server settings - GoDaddy Help](https://www.godaddy.com/help/find-my-microsoft-365-server-settings-9012)
- [Deprecation of Basic authentication in Exchange Online - Microsoft Learn](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online)
- [Deprecation of Exchange Web Services in Exchange Online - Microsoft Learn](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-ews-exchange-online)
- [Authenticate IMAP/POP/SMTP with OAuth - Microsoft Learn](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)

---

## Workarounds While Still Federated

These are partial workarounds that may allow some level of access without full defederation. Success varies.

### 1. Access Azure Portal Directly (portal.azure.com)

Some users report being able to "backdoor" into the Azure portal:

1. Go to https://portal.azure.com (not admin.microsoft.com)
2. Sign in with your M365 admin email (the one GoDaddy designated as admin)
3. Navigate to Microsoft Entra ID (Azure Active Directory)
4. Check if you can see Users, App Registrations, etc.

**Caveat:** This works for some operations (viewing users, resetting passwords) but app registrations may still be blocked depending on the tenant configuration GoDaddy has set.

### 2. Use the .onmicrosoft.com Admin Account

Every M365 tenant has a hidden admin account on the `.onmicrosoft.com` domain:

1. Go to https://portal.azure.com with your GoDaddy admin account
2. Navigate to Entra ID > Users
3. Find the user with an `@NETORG*.onmicrosoft.com` address
4. Reset their password
5. Open an incognito window and sign in with that `.onmicrosoft.com` account
6. This account may bypass GoDaddy's redirect because it is not on the federated domain

**Caveat:** This account may still be limited by the partner delegation, but it has a higher chance of accessing the Azure portal directly.

### 3. Use the Microsoft 365 Admin App (Mobile)

1. Download the "Microsoft 365 Admin" app on iOS or Android
2. Sign in with the Global Admin account
3. The mobile app reportedly bypasses the GoDaddy web redirect
4. Some admin functions are available through the app

### 4. Create an Unlicensed Admin User

1. If you can access Entra ID via the Azure portal
2. Create a new user on the `.onmicrosoft.com` domain
3. Assign it Global Administrator role
4. Use this account for admin tasks -- it may not be subject to the federation redirect

### 5. Use PowerShell Directly

If you can obtain Global Admin credentials (via the .onmicrosoft.com account):

```powershell
# Install Microsoft Graph PowerShell
Install-Module Microsoft.Graph -Scope CurrentUser

# Connect with the .onmicrosoft.com admin
Connect-MgGraph -Scopes "Application.ReadWrite.All"

# Create an app registration via PowerShell
$app = New-MgApplication -DisplayName "My Email App" -SignInAudience "AzureADMyOrg"
```

**Caveat:** PowerShell access may also be restricted on federated tenants. The MSOnline module and some Graph cmdlets may fail if the tenant configuration blocks them.

### 6. Ask GoDaddy to Remove the Tenant Binding

Some users report success by contacting GoDaddy support and specifically requesting:
- "Remove the tenant binding"
- "Release the domain from the M365 tenant"
- "Grant full Global Administrator access"

This is hit-or-miss depending on the support agent.

### Sources
- [Access Azure AD GoDaddy Office 365 Tenants - Vircom Help](https://vircomhelp.freshdesk.com/support/solutions/articles/48001185074-access-azure-ad-godaddy-office-365-tenants)
- [Admin App Redirects to GoDaddy - Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/2b1d463b-f556-4eaa-b47e-50b1e049b8f7/admin-app-redirects-to-godaddy)
- [Admin centre redirecting to GoDaddy - Microsoft Answers](https://answers.microsoft.com/en-us/msoffice/forum/all/admin-centre-redirecting-to-godaddy-and-unable-to/2b79bc0b-a986-4ead-91d5-233984d336c3)

---

## The Defederation Path

Defederation is the process of removing GoDaddy's federated control over your M365 tenant, converting it to a standard Microsoft-managed tenant. This is the **recommended long-term solution** and is now officially supported by both Microsoft and GoDaddy.

### Overview

- **Impact**: No data loss. Email continues to flow during the process.
- **Downtime**: Minimal if planned properly. Users need to reset passwords.
- **Cost**: You will need to purchase M365 licenses directly from Microsoft or a CSP, replacing the GoDaddy licenses.
- **Complexity**: Moderate. Can be done by a technical user following the guides, but many choose to hire an MSP.

### Step-by-Step Process

#### A. Prepare End Users
- Notify users of a planned maintenance window (recommend non-business hours)
- Collect or pre-set passwords (users will need to reset after defederation)
- Warn about potential Office app reactivation prompts

#### B. Gain True Global Admin Access
1. Log in to https://portal.azure.com with the GoDaddy admin account
2. Navigate to Microsoft Entra ID > Users
3. Find the `@NETORG*.onmicrosoft.com` admin user
4. Reset their password, copy the temp password
5. Open an incognito browser, sign in with the `.onmicrosoft.com` account
6. Complete any MFA setup
7. Verify this account has Global Administrator role

#### C. Remove Federation via PowerShell

Using the Microsoft Graph PowerShell SDK (recommended over the deprecated MSOnline module):

```powershell
# Install the module
Install-Module Microsoft.Graph -Scope CurrentUser

# Connect as the .onmicrosoft.com Global Admin
Connect-MgGraph -Scopes "Domain.ReadWrite.All"

# Check current domain status
Get-MgDomain

# Change from Federated to Managed
Update-MgDomain -DomainId "yourdomain.com" -AuthenticationType "Managed"

# Verify the change
Get-MgDomain
```

**Important:** ALL domains in the tenant must be converted to Managed, even unused ones.

#### D. Reset All User Passwords
- Users cannot log in with old passwords after defederation
- Can be done manually or via bulk PowerShell script from a CSV
- Distribute new passwords to users

#### E. Purchase New Licenses
- Buy M365 licenses directly from Microsoft (admin.microsoft.com > Billing) or through a CSP
- Match the license count and type you currently have
- Assign licenses to users before canceling GoDaddy

#### F. Remove GoDaddy as Delegated Admin
1. In M365 Admin Center: Settings > Partner Relationships > remove GoDaddy's roles
2. In Entra ID: Enterprise Applications > delete "Partner Center Web App" (GoDaddy's enterprise app)
3. Delete GoDaddy's admin user from the tenant

#### G. Cancel GoDaddy M365 Subscription

**CRITICAL WARNING:** Do NOT cancel the GoDaddy subscription before completing step F. If GoDaddy still has delegated admin access when you cancel, **they will run a script that deletes all users and removes the primary domain.** This is recoverable but causes significant downtime.

#### H. Post-Migration Tasks
- Update DNS records if GoDaddy was managing them (especially MX records)
- If you had GoDaddy's email security add-on (Proofpoint), update MX records immediately -- email will go down otherwise
- Update SharePoint URLs if needed
- Remove any remaining GoDaddy artifacts from the tenant

### Official Documentation
- [Defederation Process for Microsoft 365 Admins Using GoDaddy - Microsoft Learn](https://learn.microsoft.com/en-us/microsoft-365/admin/get-help-with-domains/godaddy-defederation-process?view=o365-worldwide)
- [Move my Microsoft 365 email away from GoDaddy - GoDaddy Help](https://www.godaddy.com/help/move-my-microsoft-365-email-away-from-godaddy-40094)

### Community Guides (Detailed Step-by-Step)
- [Defederating GoDaddy 365 - TMinus365](https://tminus365.com/defederating-godaddy-365/)
- [Defederating GoDaddy 365 - TMinus365 Docs](https://docs.tminus365.com/configurations/godaddy/defederating-godaddy-365)
- [How to Defederate GoDaddy 365 the Right Way (2025 Guide) - CyberQuell](https://www.cyberquell.com/blog/how-to-defederate-godaddy-365-the-right-way-2025-guide)
- [Defederate GoDaddy Office 365 for Full Control - Leeward Cloud](https://www.leewardcloud.io/post/defederate-from-godaddy-office-365-and-take-control-of-your-tenant)
- [GoDaddy Defederation - Sourcepass](https://blog.sourcepass.com/sourcepass-blog/godaddy-defederation-a-full-microsoft-365-transition-sourcepass)

---

## EWS Deprecation Timeline

This is relevant because EWS might seem like a workaround that avoids needing Graph API / app registration. It is not a viable long-term path.

| Date | Event |
|---|---|
| 2018 | Microsoft announces EWS will no longer receive feature updates |
| 2023 | Microsoft announces EWS will be retired in Exchange Online |
| Jan 2024 | Midnight Blizzard security incident (involving EWS) accelerates deprecation |
| Mar 1, 2026 | EWS blocked for F3/frontline-licensed mailboxes |
| **Oct 1, 2026** | **EWS blocked for ALL non-Microsoft apps in Exchange Online** |

After October 2026, the only supported methods for programmatic Exchange Online access are:
- **Microsoft Graph API** (recommended)
- **IMAP/POP/SMTP with OAuth2** (supported but requires app registration)

Both require an Entra ID app registration.

### Sources
- [Deprecation of Exchange Web Services - Microsoft Learn](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-ews-exchange-online)
- [Retirement of Exchange Web Services - Microsoft Community Hub](https://techcommunity.microsoft.com/blog/exchange/retirement-of-exchange-web-services-in-exchange-online/3924440)
- [Microsoft to Kill Off Exchange Web Services in October 2026 - Petri](https://petri.com/microsoft-exchange-web-services-2026/)

---

## Recommendations

### For Your Situation (bmo@bmobot.ai on GoDaddy M365)

Here are the practical options, ordered from quickest to most thorough:

---

### Option 1: Try the Azure Portal Backdoor (Quick, Low Risk)

**Effort:** 30 minutes | **Risk:** Low | **Reliability:** Uncertain

1. Go to https://portal.azure.com and sign in with your M365 admin account
2. Navigate to Microsoft Entra ID > Users
3. Find the `.onmicrosoft.com` admin user and reset its password
4. Sign in with that account in an incognito window
5. Try to access App Registrations

If this works, you can register an app and get Graph API credentials. This is the fastest path but may not work on all GoDaddy tenants.

---

### Option 2: Use PowerShell to Register an App (Quick, Moderate Risk)

**Effort:** 1-2 hours | **Risk:** Moderate | **Reliability:** Uncertain

If you can get Global Admin credentials (via the `.onmicrosoft.com` account), try creating an app registration via PowerShell:

```powershell
Install-Module Microsoft.Graph -Scope CurrentUser
Connect-MgGraph -Scopes "Application.ReadWrite.All"
$app = New-MgApplication -DisplayName "BMO Email App" -SignInAudience "AzureADMyOrg"
# Then add credentials, permissions, etc.
```

This bypasses the portal UI entirely. May fail if GoDaddy has restricted PowerShell access.

---

### Option 3: Defederate from GoDaddy (Recommended, Permanent Fix)

**Effort:** 2-4 hours | **Risk:** Moderate (follow guides carefully) | **Reliability:** High

This is the recommended solution. It gives you full control of your M365 tenant, including:
- Full Entra admin access
- App registrations for Graph API
- PowerShell admin access
- All M365 admin features

**Steps:**
1. Follow the TMinus365 guide: https://docs.tminus365.com/configurations/godaddy/defederating-godaddy-365
2. Purchase M365 licenses directly from Microsoft ($6/user/month for Business Basic, $12.50 for Business Standard)
3. Remove GoDaddy as delegated admin BEFORE canceling
4. Cancel GoDaddy M365 subscription

**Cost impact:** Likely cheaper than GoDaddy's renewal pricing, and you get more features.

**Time impact:** Can be done in a single maintenance window (2-4 hours). No email downtime if planned correctly.

---

### Option 4: Use a Completely Different Email Provider

**Effort:** High | **Risk:** Moderate | **Reliability:** High

If you want to avoid M365 entirely, consider:
- **Fastmail** (already used alongside GoDaddy?) -- supports JMAP API natively, no Entra registration needed
- **Google Workspace** -- supports Gmail API with straightforward OAuth2 setup
- **Migrating the bmobot.ai domain** to a new email provider entirely

This is more work but avoids the M365/Entra ecosystem entirely.

---

### Option 5: Temporary SMTP/IMAP with Basic Auth (Stopgap Only)

**Effort:** Low | **Risk:** High (will break eventually) | **Reliability:** Temporary

If Basic Auth SMTP/IMAP still works on your GoDaddy M365 account:
- Server: `smtp.office365.com` (port 587, STARTTLS)
- Server: `outlook.office365.com` (port 993, IMAP SSL/TLS)
- Username: Your M365 email address
- Password: Your M365 password

**WARNING:** Basic Auth is being phased out. This could stop working at any time with no notice. Do not build anything permanent on this.

---

### Summary Decision Matrix

| Option | Effort | Cost | Reliability | API Access | Timeline |
|---|---|---|---|---|---|
| Azure Portal Backdoor | Low | Free | Uncertain | Graph API | Immediate |
| PowerShell App Registration | Low-Med | Free | Uncertain | Graph API | Immediate |
| **Defederate (Recommended)** | **Medium** | **~$6-12.50/user/mo** | **High** | **Full Graph API** | **2-4 hours** |
| Switch Email Provider | High | Varies | High | Provider-specific | Days-weeks |
| Basic Auth SMTP/IMAP | Low | Free | Temporary | SMTP/IMAP only | Will break |

### Final Recommendation

**Defederate from GoDaddy.** The process is well-documented, officially supported by Microsoft, and resolves not just the API access issue but also unlocks the full M365 admin experience. Given that GoDaddy's renewal pricing is typically higher than buying direct from Microsoft, you will likely save money as well.

Try Options 1-2 first as quick experiments. If they work, you have immediate API access. If they do not, proceed directly to defederation (Option 3).

---

*Report compiled January 29, 2026. Information sourced from Microsoft Learn, GoDaddy Help, Microsoft Q&A, TMinus365, and various IT community resources.*
