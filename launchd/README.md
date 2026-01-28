# launchd Service Configuration

This directory contains templates for running the assistant as a persistent macOS service using launchd.

## Overview

launchd is macOS's service management framework. By configuring a launchd service, you can:
- Keep the assistant running continuously
- Auto-restart after crashes
- Start on login
- Only run when network is available

## Quick Start

### 1. Customize the Template

Copy and edit the template:

```bash
cp launchd/com.assistant.harness.plist.template ~/Library/LaunchAgents/com.assistant.harness.plist
```

Edit `~/Library/LaunchAgents/com.assistant.harness.plist` and update:
- `WorkingDirectory` - Path to your CC4Me project
- `StandardOutPath` - Path for log files
- `StandardErrorPath` - Path for error logs
- Replace `YOUR_USERNAME` with your actual username

### 2. Create Log Directory

```bash
mkdir -p ~/.claude/logs
```

### 3. Load the Service

```bash
launchctl load ~/Library/LaunchAgents/com.assistant.harness.plist
```

### 4. Verify It's Running

```bash
launchctl list | grep assistant
```

## Management Commands

```bash
# Start the service
launchctl start com.assistant.harness

# Stop the service
launchctl stop com.assistant.harness

# Unload (disable) the service
launchctl unload ~/Library/LaunchAgents/com.assistant.harness.plist

# Reload after config changes
launchctl unload ~/Library/LaunchAgents/com.assistant.harness.plist
launchctl load ~/Library/LaunchAgents/com.assistant.harness.plist
```

## Viewing Logs

```bash
# View standard output
tail -f ~/.claude/logs/assistant.log

# View errors
tail -f ~/.claude/logs/assistant.error.log
```

## Configuration Options

### KeepAlive

The template is configured to restart if the process exits:

```xml
<key>KeepAlive</key>
<dict>
    <key>SuccessfulExit</key>
    <false/>
    <key>NetworkState</key>
    <true/>
</dict>
```

- `SuccessfulExit: false` - Restart even on clean exit
- `NetworkState: true` - Only run when network is available

### ThrottleInterval

```xml
<key>ThrottleInterval</key>
<integer>30</integer>
```

Wait 30 seconds before restarting after a crash to prevent rapid restart loops.

### Scheduled Start

To run at specific times instead of continuously, add:

```xml
<key>StartCalendarInterval</key>
<dict>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>0</integer>
</dict>
```

And remove the `KeepAlive` section.

### Watch for File Changes

To restart when configuration changes:

```xml
<key>WatchPaths</key>
<array>
    <string>/path/to/CC4Me/.claude/CLAUDE.md</string>
</array>
```

## Troubleshooting

### Service Won't Start

1. Check the error log:
   ```bash
   cat ~/.claude/logs/assistant.error.log
   ```

2. Verify paths are correct in the plist

3. Check for syntax errors:
   ```bash
   plutil -lint ~/Library/LaunchAgents/com.assistant.harness.plist
   ```

### Service Keeps Restarting

1. Check ThrottleInterval (should be at least 30)
2. Review logs for crash reasons
3. Test claude manually first

### Permission Issues

Ensure the plist file has correct permissions:
```bash
chmod 644 ~/Library/LaunchAgents/com.assistant.harness.plist
```

## Security Notes

- The service runs as your user account
- Has access to your Keychain (for credentials)
- Network access is enabled
- Consider running in a sandboxed environment for production use

## Alternative: Homebrew Services

If you installed Claude Code via Homebrew, you may be able to use:

```bash
brew services start claude
```

Check Claude Code documentation for official service management options.
