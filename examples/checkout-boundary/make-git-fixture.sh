#!/usr/bin/env bash
# Thin POSIX wrapper; the implementation is make-git-fixture.mjs (cross-platform).
#
# Usage (from repo root or this directory):
#   bash examples/checkout-boundary/make-git-fixture.sh [/tmp/checkout-fixture]
#
# Prints the absolute path of the fixture repo on stdout (last line).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec node "$ROOT/make-git-fixture.mjs" "$@"
