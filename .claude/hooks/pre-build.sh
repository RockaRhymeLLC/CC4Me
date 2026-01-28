#!/bin/bash

# Pre-Build Hook
#
# Automatically runs before the /build skill executes
# Validates that spec and plan are complete before allowing build to proceed
#
# Exit code 0: Validation passed, proceed with build
# Exit code 1: Validation failed, block build

set -e  # Exit on any error

echo "🔍 Running pre-build validation..."
echo ""

# Find the plan file path from command arguments
# This hook receives the same arguments as the /build command
PLAN_FILE="$1"

if [ -z "$PLAN_FILE" ]; then
  echo "❌ Error: No plan file specified"
  echo "Usage: /build <plan-file-path>"
  exit 1
fi

# Check if plan file exists
if [ ! -f "$PLAN_FILE" ]; then
  echo "❌ Error: Plan file not found: $PLAN_FILE"
  exit 1
fi

# Extract spec file path from plan
SPEC_FILE=$(grep "Spec" "$PLAN_FILE" | grep -oE "specs/[^ )]+" | head -1)

if [ -z "$SPEC_FILE" ]; then
  echo "❌ Error: Could not find spec file reference in plan"
  exit 1
fi

echo "📋 Validating spec: $SPEC_FILE"
if ! npm run validate:spec -- "$SPEC_FILE"; then
  echo ""
  echo "❌ Spec validation failed. Fix spec errors before building."
  exit 1
fi

echo ""
echo "📝 Validating plan: $PLAN_FILE"
if ! npm run validate:plan -- "$PLAN_FILE"; then
  echo ""
  echo "❌ Plan validation failed. Fix plan errors before building."
  exit 1
fi

echo ""
echo "✅ Pre-build validation passed! Proceeding with build..."
echo ""

exit 0
