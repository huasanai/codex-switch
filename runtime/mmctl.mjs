#!/usr/bin/env node
// mmctl —— 多模型模式控制内核（宿主无关）。SwiftBar 插件、终端、未来的网页 UI 都调它。
// 命令：
//   status                      当前模式 / router 健康 / 各厂商(含每个模型 enabled) / hasKey（JSON）
//   menu                        输出 SwiftBar 菜单文本
//   switch native|multimodel    切模式 + 自动重启 Codex（一键生效）
//   mode   native|multimodel    只切模式，不重启
//   set-key <id> [key|-]        写厂商 key 到 .env（- 从 stdin 读），并自动启用该厂商第一个模型
//   set-key-dialog <id>         弹 osascript 对话框输入 key（供菜单点击）
//   toggle-model <id> <slug> [on|off]   启用/停用某个具体模型，并重建 catalog
//   restart-codex               退出并重开 Codex App
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NODE = process.execPath;
const MMCTL = fileURLToPath(import.meta.url);
const ROUTER_DIR = path.dirname(MMCTL);
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const CONFIG = path.join(CODEX_HOME, "config.toml");
const CATALOG = path.join(CODEX_HOME, "model-catalogs", "codexswitch-models.json");
const ENV_FILE = path.join(ROUTER_DIR, ".env");
const PROVIDERS_FILE = path.join(ROUTER_DIR, "providers.json");
const PATH_EXTRA = "/opt/homebrew/bin:/usr/local/bin:/Applications/Codex.app/Contents/Resources:/usr/bin:/bin";
const PORT = Number(readEnv().CODEX_ROUTER_PORT || 18788);

const [cmd, ...args] = process.argv.slice(2);

const handlers = {
  status: () => process.stdout.write(JSON.stringify(getStatus(), null, 2) + "\n"),
  menu: printMenu,
  switch: () => { setMode(args[0]); restartCodex(); },
  mode: () => setMode(args[0]),
  "set-key": () => setKey(args[0], args[1]),
  "set-key-dialog": () => setKeyDialog(args[0]),
  "toggle-model": () => toggleModel(args[0], args[1], args[2]),
  "restart-codex": restartCodex,
};

if (!handlers[cmd]) {
  console.error(`未知命令: ${cmd || "(空)"}\n可用: ${Object.keys(handlers).join(" / ")}`);
  process.exit(1);
}
try { handlers[cmd](); } catch (e) { console.error(`mmctl ${cmd} 失败: ${e.message}`); process.exit(1); }

// ── 状态 ──────────────────────────────────────────────────────────────
function getStatus() {
  const mode = isMultimodelInstalled() ? "multimodel" : "native";
  const env = readEnv();
  const providers = readProviders().map((p) => ({
    id: p.id, label: p.label, verified: !!p.verified,
    hasKey: !!(env[p.env_key] && env[p.env_key].trim()),
    models: (p.models || []).map((m) => ({ slug: m.slug, display_name: m.display_name || m.slug, enabled: !!m.enabled })),
  }));
  return { mode, port: PORT, routerHealthy: routerHealthy(), providers };
}
function isMultimodelInstalled() {
  try { return fs.readFileSync(CONFIG, "utf8").includes("# BEGIN CODEXSWITCH"); } catch { return false; }
}
function routerHealthy() {
  try {
    const out = execFileSync("curl", ["-s", "--max-time", "2", "--noproxy", "*", `http://127.0.0.1:${PORT}/health`], { encoding: "utf8" });
    return out.includes('"ok":true');
  } catch { return false; }
}

// ── 切模式 ────────────────────────────────────────────────────────────
function setMode(mode) {
  if (mode === "multimodel") runScript("install.sh");
  else if (mode === "native") runScript("uninstall.sh");
  else throw new Error("mode 只能是 native 或 multimodel");
}
function restartCodex() {
  try { execFileSync("osascript", ["-e", 'tell application "Codex" to quit'], { stdio: "ignore" }); } catch {}
  execFileSync("sleep", ["1.5"]);
  try { execFileSync("open", ["-a", "Codex"]); } catch (e) { console.error(`重开 Codex 失败: ${e.message}`); }
}

// ── key 管理 ──────────────────────────────────────────────────────────
function setKey(id, keyArg) {
  const p = readProviders().find((x) => x.id === id);
  if (!p) throw new Error(`未知厂商: ${id}`);
  let key = keyArg;
  if (!key || key === "-") key = fs.readFileSync(0, "utf8").trim();
  key = (key || "").trim();
  if (!key) throw new Error("key 为空");
  upsertEnv(p.env_key, key);
  enableFirstModelIfNone(id);
  rebuildCatalog();
  console.log(`已保存 ${p.label} 的 key。`);
}
function setKeyDialog(id) {
  const p = readProviders().find((x) => x.id === id);
  if (!p) throw new Error(`未知厂商: ${id}`);
  const script = `display dialog "输入 ${p.label} 的 API Key：" default answer "" with hidden answer buttons {"取消","保存"} default button "保存"`;
  let out;
  try { out = execFileSync("osascript", ["-e", script], { encoding: "utf8" }); }
  catch { return; }
  const m = out.match(/text returned:(.*)$/);
  const key = m ? m[1].trim() : "";
  if (!key) return;
  upsertEnv(p.env_key, key);
  enableFirstModelIfNone(id);
  rebuildCatalog();
  notify(`${p.label} key 已保存`, "已自动启用一个模型，重启 Codex 后可在下拉菜单选用。");
}

