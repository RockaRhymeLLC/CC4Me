---
name: upstream
description: Contribute fork enhancements back to upstream CC4Me via the GitHub fork + PR pipeline.
argument-hint: [sync | prepare <description> | pr | status | audit]
disable-model-invocation: true
---

# Upstream Contributions

Contribute enhancements from your fork back to upstream CC4Me using the GitHub fork pipeline.

## Architecture

```
Upstream (RockaRhyme/CC4Me)          Your Fork (RockaRhymeLLC/CC4Me-BMO)
+-------------------+               +-------------------+
|  Generic, clean   |  <── PR ───   | feature/my-change |
|  code for anyone  |               | (branched from    |
|                   |               |  upstream/main)   |
+-------------------+               +-------------------+
        |                                    ^
        |          git fetch upstream        |
        +------------------------------------+
```

**Key principle**: Feature branches for upstream PRs are always based on `upstream/main`, not your fork's `main`. Your fork's main has instance-specific code that should never reach upstream.

## Remotes

| Remote | Points To | Purpose |
|--------|-----------|---------|
| `origin` | `RockaRhymeLLC/CC4Me-BMO` | Your fork in the org |
| `upstream` | `RockaRhyme/CC4Me` | The upstream project |

## Usage

- `/upstream` or `/upstream status` — Show open PRs, sync status, pending work
- `/upstream sync` — Fetch latest upstream/main
- `/upstream prepare "description"` — Start a new contribution (creates branch from upstream/main)
- `/upstream pr` — Create a PR from the current feature branch against upstream
- `/upstream audit` — Audit current branch for genericization issues before PR

## Workflow

### 1. Sync with upstream

```bash
git fetch upstream
```

Always sync before starting new work.

### 2. Create a feature branch from upstream/main

```bash
git checkout -b feature/my-change upstream/main
```

**This is critical.** Branching from `upstream/main` ensures your PR only contains the changes you intend — not your entire fork's divergence.

### 3. Make changes

Write or port the enhancement. If porting code from your fork's main branch, copy the relevant changes — don't merge or cherry-pick (those can pull in unwanted history).

**Apply genericization rules** (see below) to every file you touch.

### 4. Audit before committing

Run through the audit checklist for each file. Fix any issues found.

### 5. Commit and push

```bash
git add <files>
git commit -m "Add feature description"
git push -u origin feature/my-change
```

### 6. Create PR against upstream

```bash
gh pr create \
  --repo RockaRhyme/CC4Me \
  --head RockaRhymeLLC:feature/my-change \
  --base main \
  --title "PR title" \
  --body "Description"
```

### 7. Review and merge

PRs are reviewed by the owner and/or other agents (R2). After merge:

```bash
git fetch upstream
# Optionally clean up the feature branch
git branch -d feature/my-change
git push origin --delete feature/my-change
```

## Genericization Rules

When contributing code upstream, it must work for any CC4Me instance — not just yours.

### 1. Remove personal data
- Strip all references to specific people, emails, phone numbers, chat IDs
- Replace names with generic terms: "the user", "the agent", "the assistant"
- Search for: personal names, usernames, phone numbers, domain names, addresses

### 2. Remove hardcoded paths
- Replace absolute user paths with relative paths or `$PROJECT_DIR`
- Scripts: use `$BASE_DIR` or `$(dirname "$0")/..` patterns
- Config: use template variables (`__PROJECT_DIR__`, `__HOME_DIR__`)

### 3. Parameterize credentials
- All secrets must come from Keychain lookups, never hardcoded
- Verify `security find-generic-password` calls use generic credential names
- Document required Keychain entries

### 4. Remove branded content
- No instance-specific names, personalities, or identity references
- Use template placeholders where names appear in config/prompts
- Keep default values generic (e.g., session name "cc4me", not an agent name)

### 5. Preserve functionality
- Genericized code must work identically — just without instance-specific assumptions
- Test mentally: "Would this work on a fresh clone with a different agent name?"

## Audit Checklist (Per File)

Before committing any file for upstream, verify:

- [ ] **No personal data**: Names, emails, phone numbers, chat IDs, addresses?
- [ ] **No hardcoded paths**: Absolute paths to a specific user's home directory?
- [ ] **No credentials**: API keys, tokens, or secrets in the code?
- [ ] **Portable**: Works on a fresh macOS install with a different username?
- [ ] **Code quality**: Clean, readable, well-structured?
- [ ] **Error handling**: Appropriate for the context?
- [ ] **Dependencies**: All documented? Any unnecessary ones?
- [ ] **Dead code**: Unused variables, unreachable branches, commented-out code?
- [ ] **Consistent patterns**: Follows the same conventions as existing upstream code?

## Common Pitfalls

### Don't branch from your fork's main
Your fork's `main` has instance-specific commits. Always branch from `upstream/main`.

### Don't merge or rebase from your fork's main
If you need code from your fork, copy the relevant changes manually. Git merge/rebase will bring in your entire fork history.

### Watch for diverged files
Your fork's version of a file may differ significantly from upstream's. When porting a fix, apply only the targeted change to the upstream version — don't wholesale replace the file.

### PII in git history
Even if you scrub PII from files, it persists in git history. If PII gets committed:
1. Don't just fix it in a new commit
2. Delete the branch from the remote (`git push origin --delete branch-name`)
3. Start fresh with a new branch

## Status Check

To see current state:

```bash
# Open PRs from your fork against upstream
gh pr list --repo RockaRhyme/CC4Me --author @me

# How far behind upstream you are
git fetch upstream
git log --oneline HEAD..upstream/main | head -20

# Current feature branches
git branch | grep feature/
```

## Notes

- **Owner approval required** before creating PRs — present changes for review first
- **One logical change per PR** — don't bundle unrelated changes
- **PR description** should include: summary, files changed, testing notes
- **Clean commit messages** — describe the "why", not just the "what"
- This skill is generic — any CC4Me fork can use `/upstream` to contribute back
