#!/usr/bin/env node
// 读 providers.json，生成 Codex 下拉菜单用的 model catalog：
//   - GPT 三件套（gpt-5.5 / gpt-5.4 / gpt-5.4-mini）从 Codex 内置 catalog 原样复制（保 OAuth 可用）
//   - 每个 enabled 厂商的每个 model → 用 gpt-5.4-mini 模板克隆一份，改 slug/display_name
// 用法：build-catalog.mjs /absolute/path/to/codexswitch-models.json
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = process.argv[2];
if (!outputPath) {
  console.error("用法: build-catalog.mjs /absolute/path/codexswitch-models.json");
  process.exit(1);
}

const PROVIDERS_FILE = path.join(__dirname, "providers.json");
const providers = (() => {
  try { return JSON.parse(fs.readFileSync(PROVIDERS_FILE, "utf8")).providers || []; }
  catch (e) { console.error(`providers.json 读取失败: ${e.message}`); process.exit(1); }
})();

// 取 Codex 内置 catalog（用临时 CODEX_HOME 避免被当前 model_catalog_json 覆盖影响）
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "mm-catalog-"));
let bundled;
try {
  bundled = JSON.parse(execFileSync("codex", ["debug", "models"], {
    encoding: "utf8", maxBuffer: 100 * 1024 * 1024,
    env: { ...process.env, CODEX_HOME: tempHome },
  }));
} finally {
  fs.rmSync(tempHome, { recursive: true, force: true });
}

const GPT_SLUGS = new Set(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]);
const models = bundled.models.filter((m) => GPT_SLUGS.has(m.slug)); // GPT 原样保留
const template = structuredClone(bundled.models.find((m) => m.slug === "gpt-5.4-mini") || bundled.models[0]);

let priority = 30;
for (const p of providers) {
  for (const model of p.models || []) {
    if (!model.enabled) continue;
    const entry = structuredClone(template);
    entry.slug = model.slug;
    entry.display_name = model.display_name || model.slug;
    entry.description = `${p.label} routed through the local multi-model router.`;
    entry.default_reasoning_level = "medium";
    entry.supported_reasoning_levels = [
      { effort: "low", description: "Fast responses" },
      { effort: "medium", description: "Balanced responses" },
      { effort: "high", description: "Deeper reasoning" },
    ];
    entry.priority = priority++;
    entry.additional_speed_tiers = [];
    entry.service_tiers = [];
    entry.availability_nux = null;
    entry.upgrade = null;
    models.push(entry);
  }
}

fs.writeFileSync(outputPath, JSON.stringify({ models }, null, 2) + "\n");
console.log(`已写入 ${models.length} 个模型 → ${outputPath}`);
