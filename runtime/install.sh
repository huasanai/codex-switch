#!/usr/bin/env bash
# 开启「多模型模式」：① 读 providers.json 生成含 GPT 的混合 catalog ② 注入 config.toml 标记块
# ③ 装并启动本地 router 的 LaunchAgent。装完需完全退出并重启 Codex App。
set -euo pipefail

ROUTER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
CONFIG_FILE="$CODEX_HOME_DIR/config.toml"
CATALOG_DIR="$CODEX_HOME_DIR/model-catalogs"
CATALOG_FILE="$CATALOG_DIR/codexswitch-models.json"
BACKUP_DIR="$CODEX_HOME_DIR/backups"
ENV_FILE="$ROUTER_DIR/.env"
PLIST="$HOME/Library/LaunchAgents/com.codexswitch.router.plist"
LABEL="com.codexswitch.router"
PORT="${CODEX_ROUTER_PORT:-18788}"

mkdir -p "$CATALOG_DIR" "$BACKUP_DIR" "$HOME/Library/LaunchAgents"

find_node() {
  for c in "${NODE_BIN:-}" /opt/homebrew/bin/node /usr/local/bin/node \
           /Applications/Codex.app/Contents/Resources/cua_node/bin/node \
           "$(command -v node 2>/dev/null || true)"; do
    [[ -n "$c" && -x "$c" ]] && { echo "$c"; return 0; }
  done
  return 1
}
NODE_BIN="$(find_node)" || { echo "Node.js not found. Install Node or set NODE_BIN." >&2; exit 127; }

[[ -f "$CONFIG_FILE" ]] || touch "$CONFIG_FILE"
if [[ ! -f "$ENV_FILE" ]]; then
  umask 077
  printf '# Codex multi-model router secrets. Keep local.\nCODEX_ROUTER_HOST=127.0.0.1\nCODEX_ROUTER_PORT=%s\n' "$PORT" > "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

# .env 是端口的唯一真相源：让 config 块、router、mmctl 全部以它为准，避免端口不一致
envport="$(grep -E '^CODEX_ROUTER_PORT=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]')"
[[ -n "$envport" ]] && PORT="$envport"

if [[ ! -f "$ROUTER_DIR/providers.json" ]]; then
  echo "缺少 $ROUTER_DIR/providers.json，无法生成 catalog。请重新运行 setup.command。" >&2
  exit 1
fi

# ① 生成混合 catalog（GPT 恒在 + providers.json 里 enabled 的厂商）
"$NODE_BIN" "$ROUTER_DIR/build-catalog.mjs" "$CATALOG_FILE"

# ② config.toml：备份干净版 → 清掉旧的本工具块（互斥，避免重复 model_provider）→ 插入标记块
ts="$(date +%Y%m%d-%H%M%S)"
backup="$BACKUP_DIR/config.before-codexswitch.$ts.toml"
if grep -qE '# BEGIN (CODEXSWITCH|CODEX MULTIMODEL MODE|CODEX SCREENSHOT MODE|CODEX MODEL ROUTER)' "$CONFIG_FILE"; then
  clean="$(find "$BACKUP_DIR" -maxdepth 1 -name 'config.before-*.toml' -type f 2>/dev/null | sort | while read -r f; do
    grep -q '# BEGIN CODEX ' "$f" || echo "$f"; done | tail -n 1)"
  [[ -n "$clean" ]] && backup="$clean"
else
  cp "$CONFIG_FILE" "$backup"
fi
perl -0pi -e 's/\n?# BEGIN CODEXSWITCH\n.*?# END CODEXSWITCH\n?/\n/s' "$CONFIG_FILE"
perl -0pi -e 's/\n?# BEGIN CODEX MULTIMODEL MODE\n.*?# END CODEX MULTIMODEL MODE\n?/\n/s' "$CONFIG_FILE"
perl -0pi -e 's/\n?# BEGIN CODEX SCREENSHOT MODE\n.*?# END CODEX SCREENSHOT MODE\n?/\n/s' "$CONFIG_FILE"
perl -0pi -e 's/\n?# BEGIN CODEX MODEL ROUTER\n.*?# END CODEX MODEL ROUTER\n?/\n/s' "$CONFIG_FILE"

block="$(cat <<EOF
# BEGIN CODEXSWITCH
# Managed by CodexSwitch (mmctl / install.sh)
# Remove with uninstall.sh
model_provider = "codex_switch_router"
model_catalog_json = "$CATALOG_FILE"

[model_providers.codex_switch_router]
name = "CodexSwitch"
base_url = "http://127.0.0.1:$PORT/v1"
wire_api = "responses"
requires_openai_auth = true
# END CODEXSWITCH
EOF
)"
CONFIG_BLOCK="$block" perl -0pi -e '
  BEGIN { $b = $ENV{CONFIG_BLOCK}; }
  if (/\n\[/) { s/\n\[/\n\n$b\n\n[/s; } else { $_ .= "\n\n$b\n"; }
' "$CONFIG_FILE"

# ③ LaunchAgent：node 跑 router.mjs
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$ROUTER_DIR/router.mjs</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ROUTER_DIR/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$ROUTER_DIR/launchd.err.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true

sleep 1
echo "── 多模型模式已开启 ──"
echo "配置备份: $backup"
echo -n "router 健康: "; curl -s --noproxy '*' "http://127.0.0.1:$PORT/health" || echo "(未就绪，看 $ROUTER_DIR/launchd.err.log)"
echo
echo "完全退出并重启 Codex App（Cmd+Q）后，下拉菜单即可看到 GPT + 已启用的第三方模型。"
