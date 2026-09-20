#!/usr/bin/env bash
# Install latest CodexQA CLI + platform binary (references/codexqa-cli.md skill v0.0.7).
set -euo pipefail

REGISTRY="https://registry.npmjs.org/"
export PATH="$(npm prefix -g)/bin:${PATH:-}"

echo "Stopping CodexQA daemon (clears stale platform binary) …"
codexqa stop 2>/dev/null || true

echo "Removing legacy CodexQA installs …"
npm uninstall -g @openqa-cn/codexqa 2>/dev/null || true
npm uninstall -g @openqa-cn/codexqa-darwin-arm64 2>/dev/null || true
npm uninstall -g @openqa-cn/codexqa-darwin-x64 2>/dev/null || true
npm uninstall -g @openqa-cn/codexqa-linux-x64 2>/dev/null || true
if command -v brew >/dev/null 2>&1; then
  brew uninstall codexqa 2>/dev/null || true
fi

echo "Installing @openqa-cn/codexqa@latest …"
npm install -g @openqa-cn/codexqa@latest --registry "$REGISTRY"

# Ensure platform binary package matches latest (npm optionalDependencies may lag).
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  PLATFORM_PKG="@openqa-cn/codexqa-darwin-arm64" ;;
  Darwin-x86_64) PLATFORM_PKG="@openqa-cn/codexqa-darwin-x64" ;;
  Linux-x86_64)  PLATFORM_PKG="@openqa-cn/codexqa-linux-x64" ;;
  *) PLATFORM_PKG="" ;;
esac
if [[ -n "$PLATFORM_PKG" ]]; then
  echo "Installing latest platform binary ${PLATFORM_PKG} …"
  npm install -g "${PLATFORM_PKG}@latest" --registry "$REGISTRY"
fi

export PATH="$(npm prefix -g)/bin:${PATH:-}"

if ! command -v codexqa >/dev/null 2>&1; then
  echo "codexqa not on PATH after install; try: export PATH=\"\$(npm prefix -g)/bin:\$PATH\"" >&2
  exit 1
fi
if ! codexqa --help >/dev/null 2>&1; then
  echo "codexqa launched but platform binary failed." >&2
  echo "See references/codexqa-cli.md install section." >&2
  exit 2
fi

# Force daemon restart so queries use the freshly installed platform binary.
codexqa stop 2>/dev/null || true

NPM_VER="$(npm list -g @openqa-cn/codexqa --depth=0 2>/dev/null | sed -n 's/.*@\openqa-cn\/codexqa@//p' | head -1)"
PLATFORM_VER=""
if [[ -n "${PLATFORM_PKG:-}" ]]; then
  PLATFORM_VER="$(npm list -g "$PLATFORM_PKG" --depth=0 2>/dev/null | sed -n 's/.*@//p' | head -1)"
fi
CLI_VER="$(codexqa --version 2>&1 || true)"

echo "codexqa OK: $(command -v codexqa)"
echo "  npm wrapper:  @openqa-cn/codexqa@${NPM_VER:-unknown}"
echo "  platform pkg: ${PLATFORM_PKG:-n/a}@${PLATFORM_VER:-n/a}"
echo "  binary --version: ${CLI_VER}"

echo "Smoke: native change-groups API (must not be unknown variant) …"
SMOKE_OUT="$(codexqa query --repo . change-groups 2>&1 || true)"
if echo "$SMOKE_OUT" | grep -qi 'unknown variant.*ChangeGroups'; then
  echo "FAIL: platform binary too old — change-groups not supported." >&2
  echo "$SMOKE_OUT" >&2
  echo "Run: codexqa stop && npm install -g @openqa-cn/codexqa-darwin-arm64@latest" >&2
  exit 3
fi
if echo "$SMOKE_OUT" | grep -qE '"kind"[[:space:]]*:[[:space:]]*"ChangeGroups"'; then
  echo "Native change-groups OK."
else
  echo "Smoke output (index may be missing — OK if not 'unknown variant'):"
  echo "$SMOKE_OUT" | head -3
fi

codexqa query --help 2>&1 | grep -E 'change-groups|symbol-diff' || true
