#!/bin/bash

# CC4Me Initialization Script
#
# Sets up the project for first-time use
# Run this after cloning the repository

set -e

echo "CC4Me Setup - Spec-Driven Workflow + Personal Assistant"
echo "========================================================"
echo ""

# Check if Claude Code is installed
if ! command -v claude &> /dev/null; then
  echo "Warning: Claude Code CLI not detected"
  echo "Install it from: https://github.com/anthropics/claude-code"
  echo ""
else
  echo "Claude Code CLI detected"
  echo ""
fi

# Make scripts executable
echo "Making scripts executable..."
chmod +x scripts/init.sh
chmod +x scripts/start.sh
chmod +x .claude/hooks/*.sh 2>/dev/null || true

echo "Scripts ready"
echo ""

echo "========================================================"
echo "Setup Complete!"
echo "========================================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Start Claude Code with custom system prompt:"
echo "   $ ./scripts/start.sh"
echo ""
echo "   Or start without custom prompt:"
echo "   $ claude"
echo ""
echo "2. Run the setup wizard:"
echo "   > /setup"
echo ""
echo "3. Or dive right in:"
echo "   > /spec my-first-feature"
echo ""
echo "Skills available:"
echo "  /spec     - Create specifications"
echo "  /plan     - Create implementation plans"
echo "  /validate - Validate alignment"
echo "  /build    - Implement test-first"
echo "  /todo     - Manage persistent to-dos"
echo "  /memory   - Store and lookup facts"
echo "  /calendar - Manage schedule"
echo "  /mode     - Set autonomy level"
echo ""
