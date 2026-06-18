#!/usr/bin/env bash
# <xbar.title>Codex 多模型切换</xbar.title>
# <xbar.version>v1.0</xbar.version>
# <xbar.author>codex-switch</xbar.author>
# <xbar.desc>菜单栏一键切换 Codex 的 GPT 原生 / 多模型模式，管理第三方 API key。</xbar.desc>
# <swiftbar.runInBash>true</swiftbar.runInBash>
#
# SwiftBar 插件（薄壳）：找到 node，把菜单渲染全权交给 mmctl。
# 放进 SwiftBar 插件目录即可。文件名里的 1m = 每分钟刷新一次菜单栏标题。

ROUTER_DIR="$HOME/.codex/codex-switch"
MMCTL="$ROUTER_DIR/mmctl.mjs"

NODE=""
for c in /opt/homebrew/bin/node /usr/local/bin/node \
         /Applications/Codex.app/Contents/Resources/cua_node/bin/node \
         "$(command -v node 2>/dev/null || true)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then NODE="$c"; break; fi
done

if [ -z "$NODE" ]; then
  echo "Codex⚠️"; echo "---"; echo "未找到 Node.js | color=red"; echo "请先安装 Node.js（https://nodejs.org）"
  exit 0
fi
if [ ! -f "$MMCTL" ]; then
  echo "Codex⚠️"; echo "---"; echo "CodexSwitch未安装 | color=red"; echo "运行 codex-switch/setup.command"
  exit 0
fi

"$NODE" "$MMCTL" menu
