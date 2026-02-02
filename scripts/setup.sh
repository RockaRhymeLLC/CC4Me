#!/bin/bash

# CC4Me Setup — alias for init.sh
#
# Provides a discoverable name for the initialization script.
# Usage: ./scripts/setup.sh

exec "$(dirname "${BASH_SOURCE[0]}")/init.sh" "$@"
