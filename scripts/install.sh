#!/usr/bin/env bash
# SearchBox for OpenCode Desktop — install (Linux & macOS)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- locate app.asar -------------------------------------------------------
case "$(uname -s)" in
  Darwin) DEFAULT="/Applications/OpenCode.app/Contents/Resources/app.asar" ;;
  Linux)  DEFAULT="/opt/OpenCode/resources/app.asar" ;;
  *) echo "Unsupported platform. On Windows use: powershell -File scripts/install.ps1" >&2; exit 1 ;;
esac
APP="${OPENCODE_ASAR:-$DEFAULT}"

# --- prerequisites ----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js >= 22.12.0 is required (https://nodejs.org)" >&2
  exit 1
fi
if ! node -e 'const v=process.versions.node.split(".");process.exit(+v[0]>22||(+v[0]===22&&+v[1]>=12)?0:1)'; then
  echo "Node.js >= 22.12.0 is required (found $(node -v))" >&2
  exit 1
fi
if [ ! -f "$APP" ]; then
  echo "app.asar not found at $APP" >&2
  echo "Override with: OPENCODE_ASAR=/path/to/app.asar $(basename "$0")" >&2
  exit 1
fi

# --- pristine backup (keep the original so rebuilds stay idempotent) ---------
APP_DIR="$(dirname "$APP")"
BAK="$APP_DIR/app.asar.bak-original"
if [ ! -f "$BAK" ]; then
  sudo cp -f "$APP" "$BAK"
  echo "Created pristine backup: $BAK"
else
  echo "Using existing pristine backup: $BAK"
fi

# --- build patched archive (to a temp file, then elevate the copy) ----------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
node "$REPO_DIR/patch/patch-asar.mjs" \
  --src "$BAK" \
  --out "$TMP/app.asar" \
  --snippet "$REPO_DIR/patch/index-inject.html" \
  --bridge "$REPO_DIR/patch/bridge.js"

sudo cp -f "$TMP/app.asar" "$APP"
echo ""
echo "Patch applied to: $APP"
echo ""
echo "Next steps:"
echo "  1. Fully quit OpenCode Desktop (Cmd+Q / Ctrl+Q — not just close the window)."
echo "  2. Reopen it. The search box appears only inside a chat that has messages."
echo "  3. Press the ↑/↓ arrows or Enter/Shift+Enter while typing to jump between matches."
echo ""
echo "Restore any time with: sudo cp -f \"$BAK\" \"$APP\""