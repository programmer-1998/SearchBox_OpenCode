#!/usr/bin/env bash
# SearchBox for OpenCode Desktop - restore the pristine app.asar (Linux & macOS)
set -euo pipefail

case "$(uname -s)" in
  Darwin) APP="/Applications/OpenCode.app/Contents/Resources/app.asar" ;;
  Linux)  APP="/opt/OpenCode/resources/app.asar" ;;
  *) echo "Unsupported platform. On Windows use: powershell -File scripts/restore.ps1" >&2; exit 1 ;;
esac
APP="${OPENCODE_ASAR:-$APP}"
BAK="$(dirname "$APP")/app.asar.bak-original"

[ -f "$BAK" ] || { echo "No pristine backup found at $BAK" >&2; exit 1; }
sudo cp -f "$BAK" "$APP"
echo "Restored $APP from $BAK"
echo "Fully quit and reopen OpenCode Desktop."