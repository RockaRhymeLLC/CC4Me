#!/bin/bash
# CC4Me Voice Client — install dependencies
#
# Usage: cd voice-client && ./install.sh
#
# Creates a Python venv and installs all required packages.
# Requires: Python 3.10+, Homebrew (for portaudio if needed)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

echo "=== CC4Me Voice Client Setup ==="
echo ""

# Check Python version
PYTHON=""
for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" &>/dev/null; then
        version=$("$candidate" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        major=$(echo "$version" | cut -d. -f1)
        minor=$(echo "$version" | cut -d. -f2)
        if [ "$major" -ge 3 ] && [ "$minor" -ge 10 ]; then
            PYTHON="$candidate"
            break
        fi
    fi
done

if [ -z "$PYTHON" ]; then
    echo "ERROR: Python 3.10+ required. Install with: brew install python@3.12"
    exit 1
fi

echo "Using Python: $PYTHON ($($PYTHON --version))"

# Create venv
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    "$PYTHON" -m venv "$VENV_DIR"
fi

# Activate and install
echo "Installing dependencies..."
source "$VENV_DIR/bin/activate"
pip install --upgrade pip -q
pip install -r "$SCRIPT_DIR/requirements.txt" -q

# Download pre-trained wake word models (for initial testing)
echo ""
echo "Downloading pre-trained wake word models..."
python3 -c "import openwakeword; openwakeword.utils.download_models()"

echo ""
echo "=== Setup complete ==="
echo ""
echo "To run the voice client:"
echo "  source $VENV_DIR/bin/activate"
echo "  python3 voice_client.py"
echo ""
echo "Or use the launchd plist for auto-start:"
echo "  cp com.cc4me.voice-client.plist ~/Library/LaunchAgents/"
echo "  launchctl load ~/Library/LaunchAgents/com.cc4me.voice-client.plist"
echo ""
echo "NOTE: On first run, macOS will ask for microphone permission."
echo "      Click 'Allow' when prompted."
