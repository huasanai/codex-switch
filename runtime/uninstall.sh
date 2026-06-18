#!/usr/bin/env bash
# 关闭「多模型模式」，恢复 Codex 原生 GPT 直连：① 停删 LaunchAgent ② 精确删 config 标记块。
# 删完需完全退出并重启 Codex App。
set -euo pipefail

ROUTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
CONFIG_FILE="$CODEX_HOME_DIR/config.toml"
PLIST="$HOME/Library/LaunchAgents/com.codexswitch.router.plist"
LABEL="com.codexswitch.router"
PORT="${CODEX_ROUTER_PORT:-18788}"

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true

if [[ -f "$CONFIG_FILE" ]]; then
  perl -0pi -e 's/\n?# BEGIN CODEXSWITCH\n.*?# END CODEXSWITCH\n?/\n/s' "$CONFIG_FILE"
fi

echo "── 多模型模式已关闭 ──"
echo "config.toml 标记块已移除，GPT 恢复原生 OAuth 直连。"
echo "请完全退出并重启 Codex App（Cmd+Q）。"
