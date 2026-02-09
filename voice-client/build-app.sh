#!/bin/bash
# Build the BMO Voice menu bar .app bundle.
#
# This creates a lightweight .app wrapper that launches the Python
# voice client from the existing venv — no heavy py2app bundling needed.
#
# Usage:
#   cd voice-client && ./build-app.sh
#
# Result:
#   dist/BMO Voice.app
#
# Install:
#   cp -r "dist/BMO Voice.app" /Applications/
#   Open it, grant microphone permission when prompted.
#   Add to Login Items: System Settings > General > Login Items

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="BMO Voice"
DIST_DIR="$SCRIPT_DIR/dist"
APP_DIR="$DIST_DIR/$APP_NAME.app"
CONTENTS="$APP_DIR/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

echo "=== Building $APP_NAME.app ==="
echo ""

# Verify venv exists
if [ ! -f "$SCRIPT_DIR/.venv/bin/python3" ]; then
    echo "ERROR: No venv found. Run ./install.sh first."
    exit 1
fi

# Verify key files
for f in bmo_menubar.py bmo_voice.py config.yaml Info.plist; do
    if [ ! -f "$SCRIPT_DIR/$f" ]; then
        echo "ERROR: Missing $f"
        exit 1
    fi
done

# Clean previous build
rm -rf "$APP_DIR"

# Create .app structure
mkdir -p "$MACOS" "$RESOURCES"

# Copy Info.plist
cp "$SCRIPT_DIR/Info.plist" "$CONTENTS/Info.plist"

# Create launcher script
# Uses the voice-client directory where the build ran
cat > "$MACOS/BMOVoice" << LAUNCHER
#!/bin/bash
# BMO Voice — menu bar app launcher
# Activates the venv and runs the rumps menu bar wrapper.

VOICE_DIR="$SCRIPT_DIR"
VENV_PYTHON="\$VOICE_DIR/.venv/bin/python3"
SCRIPT="\$VOICE_DIR/bmo_menubar.py"

# Log startup
echo "\$(date): Starting BMO Voice from \$VOICE_DIR" >> ~/Library/Logs/BMOVoice.log

# Set working directory for config.yaml resolution
cd "\$VOICE_DIR"

# exec replaces shell with Python — inherits .app's TCC identity
exec "\$VENV_PYTHON" "\$SCRIPT"
LAUNCHER

chmod +x "$MACOS/BMOVoice"

# Ad-hoc code sign (important for TCC to recognize the bundle identity)
codesign --deep --force --sign - "$APP_DIR" 2>&1

# Validate plist
plutil "$CONTENTS/Info.plist"

# Show result
APP_SIZE=$(du -sh "$APP_DIR" | cut -f1)
echo ""
echo "Built: $APP_DIR ($APP_SIZE)"
echo ""
echo "Install:"
echo "  cp -r \"$APP_DIR\" /Applications/"
echo ""
echo "First launch:"
echo "  1. Open 'BMO Voice' from /Applications"
echo "  2. Grant microphone permission when prompted"
echo "  3. Add to Login Items: System Settings > General > Login Items"
echo ""
echo "The old launchd plist can be removed if you switch to this:"
echo "  launchctl unload ~/Library/LaunchAgents/com.bmo.voice-client.plist"
