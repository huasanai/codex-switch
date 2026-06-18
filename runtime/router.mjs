#!/usr/bin/env node
// Codex 多模型 router（数据驱动版）—— 一个本地 provider，把 /responses 按 model 名分流：
//
//   gpt-* / codex-*  → 透传到 ChatGPT OAuth 后端 https://chatgpt.com/backend-api/codex/responses
//                      用 Codex 转发来的 Authorization(OAuth) + chatgpt-account-id，不需要 OPENAI_API_KEY
//   其余             → 读 providers.json 按 match_prefix 命中厂商，把 Responses 翻译成 Chat Completions，
//                      带该厂商 .env 里的 key 调 base_url，再封装回 Responses SSE
//
// 加一家厂商只需改 providers.json，无需动本文件。日志只记 model/route/status/ms，绝不记 key/token。

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, ".env"));

const HOST = process.env.CODEX_ROUTER_HOST || "127.0.0.1";
const PORT = Number(process.env.CODEX_ROUTER_PORT || 18788);
const CHATGPT_RESPONSES = "https://chatgpt.com/backend-api/codex/responses";
const logPath = path.join(__dirname, "router.log");
const PROVIDERS_FILE = path.join(__dirname, "providers.json");

// ── 从 providers.json 构建路由表（GPT 是恒在特例，排第一）──────────────
function buildRoutes() {
  loadEnv(path.join(__dirname, ".env")); // 每次重读 .env，set-key 后无需重启 router
  const routes = [
    { id: "chatgpt-oauth", kind: "passthrough", match: (m) => m.startsWith("gpt-") || m.startsWith("codex-") },
  ];
  try {
    const cfg = JSON.parse(fs.readFileSync(PROVIDERS_FILE, "utf8"));
    for (const p of cfg.providers || []) {
      const prefix = p.match_prefix || p.id;
      routes.push({
        id: p.id,
        kind: "chat",
        match: (m) => m.startsWith(prefix),
        baseUrl: p.base_url,
        apiKey: process.env[p.env_key] || "",
      });
    }
  } catch (e) {
    console.error(`providers.json 读取失败: ${e.message}`);
  }
  return routes;
}
let ROUTES = buildRoutes();
const routeFor = (model) => ROUTES.find((r) => r.match(model));

// ── ChatGPT 分支：把 Codex 的 /responses 原样转给 OAuth 后端 ───────────
async function passThroughToChatGPT(req, res, rawBody) {
  const authorization = req.headers["authorization"] || `Bearer ${authFromDisk().accessToken}`;
  const accountId = req.headers["chatgpt-account-id"] || authFromDisk().accountId;
  const headers = {
    "content-type": "application/json",
    accept: req.headers["accept"] || "text/event-stream",
    authorization,
    "chatgpt-account-id": accountId,
    "openai-beta": req.headers["openai-beta"] || "responses=experimental",
    originator: req.headers["originator"] || "codex_cli_rs",
    session_id: req.headers["session_id"] || "",
    "user-agent": req.headers["user-agent"] || "codex",
  };
  const upstream = await fetch(CHATGPT_RESPONSES, { method: "POST", headers, body: rawBody });
  const out = {};
  upstream.headers.forEach((v, k) => {
    if (!["content-encoding", "content-length", "transfer-encoding"].includes(k)) out[k] = v;
  });
  res.writeHead(upstream.status, out);
  if (upstream.body) for await (const chunk of upstream.body) res.write(Buffer.from(chunk));
  res.end();
  return upstream.status;
}

// ── 第三方分支：Responses → Chat Completions → 再封装回 Responses SSE ───
async function proxyChat(res, body, route) {
  if (!route.apiKey) throw httpError(401, `${route.id} 缺少 API key（在菜单里"设置 key"或改 ~/.codex/codex-switch/.env）`);
  const upstream = await fetch(`${route.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${route.apiKey}` },
    body: JSON.stringify({
      model: body.model,
      messages: responsesInputToMessages(body),
      stream: false,
      temperature: body.temperature,
      max_tokens: body.max_output_tokens || body.max_tokens || 1024,
    }),
  });
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) throw httpError(upstream.status, payload.error?.message || `${route.id} upstream failed`, payload);
  emitResponsesSse(res, body.model, payload.choices?.[0]?.message?.content || "", payload.usage || {});
  return 200;
}

