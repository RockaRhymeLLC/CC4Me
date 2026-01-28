-- Open Terminal attached to BMO's tmux session
-- Add this to Login Items for auto-open on login

tell application "Terminal"
    activate
    do script "/Users/bmo/CC4Me-BMO/scripts/attach.sh"
end tell
