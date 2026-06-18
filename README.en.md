# CodexSwitch

**English** · [简体中文](README.md)

![platform](https://img.shields.io/badge/platform-macOS-black)
![runtime](https://img.shields.io/badge/runtime-Node.js-green)
![menubar](https://img.shields.io/badge/menubar-SwiftBar-orange)
![license](https://img.shields.io/badge/license-MIT-blue)

> A menu-bar switch that lets the **Codex App** flip between "native GPT" and "third-party LLMs"
> in one click. GPT keeps using your ChatGPT subscription (OAuth, no API key); DeepSeek / Kimi /
> Zhipu / Qwen use their own API keys.

macOS · SwiftBar plugin · zero Swift · one-command install · one-click rollback　|　**macOS only (no Windows build yet)**

---

## What & why

> **Origin**: an OpenAI team member, Tibo (@thsottiaux), tweeted that "you can use the Codex App /
> CLI / SDK with any open source model, not just OpenAI's." But the official
> [Advanced Configuration](https://developers.openai.com/codex/config-advanced) only supports
> **OSS mode** — running **local** open models via `--oss` (Ollama / LM Studio). Smoothly plugging in a
> **hosted third-party cloud API like DeepSeek** has no official switch and still needs a little
> technique. CodexSwitch fills that gap.

By default Codex App only talks to OpenAI's own models. CodexSwitch makes the same Codex model
dropdown show GPT and third-party models side by side — without touching your ChatGPT login:

- **GPT-5.5 / 5.4 / 5.4-mini** — keep using your **ChatGPT subscription OAuth**, no `OPENAI_API_KEY`
- **DeepSeek / Kimi / Zhipu GLM / Qwen …** — use each vendor's **API key**
- One menu-bar click toggles "native GPT mode" ⇄ "multi-model mode", auto-restarts Codex, **fully reversible**

> ⚠️ **Unofficial usage**: in multi-model mode, GPT's OAuth traffic is passed through a local router to
> the ChatGPT backend, and third-party calls are adapted locally. This is a **gray area w.r.t. ToS**
> and may break with Codex updates. For learning/research only; if you're not comfortable, just use native mode.

## What it looks like

One fixed menu-bar icon; click to see current mode and actions:

```
Current mode: multi-model ✓
Switch back to native GPT (restarts Codex)
router: running :18788
──────────
Third-party vendors (check the models you want in Codex)
  DeepSeek  ✓ key
    Set / update key…
    ─────
    ✅ DeepSeek V4 Flash      ← checked = appears in Codex dropdown
    ✅ DeepSeek V4 Pro
    ▫️ DeepSeek Chat
    ▫️ DeepSeek Reasoner
  Kimi / Zhipu GLM / Qwen  (beta, enable after adding key)
──────────
Restart Codex App ／ Open .env ／ Refresh menu
```

Checked models show up in **Codex's own model dropdown**; pick flash / pro right there.

## How it works / tech stack

```
Codex App (ChatGPT OAuth login unchanged)
  config.toml marked block: model_provider = local router, requires_openai_auth = true
        │  ← this flag makes Codex forward the OAuth credential + chatgpt-account-id to the local router
        ▼
  Local router (Node, kept alive by a LaunchAgent) routes /responses by model name:
   ├─ gpt-* / codex-*       → pass through to https://chatgpt.com/backend-api/codex/responses (OAuth, no key)
   └─ deepseek* / kimi* / glm* / qwen*
                            → translate Responses → Chat Completions, call the vendor base_url with its key,
                              then wrap the result back into Responses SSE
  A catalog generator reads providers.json → decides which models appear in Codex's dropdown
```

| Layer | Tech | Job |
|---|---|---|
| Menu UI | **SwiftBar** plugin (thin shell) | Render menu-bar icon + dropdown, delegate to mmctl |
| Control core | `mmctl.mjs` (Node) | status / switch mode / set key / toggle model / restart Codex |
| Router | `router.mjs` (Node, LaunchAgent) | GPT passthrough + third-party Responses↔Chat adapter |
| Menu data | `build-catalog.mjs` + `providers.json` | Data-driven: add a vendor/model by editing JSON |
| Hook | Codex `config.toml` (marked block, removable) | `model_provider` + `requires_openai_auth` |
| Daemon | macOS `launchctl` (LaunchAgent) | Keep the local router alive |

**Key point: pure Node + shell, zero Swift, zero notarization.** The menu-bar experience is hosted by
SwiftBar (free, notarized).

## Design principles: modular & minimally invasive (honest self-review)

**Modular — mostly achieved.** Four layers talk via files/CLI: SwiftBar plugin (UI, ~15-line shell that
only calls `mmctl menu`) → `mmctl` (control) → `router` (routing) + `providers.json`/`.env` (data) +
`install/uninstall` (config injection). Swap SwiftBar for a web UI without touching the router; add a
vendor by editing JSON, no code change.
　Honest coupling: GPT passthrough depends on Codex's private ChatGPT backend protocol and the
`requires_openai_auth` behavior; mode-switch depends on the `config.toml` format — these are **external
dependencies on Codex** and may shift across versions.

**Minimally invasive — at the config layer, with an honest caveat.** The only change to Codex is one
marked block in `config.toml` (removable with one command); it doesn't modify the Codex binary, doesn't
touch `auth.json`, doesn't alter your other settings. **Native mode = zero touch.**
　Honestly: **in multi-model mode all Codex traffic (including GPT) goes through the local router** — so
it's "fully reversible" rather than "zero-touch at runtime." If that bothers you, stay on native and
switch only when you need a third-party model.

## Prerequisites

1. **Codex** already logged in with a ChatGPT account (this tool never touches login; Codex manages token refresh)
2. **Node.js** — https://nodejs.org or `brew install node`
3. **SwiftBar** — `brew install --cask swiftbar` or download from https://github.com/swiftbar/SwiftBar/releases (notarized)

## Install

```bash
git clone https://github.com/huasanai/codex-switch.git codex-switch
cd codex-switch             # enter the folder cloned in the line above (relative path; it's right here)
bash setup.command          # ← most robust: no exec bit needed, not blocked by Gatekeeper
```

`setup.command` will: detect Node → deploy runtime files to `~/.codex/codex-switch/` → install the
plugin into your SwiftBar plugin folder (auto-presets it on the non-sandboxed build) → launch SwiftBar.

> **Why `bash setup.command` instead of double-click?** Downloaded `.command` files often (1) lose the
> exec bit (double-click → "could not be executed … access privileges") and (2) carry a quarantine flag
> blocked by Gatekeeper. `bash <file>` sidesteps both.

## Usage

1. Click the CodexSwitch icon in the menu bar
2. Click "Set key…" for a vendor (system dialog; stored locally in `~/.codex/codex-switch/.env`, mode 600)
3. In that vendor's submenu, check the models you want (e.g. DeepSeek V4 Flash / V4 Pro)
4. Click "Switch to multi-model mode" → Codex auto-restarts → pick the model in Codex's dropdown
5. To go back to official native: click "Switch back to native GPT"

> After toggling models / editing vendors, click "Restart Codex App" so Codex re-reads the model list.

## Multiple models per vendor & adding a vendor

Edit `~/.codex/codex-switch/providers.json`. Add a model = one more entry under `models`; add a vendor =
one more provider object:

```json
{ "id":"deepseek", "label":"DeepSeek", "base_url":"https://api.deepseek.com",
  "env_key":"DEEPSEEK_API_KEY", "match_prefix":"deepseek", "verified":true,
  "models":[
    { "slug":"deepseek-v4-flash", "display_name":"DeepSeek V4 Flash", "enabled":true },
    { "slug":"deepseek-v4-pro",   "display_name":"DeepSeek V4 Pro",   "enabled":false }
  ] }
```

`slug` must be the vendor API's **real model name**. The router dispatches by `match_prefix`; menu and
catalog pick it up automatically, no code change. **Always `curl`-verify a new vendor's `base_url + model`
before relying on it.**

## CLI (if you don't want the menu)

```bash
cd ~/.codex/codex-switch
node mmctl.mjs status                          # current mode / vendors / per-model checked state
node mmctl.mjs set-key deepseek sk-xxx         # set key (also supports - to read from stdin)
node mmctl.mjs toggle-model deepseek deepseek-v4-pro on   # check/uncheck a model
node mmctl.mjs switch multimodel|native        # switch mode + auto-restart Codex
```

## ⚠️ Important: after switching modes Codex shows no past chats — don't panic, nothing is lost

Codex App's sidebar **groups conversations by the active provider**. After switching to multi-model mode,
the history from native GPT is **filtered out** and the sidebar looks "empty."

**It is not deleted.** Chats live locally (`~/.codex/state_*.sqlite` threads table + `~/.codex/sessions/`
transcripts). **Switch back to native GPT and the history reappears instantly.** Think of it as: each
provider has its own conversation list, like separate workspaces.

## Known limitations

- Third-party models go through a Chat Completions adapter — fine for Q&A and light coding, but **complex
  agentic tool chains are not equivalent to native GPT**.
- After editing `providers.json` (toggles / new vendors) you must **restart Codex App** (the catalog is read at startup).
- Of the presets, only **DeepSeek is tested**; Kimi / Zhipu / Qwen ship disabled and marked beta — verify yourself.
- The menu reads the live `config.toml`, so it always reflects the true current mode (menu or manual switch).
- The local router defaults to port **18788** (`.env` is the single source of truth). If it's taken, the
  router won't start (menu shows "router not running"); change `CODEX_ROUTER_PORT` in
  `~/.codex/codex-switch/.env` and re-run `install.sh`.

## Uninstall

```bash
~/.codex/codex-switch/uninstall.sh    # turn off multi-model, restore native (then Cmd+Q to restart Codex)
# full removal: delete ~/.codex/codex-switch/ and codexswitch.1m.sh from your SwiftBar plugin folder
```

## Contact

- WeChat: `huasanai`
- X: [@yfusionai](https://x.com/yfusionai)

## License

MIT © huasan