// ── HTTP server ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    ROUTES = buildRoutes(); // 热读，改 providers.json/.env 无需重启 router
    return writeJson(res, 200, { ok: true, host: HOST, port: PORT, routes: ROUTES.map((r) => r.id) });
  }
  if (req.method !== "POST" || !req.url?.endsWith("/responses")) {
    return writeJson(res, 404, { error: { message: "not found" } });
  }

  const startedAt = Date.now();
  let body = {};
  try {
    const rawBody = await collect(req);
    body = JSON.parse(rawBody.toString("utf8") || "{}");
    body.model = body.model || "gpt-5.5";
    ROUTES = buildRoutes(); // 每次请求按最新 providers.json/.env 路由
    const route = routeFor(body.model);
    if (!route) throw httpError(400, `No route for model ${body.model}`);

    const status = route.kind === "passthrough"
      ? await passThroughToChatGPT(req, res, rawBody)
      : await proxyChat(res, body, route);
    log({ model: body.model, route: route.id, status, ms: Date.now() - startedAt });
  } catch (err) {
    const status = err.status || 500;
    if (!res.headersSent) writeJson(res, status, { error: { message: err.message, details: err.details } });
    else res.end();
    log({ model: body.model, route: routeFor(body.model || "")?.id || "none", status, ms: Date.now() - startedAt, error: err.message });
  }
});
server.listen(PORT, HOST, () => console.error(`Codex multi-model router on http://${HOST}:${PORT}`));

// ── helpers ──────────────────────────────────────────────────────────
function authFromDisk() {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".codex", "auth.json"), "utf8"));
    return { accountId: a.tokens?.account_id || "", accessToken: a.tokens?.access_token || "" };
  } catch { return { accountId: "", accessToken: "" }; }
}

function responsesInputToMessages(body) {
  const messages = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    messages.push({ role: "system", content: body.instructions });
  }
  const input = body.input;
  if (typeof input === "string") { messages.push({ role: "user", content: input }); return messages; }
  if (!Array.isArray(input)) { messages.push({ role: "user", content: stringify(input ?? "") }); return messages; }
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    if (item.type && item.type !== "message") continue;
    const role = item.role === "developer" ? "system" : item.role || "user";
    messages.push({ role, content: contentToText(item.content) });
  }
  if (messages.length === 0) messages.push({ role: "user", content: "" });
  return messages;
}
function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return stringify(content ?? "");
  return content.map((p) => (p && typeof p === "object" ? (p.text || p.input_text || p.output_text || "") : stringify(p ?? ""))).join("");
}
const stringify = (v) => (typeof v === "string" ? v : JSON.stringify(v));

// 把一段纯文本封装成 Codex 期望的 Responses SSE 事件流
function emitResponsesSse(res, model, text, usage = {}) {
  const id = `resp_${Date.now()}`, itemId = `msg_${Date.now()}`;
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
  const sse = (event, data) => { res.write(`event: ${event}\n`); res.write(`data: ${JSON.stringify(data)}\n\n`); };
  const item = { id: itemId, type: "message", status: "in_progress", role: "assistant", content: [] };
  sse("response.created", { type: "response.created", response: { id, type: "response", status: "in_progress", model } });
  sse("response.output_item.added", { type: "response.output_item.added", output_index: 0, item });
  sse("response.content_part.added", { type: "response.content_part.added", item_id: itemId, output_index: 0, content_index: 0, part: { type: "output_text", text: "" } });
  sse("response.output_text.delta", { type: "response.output_text.delta", item_id: itemId, output_index: 0, content_index: 0, delta: text });
  sse("response.output_text.done", { type: "response.output_text.done", item_id: itemId, output_index: 0, content_index: 0, text });
  sse("response.content_part.done", { type: "response.content_part.done", item_id: itemId, output_index: 0, content_index: 0, part: { type: "output_text", text } });
  const done = { id: itemId, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text }] };
  sse("response.output_item.done", { type: "response.output_item.done", output_index: 0, item: done });
  sse("response.completed", { type: "response.completed", response: { id, type: "response", status: "completed", model, output: [done], usage: {
    input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0, total_tokens: usage.total_tokens || 0 } } });
  res.end();
}

function collect(req) {
  return new Promise((resolve) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => resolve(Buffer.concat(c))); req.on("error", () => resolve(Buffer.concat(c))); });
}
function httpError(status, message, details) { const e = new Error(message); e.status = status; e.details = details; return e; }
function writeJson(res, status, payload) { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(payload)); }
function log(entry) { fs.appendFile(logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", () => {}); }
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v; // 覆盖：保证 set-key 后热读到最新值
  }
}
