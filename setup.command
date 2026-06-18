#!/usr/bin/env bash
# 双击或 `bash setup.command` 运行：部署CodexSwitch + 装好 SwiftBar 插件 + 启动 SwiftBar。可重复运行（幂等）。
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DST="$HOME/.codex/codex-switch"
FALLBACK_PLUGIN_DIR="$HOME/.codex/swiftbar-plugins"

echo "════════════════════════════════════"
echo "  CodexSwitch · 安装"
echo "════════════════════════════════════"

# 1) Node
NODE=""
for c in /opt/homebrew/bin/node /usr/local/bin/node \
         /Applications/Codex.app/Contents/Resources/cua_node/bin/node \
         "$(command -v node 2>/dev/null || true)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then NODE="$c"; break; fi
done
if [ -z "$NODE" ]; then
  echo "✗ 未找到 Node.js。请先安装 https://nodejs.org（或 brew install node）后重跑本脚本。"
  read -r -p "按回车关闭…" _; exit 1
fi
echo "✓ Node: $NODE"

# 2) 部署运行文件（保留已有 .env 和 providers.json，避免覆盖你的 key 与开关）
mkdir -p "$DST"
cp "$HERE"/runtime/*.mjs "$HERE"/runtime/*.sh "$DST"/
chmod +x "$DST"/*.sh "$DST"/*.mjs
if [ ! -f "$DST/providers.json" ]; then cp "$HERE/providers.json" "$DST/providers.json"; fi
if [ ! -f "$DST/.env" ]; then
  umask 077
  printf '# CodexSwitch secrets，勿提交。\nCODEX_ROUTER_HOST=127.0.0.1\nCODEX_ROUTER_PORT=18788\n' > "$DST/.env"
fi
chmod 600 "$DST/.env" 2>/dev/null || true
echo "✓ 运行文件已部署 → $DST"

# 3) 检测 SwiftBar 是否安装、是否沙盒版
SWIFTBAR_APP=""
[ -d "/Applications/SwiftBar.app" ] && SWIFTBAR_APP="/Applications/SwiftBar.app"
[ -z "$SWIFTBAR_APP" ] && SWIFTBAR_APP="$(mdfind "kMDItemCFBundleIdentifier == 'com.ameba.SwiftBar'" 2>/dev/null | head -1)"
SANDBOXED="no"; [ -d "$HOME/Library/Containers/com.ameba.SwiftBar" ] && SANDBOXED="yes"

if [ -z "$SWIFTBAR_APP" ]; then
  echo "! 未检测到 SwiftBar。请先安装后重跑本脚本："
  echo "    brew install --cask swiftbar"
  echo "    或下载 https://github.com/swiftbar/SwiftBar/releases （已公证，可直接打开）"
  read -r -p "按回车关闭…" _; exit 0
fi
echo "✓ SwiftBar: $SWIFTBAR_APP"

# 4) 确定插件目录：已设且存在就用它；否则用 fallback，非沙盒版顺便帮你预设好（省去手动选目录）
PLUGIN_DIR="$(defaults read com.ameba.SwiftBar PluginDirectory 2>/dev/null || true)"
if [ -z "$PLUGIN_DIR" ] || [ ! -d "$PLUGIN_DIR" ]; then
  PLUGIN_DIR="$FALLBACK_PLUGIN_DIR"
  mkdir -p "$PLUGIN_DIR"
  if [ "$SANDBOXED" = "no" ]; then
    defaults write com.ameba.SwiftBar PluginDirectory -string "$PLUGIN_DIR"
    echo "✓ 已自动把 SwiftBar 插件目录设为 $PLUGIN_DIR"
  fi
fi
cp "$HERE"/plugin/codexswitch.1m.sh "$PLUGIN_DIR"/
chmod +x "$PLUGIN_DIR"/codexswitch.1m.sh
echo "✓ 插件已装入 $PLUGIN_DIR"

# 5) 启动 / 刷新 SwiftBar
open -a SwiftBar
sleep 2
echo "✓ 已启动 SwiftBar"

echo
echo "════════════════════════════════════"
echo "  完成！看菜单栏右上角的「多模型 / GPT原生」图标，点它即可："
echo "    · 给厂商「设置 key…」      · 一键「切到多模型 / 切回原生」（会自动重启 Codex）"
if [ "$SANDBOXED" = "yes" ]; then
  echo
  echo "  ⚠️ 你的 SwiftBar 是沙盒版：若菜单栏没图标，打开 SwiftBar 偏好设置，"
  echo "     把 Plugin Folder 选成： $PLUGIN_DIR  （选择框里按 ⌘⇧G 可直接输入路径）"
fi
echo "════════════════════════════════════"
read -r -p "按回车关闭…" _
