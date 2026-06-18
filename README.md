# CodexSwitch

[English](README.en.md) · **简体中文**

![platform](https://img.shields.io/badge/platform-macOS-black)
![runtime](https://img.shields.io/badge/runtime-Node.js-green)
![menubar](https://img.shields.io/badge/menubar-SwiftBar-orange)
![license](https://img.shields.io/badge/license-MIT-blue)

> 菜单栏一键，让 **Codex App** 在「GPT 原生」与「多家第三方大模型」之间自由切换。
> GPT 继续走你的 ChatGPT 订阅（OAuth，免 API key），DeepSeek / Kimi / 智谱 / 通义 等走各自 API key。

macOS · SwiftBar 插件 · 零 Swift · 一键安装 · 可一键回退　|　**目前仅支持 macOS（Windows 版未开发）**

---

## 这是什么 / 解决什么问题

> **起因**：OpenAI 团队成员 Tibo（@thsottiaux）发推说 "Codex App / CLI / SDK 可以用任何开源模型，
> 不止 OpenAI 自家的"。但翻开官方 [Advanced Configuration](https://developers.openai.com/codex/config-advanced)
> 会发现：官方支持的是 **OSS mode**——通过 `--oss` 跑**本地**开源模型（Ollama / LM Studio）。
> 想丝滑接入像 **DeepSeek 这类托管的第三方云 API**，官方并没有现成开关，仍需要一点技术手段。
> CodexSwitch 正是来补这块。

Codex App 默认只能用 OpenAI 自家模型。CodexSwitch 在不破坏你 ChatGPT 登录态的前提下，让同一个 Codex
下拉菜单里同时出现 GPT 和第三方模型：

- **GPT-5.5 / 5.4 / 5.4-mini** —— 继续走 **ChatGPT 订阅 OAuth**，不需要 `OPENAI_API_KEY`
- **DeepSeek / Kimi / 智谱 GLM / 通义 Qwen …** —— 走各自的 **API key**
- 菜单栏图标一键在「GPT 原生模式」「多模型模式」间切换，自动重启 Codex 生效，**随时可回退**

> ⚠️ **这是非官方用法**：多模型模式下，GPT 的 OAuth 流量会经一个本地 router 原样转发到 ChatGPT 后端，
> DeepSeek 等经本地适配。属 **ToS 灰区**，可能随 Codex 版本更新失效。仅供学习研究，介意者只用原生模式即可。

## 效果

菜单栏一个固定图标，点开见当前模式与操作菜单：

```
当前模式：多模型 ✓
切回 GPT 原生模式（会重启 Codex）
router：运行中 :18788
──────────
第三方厂商（勾选要在 Codex 里出现的模型）
  DeepSeek  ✓ key
    设置 / 更新 key…
    ─────
    ✅ DeepSeek V4 Flash      ← 勾选 = 出现在 Codex 下拉菜单
    ✅ DeepSeek V4 Pro
    ▫️ DeepSeek Chat
    ▫️ DeepSeek Reasoner
  Kimi / 智谱 GLM / 通义 Qwen  （beta，填 key 后启用）
──────────
重启 Codex App ／ 打开 .env ／ 刷新菜单
```

勾上的模型出现在 **Codex 自己的模型下拉菜单**里，你在 Codex 里直接选 flash / pro。

## 工作原理 / 技术框架

```
Codex App（ChatGPT OAuth 登录不变）
  config.toml 标记块：model_provider = 本地 router，requires_openai_auth = true
        │  ← 这个开关让 Codex 把 OAuth 凭证 + chatgpt-account-id 一起转发给本地 router
        ▼
  本地 router（Node，常驻 LaunchAgent）按 model 名分流 /responses：
   ├─ gpt-* / codex-*       → 原样透传 https://chatgpt.com/backend-api/codex/responses（OAuth，免 key）
   └─ deepseek* / kimi* / glm* / qwen*
                            → Responses(响应式) 请求翻译成 Chat Completions(对话补全)，
                              带各自 key 调厂商 base_url，再封装回 Responses SSE
  catalog 生成器读 providers.json → 决定 Codex 下拉菜单里出现哪些模型
```

| 层 | 技术 | 职责 |
|---|---|---|
| 菜单 UI | **SwiftBar** 插件（薄壳 shell） | 渲染菜单栏图标 + 下拉，全权委托 mmctl |
| 控制内核 | `mmctl.mjs`（Node） | status / 切模式 / 设 key / 勾模型 / 重启 Codex |
| 路由 | `router.mjs`（Node，LaunchAgent 常驻） | GPT 透传 + 第三方 Responses↔Chat 适配 |
| 菜单数据 | `build-catalog.mjs` + `providers.json` | 数据驱动：加厂商/模型只改 JSON |
| 接入点 | Codex `config.toml`（标记块，可一键删） | `model_provider` + `requires_openai_auth` |
| 常驻 | macOS `launchctl`（LaunchAgent） | 保活本地 router |

**关键：纯 Node + shell，零 Swift、零签名公证。** 菜单栏体验借 SwiftBar（免费、已公证）这个宿主实现。

## 设计原则：模块化解耦 + 最小侵入（诚实自评）

**模块化解耦 —— 基本做到。** 四层各司其职、靠文件/CLI 通信：SwiftBar 插件（UI，十几行薄壳，只调
`mmctl menu`）→ `mmctl`（控制内核）→ `router`（路由）+ `providers.json`/`.env`（数据）+
`install/uninstall`（配置注入）。换掉 SwiftBar 改用网页 UI 不必动 router；加一家厂商只改 JSON、不动代码。
　诚实的耦合点：GPT 透传依赖 Codex 私有的 ChatGPT 后端协议与 `requires_openai_auth` 行为，切模式依赖
Codex `config.toml` 的格式——这些是对 Codex 的**外部依赖**，会随其版本变化。

**最小侵入 —— 配置层做到，运行层如实说明。** 对 Codex 的改动只有 `config.toml` 里一个带标记的块
（一条命令可精确移除），不改 Codex 程序、不碰登录态 `auth.json`、不动你其它配置；**原生模式 = 零接触**。
　诚实地讲：**多模型模式下，所有 Codex 流量（含 GPT）会经过本地 router 这一跳**——所以它是"完全可逆"
而非"运行时零接触"。介意的人平时用原生模式，要第三方时再切。

## 前置条件

1. **Codex** 已用 ChatGPT 账号登录（本工具不碰登录，Codex 自己管 token 刷新）
2. **Node.js** —— https://nodejs.org 或 `brew install node`
3. **SwiftBar** —— `brew install --cask swiftbar` 或下载 https://github.com/swiftbar/SwiftBar/releases （已公证）

## 安装

```bash
git clone <this-repo> codex-switch
cd codex-switch             # 进入上一行 clone 出来的文件夹（相对路径，它就在你当前目录下）
bash setup.command          # ← 最稳：不需要执行权限、不会被 Gatekeeper 拦
```

`setup.command` 会：检测 Node → 部署运行文件到 `~/.codex/codex-switch/` → 把插件装进 SwiftBar 插件目录
（非沙盒版会自动预设目录）→ 启动 SwiftBar。完成后菜单栏出现图标。

> **为什么用 `bash setup.command` 而不是双击？** 下载来的 `.command` 常①丢可执行位（双击报
> "could not be executed … access privileges"）②带隔离标记被 Gatekeeper 拦。`bash 文件` 两个都绕开。

## 使用

1. 菜单栏点 CodexSwitch 图标
2. 给想用的厂商点「设置 key…」（弹系统输入框，存到本机 `~/.codex/codex-switch/.env`，权限 600）
3. 在该厂商子菜单里勾选要用的模型（如 DeepSeek V4 Flash / V4 Pro）
4. 点「切到多模型模式」→ 自动重启 Codex → 在 Codex 下拉菜单里选模型
5. 想回官方原生：点「切回 GPT 原生模式」

> 勾选模型 / 改厂商后，点菜单底部「重启 Codex App」让 Codex 重新读取模型列表。

## 同厂商多模型 & 加新厂商

编辑 `~/.codex/codex-switch/providers.json`。同一家加模型 = 往 `models` 加一条；加一家 = 加一个 provider：

```json
{ "id":"deepseek", "label":"DeepSeek", "base_url":"https://api.deepseek.com",
  "env_key":"DEEPSEEK_API_KEY", "match_prefix":"deepseek", "verified":true,
  "models":[
    { "slug":"deepseek-v4-flash", "display_name":"DeepSeek V4 Flash", "enabled":true },
    { "slug":"deepseek-v4-pro",   "display_name":"DeepSeek V4 Pro",   "enabled":false }
  ] }
```

`slug` 必须是该厂商 API 的**真实模型名**。router 按 `match_prefix` 分发，菜单/catalog 自动认到，无需改代码。
**新厂商上线前请先 `curl` 实测 `base_url + 模型名`。**

## 命令行（不想用菜单也行）

```bash
cd ~/.codex/codex-switch
node mmctl.mjs status                          # 当前模式 / 各厂商 / 各模型勾选状态
node mmctl.mjs set-key deepseek sk-xxx         # 设 key（也支持 - 从 stdin 读）
node mmctl.mjs toggle-model deepseek deepseek-v4-pro on   # 勾选/取消某个模型
node mmctl.mjs switch multimodel|native        # 切模式 + 自动重启 Codex
```

## ⚠️ 重要：切换模式后，Codex 里看不到之前的聊天记录——别慌，没丢

Codex App 的侧边栏**按当前 provider 分组显示对话**。切到多模型模式后，原来 GPT 原生下的历史会被
**过滤隐藏**，侧边栏看起来"清空了"。

**这不是删除。** 聊天记录都在本地（`~/.codex/state_*.sqlite` 的 threads 表 + `~/.codex/sessions/` 的转录），
**切回 GPT 原生模式，历史立刻全部回来**。可以理解成：每个 provider 有各自独立的对话列表，像不同 workspace。

## 已知限制

- 第三方模型经 Chat Completions 适配，适合普通问答和轻量编码，**复杂 agentic 工具链不等价于原生 GPT**。
- 改 `providers.json`（勾选/加厂商）后需**重启 Codex App** 才在下拉菜单生效（catalog 是 startup-only）。
- 预设厂商里只有 **DeepSeek 已实测**；Kimi / 智谱 / 通义默认未启用、标 beta，自行验证后再用。
- 菜单状态读实时 `config.toml`，所以无论用菜单还是手动切换，菜单都如实反映当前模式。
- 本地 router 默认端口 **18788**（`.env` 是唯一真相源）。若被其它程序占用，router 起不来（菜单显示
  "router 未运行"）；改 `~/.codex/codex-switch/.env` 里的 `CODEX_ROUTER_PORT` 后重跑 `install.sh` 即可。

## 卸载

```bash
~/.codex/codex-switch/uninstall.sh    # 关多模型、恢复原生（然后 Cmd+Q 重启 Codex）
# 彻底删除：删 ~/.codex/codex-switch/ 和 SwiftBar 插件目录里的 codexswitch.1m.sh
```

## 目录结构

```
codex-switch/
├── setup.command          自举安装
├── providers.json         厂商/模型注册表（数据驱动）
├── runtime/  (→ ~/.codex/codex-switch/)
│   ├── router.mjs         本地 router（GPT 透传 + 第三方适配）
│   ├── build-catalog.mjs  读 providers.json 生成 Codex catalog
│   ├── mmctl.mjs          控制内核（菜单/CLI 都调它）
│   ├── install.sh         开多模型（注入 config + LaunchAgent）
│   └── uninstall.sh       关多模型（恢复原生）
└── plugin/codexswitch.1m.sh   SwiftBar 插件（薄壳）
```

## 交流

有问题或想法，欢迎找我：

- 微信：`huasanai`
- X：[@yfusionai](https://x.com/yfusionai)
- 抖音：[@画伞](https://v.douyin.com/zHu4VUhztes/)

## License

MIT © 画伞 (huasan)
