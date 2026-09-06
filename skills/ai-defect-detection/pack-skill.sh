#!/bin/bash
# Pack this skill as an Agent Skills zip (Cursor / OpenClaw / Claude Code).
# Output: ai-defect-detection.zip  with top-level folder ai-defect-detection/SKILL.md
# Do not rename the zip to .jar — hosts do not load JVM archives.

set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
NAME="ai-defect-detection"
OUT_DIR="${1:-$SRC}"
ZIP="$OUT_DIR/${NAME}.zip"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DEST="$TMP/$NAME"
mkdir -p "$DEST"

rsync -a \
  --exclude "*.zip" \
  --exclude "*.jar" \
  --exclude "pack-skill.sh" \
  --exclude "__pycache__/" \
  --exclude "__MACOSX/" \
  --exclude ".DS_Store" \
  --exclude "._*" \
  --exclude "tests/" \
  --exclude "data/" \
  --exclude "config.yaml" \
  --exclude "*.pyc" \
  --exclude "package.json" \
  --exclude "tsconfig.json" \
  --exclude "node_modules/" \
  --exclude "*.py" \
  --exclude "*.lock" \
  "$SRC/" "$DEST/"

# Drop AppleDouble leftovers that rsync may still copy from a macOS working tree.
find "$DEST" \( -name '.DS_Store' -o -name '._*' -o -name '__MACOSX' \) -prune -exec rm -rf {} + 2>/dev/null || true

# Frontmatter name must match the folder name inside the zip.
if ! grep -q '^name: ai-defect-detection$' "$DEST/SKILL.md"; then
  echo "SKILL.md name is not ai-defect-detection" >&2
  exit 1
fi
if [ ! -f "$DEST/open_detect.ts" ]; then
  echo "missing open_detect.ts" >&2
  exit 1
fi

rm -f "$ZIP"
# COPYFILE_DISABLE + zip -X: do not emit macOS __MACOSX / ._* resource forks.
(cd "$TMP" && COPYFILE_DISABLE=1 zip -qrX "$ZIP" "$NAME")
echo "packed $ZIP"
