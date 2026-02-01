#!/bin/bash
#
# CC4Me Setup (alias for init.sh)
#
# This script exists for discoverability - new users often look for
# "setup.sh" when setting up a project for the first time.

exec "$(cd "$(dirname "$0")" && pwd)/init.sh" "$@"
