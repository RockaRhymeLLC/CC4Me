#!/bin/bash
# One-shot reminder: Grant's soccer game 2026-01-31
# Self-cleaning: removes itself and its plist after running

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
BASE_DIR="/Users/bmo/CC4Me-BMO"

"$BASE_DIR/scripts/telegram-send.sh" "7629737488" "Hey Dave! Time to head out for Grant's soccer game. 2018 Boys Maroon at Lions — 7125 Columbia Gateway Dr, Columbia. Noon kickoff, so leaving now gets you there 30 min early. Good luck Grant!"

# Clean up: remove the launchd plist and this script
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.bmo.reminder.soccer-20260131.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/com.bmo.reminder.soccer-20260131.plist
rm -f "$0"
