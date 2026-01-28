#!/bin/bash

# CC4Me Initialization Script
#
# Sets up the project for first-time use
# Run this after cloning the repository

set -e

echo "🚀 CC4Me Setup - Spec-Driven Workflow for Claude Code"
echo "======================================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
  echo "❌ Error: Node.js is not installed"
  echo "Please install Node.js (v18 or higher) from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "⚠️  Warning: Node.js version 18 or higher is recommended"
  echo "Current version: $(node -v)"
fi

echo "✓ Node.js detected: $(node -v)"
echo ""

# Check if Claude Code is installed
if ! command -v claude &> /dev/null; then
  echo "⚠️  Warning: Claude Code CLI not detected"
  echo "Install it from: https://github.com/anthropics/claude-code"
  echo "This project is designed to work with Claude Code, but setup will continue."
  echo ""
else
  echo "✓ Claude Code CLI detected"
  echo ""
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
  echo "❌ Error: Failed to install dependencies"
  exit 1
fi

echo "✓ Dependencies installed"
echo ""

# Make scripts executable
chmod +x scripts/init.sh
chmod +x .claude/hooks/pre-build.sh

echo "✓ Scripts made executable"
echo ""

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
  echo "📝 Creating .env file..."
  cat > .env << 'EOF'
# Claude Code Configuration
# Add your API keys and configuration here

# Anthropic API Key (if using Claude API directly)
# ANTHROPIC_API_KEY=your_api_key_here

# Telegram Bot Token (for future Telegram integration)
# TELEGRAM_BOT_TOKEN=your_bot_token_here

# Authorized Telegram User IDs (comma-separated)
# TELEGRAM_AUTHORIZED_USERS=123456789,987654321
EOF
  echo "✓ .env file created (edit it to add your API keys)"
else
  echo "✓ .env file already exists"
fi
echo ""

# Run tests to verify setup
echo "🧪 Running tests to verify setup..."
npm test -- --passWithNoTests

if [ $? -eq 0 ]; then
  echo "✓ Tests passed (no tests yet, but framework is working)"
else
  echo "⚠️  Test framework may need attention"
fi
echo ""

echo "======================================================"
echo "✅ Setup Complete!"
echo "======================================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Start Claude Code in this directory:"
echo "   $ claude"
echo ""
echo "2. Create your first specification:"
echo "   > /spec my-first-feature"
echo ""
echo "3. Learn about the workflow:"
echo "   - /spec: Create specifications (WHAT to build)"
echo "   - /plan: Create implementation plans (HOW to build)"
echo "   - /validate: Validate spec/plan/implementation"
echo "   - /build: Implement the plan test-first"
echo ""
echo "4. Read the documentation:"
echo "   - README.md: Overview and user guide"
echo "   - SETUP.md: Detailed setup instructions"
echo "   - .claude/CLAUDE.md: Instructions for Claude"
echo ""
echo "Happy building! 🎉"
echo ""