// ── 模型启用/停用（per-model）─────────────────────────────────────────
function toggleModel(id, slug, onoff) {
  const data = JSON.parse(fs.readFileSync(PROVIDERS_FILE, "utf8"));
  const p = (data.providers || []).find((x) => x.id === id);
  if (!p) throw new Error(`未知厂商: ${id}`);
  const m = (p.models || []).find((x) => x.slug === slug);
  if (!m) throw new Error(`厂商 ${id} 下未知模型: ${slug}`);
  m.enabled = onoff === "on" ? true : onoff === "off" ? false : !m.enabled;
  fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(data, null, 2) + "\n");
  rebuildCatalog();
  console.log(`${p.label} / ${m.display_name || slug} 已${m.enabled ? "启用" : "停用"}。`);
}
function enableFirstModelIfNone(id) {
  const data = JSON.parse(fs.readFileSync(PROVIDERS_FILE, "utf8"));
  const p = (data.providers || []).find((x) => x.id === id);
  if (!p || !(p.models || []).length) return;
  if (!p.models.some((m) => m.enabled)) {
    p.models[0].enabled = true;
    fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(data, null, 2) + "\n");
  }
}
function rebuildCatalog() {
  fs.mkdirSync(path.dirname(CATALOG), { recursive: true });
  runNode("build-catalog.mjs", [CATALOG]);
}

// ── SwiftBar 菜单 ─────────────────────────────────────────────────────
function printMenu() {
  const s = getStatus();
  const L = [];
  // 菜单栏标题：固定图标。SwiftBar 菜单栏图标按模板图渲染，颜色不生效，故不按模式变色（模式见下方文字）。
  L.push("| sfimage=arrow.triangle.2.circlepath");
  L.push("---");
  L.push(`当前模式：${s.mode === "multimodel" ? "多模型 ✓" : "GPT 原生 ✓"} | color=gray`);
  if (s.mode === "multimodel") {
    L.push(item("切回 GPT 原生模式（会重启 Codex）", ["switch", "native"]));
  } else {
    L.push(item("切到多模型模式（会重启 Codex）", ["switch", "multimodel"]));
  }
  L.push(`router：${s.routerHealthy ? `运行中 :${s.port}` : "未运行 ⚠️"} | color=${s.routerHealthy ? "gray" : "red"}`);
  L.push("---");
  L.push("第三方厂商（勾选要在 Codex 里出现的模型）| color=gray");
  for (const p of s.providers) {
    const tag = p.hasKey ? "✓ key" : "未配置 key";
    const beta = p.verified ? "" : "（beta）";
    L.push(`${p.label}  ${tag}${beta}`);
    L.push(`--设置 / 更新 key… | ${itemArgs(["set-key-dialog", p.id])}`);
    L.push("-----");
    for (const m of p.models) {
      const mark = m.enabled ? "✅" : "▫️";
      L.push(`--${mark} ${m.display_name} | ${itemArgs(["toggle-model", p.id, m.slug, m.enabled ? "off" : "on"])}`);
    }
  }
  L.push("---");
  L.push("改完模型/厂商后，点这里让 Codex 生效： | color=gray");
  L.push(item("重启 Codex App", ["restart-codex"]));
  L.push(`打开 .env | bash="open" param0="${ENV_FILE}" terminal=false`);
  L.push("刷新菜单 | refresh=true");
  process.stdout.write(L.join("\n") + "\n");
}
// 生成一个点击执行 `node mmctl.mjs <args...>` 的 SwiftBar 行参数
function itemArgs(argv) {
  const params = argv.map((a, i) => `param${i + 1}="${a}"`).join(" ");
  return `bash="${NODE}" param0="${MMCTL}" ${params} terminal=false refresh=true`;
}
function item(title, argv) { return `${title} | ${itemArgs(argv)}`; }

// ── 工具函数 ──────────────────────────────────────────────────────────
function readProviders() {
  try { return JSON.parse(fs.readFileSync(PROVIDERS_FILE, "utf8")).providers || []; } catch { return []; }
}
function readEnv() {
  const env = {};
  try {
    for (const raw of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {}
  return env;
}
function upsertEnv(key, value) {
  let lines = [];
  try { lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/); } catch {}
  let found = false;
  lines = lines.map((l) => {
    if (new RegExp(`^${key}=`).test(l.trim())) { found = true; return `${key}=${value}`; }
    return l;
  });
  if (!found) lines.push(`${key}=${value}`);
  fs.writeFileSync(ENV_FILE, lines.join("\n").replace(/\n+$/, "\n"));
  fs.chmodSync(ENV_FILE, 0o600);
}
function runScript(name) {
  execFileSync(path.join(ROUTER_DIR, name), [], {
    stdio: "inherit", env: { ...process.env, PATH: `${process.env.PATH || ""}:${PATH_EXTRA}` },
  });
}
function runNode(script, scriptArgs) {
  execFileSync(NODE, [path.join(ROUTER_DIR, script), ...scriptArgs], {
    stdio: "inherit", env: { ...process.env, PATH: `${process.env.PATH || ""}:${PATH_EXTRA}` },
  });
}
function notify(title, msg) {
  try { execFileSync("osascript", ["-e", `display notification "${msg}" with title "${title}"`], { stdio: "ignore" }); } catch {}
}
