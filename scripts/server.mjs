import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MODEL = "claude-opus-5";
const MAX_TEXT_LENGTH = 120000;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorResult(message) {
  return {
    content: [{ type: "text", text: `Claude 諮詢失敗：${message}` }],
    isError: true,
  };
}

function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function truncate(value, limit = MAX_TEXT_LENGTH) {
  const input = text(value);
  if (input.length <= limit) return input;
  return `${input.slice(0, limit)}\n\n[內容已截斷，原始長度 ${input.length} 字元]`;
}

function redactSecrets(value) {
  return truncate(value)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]")
    .replace(/(api[_-]?key|token|secret|password|private[_-]?key)\s*([:=])\s*[^\s,;]+/gi, "$1$2 [REDACTED]")
    .replace(/(^|\n)\s*(export\s+)?[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*.*$/gim, "$1[REDACTED_ENVIRONMENT_SECRET]");
}

function credentialsPath() {
  return process.env.JOINT_DECISION_CREDENTIALS || path.join(os.homedir(), ".config", "claude-joint-decision", "credentials.json");
}

function readApiKey() {
  const fromEnv = text(process.env.JOINT_DECISION_API_KEY);
  if (fromEnv) return fromEnv;

  try {
    const payload = JSON.parse(fs.readFileSync(credentialsPath(), "utf8"));
    const fromFile = text(payload?.apiKey || payload?.api_key || payload?.key);
    if (fromFile) return fromFile;
  } catch {
    // The actionable error is emitted below so the key is never included in logs.
  }
  return "";
}

function buildPrompt(stage, input) {
  const request = redactSecrets(input.request);
  const context = redactSecrets(input.context);
  const constraints = redactSecrets(input.constraints);
  const candidatePlan = redactSecrets(input.candidate_plan);
  const summary = redactSecrets(input.summary);
  const diff = redactSecrets(input.diff);
  const tests = redactSecrets(input.tests);
  const remaining = redactSecrets(input.remaining_concerns);

  const common = `你是 Codex 的獨立共同決策人 Claude。你只提供唯讀的第二意見，不要修改檔案、執行命令、部署服務，也不要要求主代理把控制權交給你。\n\n請使用繁體中文，務實、精準、避免泛泛而談。只根據輸入的事實推理；若資訊不足，明確列出假設。回答固定包含：\n1. 結論\n2. 關鍵理由\n3. 風險與反例\n4. 建議驗證\n5. 給 Codex 的採納建議（採納／部分採納／不採納及原因）。`;

  if (stage === "plan") {
    return `${common}\n\n這是修改前方案審查。請優先判斷方案是否符合最小修改、既有架構、測試方式與使用者要求。\n\n使用者需求：\n${request || "（未提供）"}\n\n已確認上下文：\n${context || "（未提供）"}\n\n限制：\n${constraints || "（未提供）"}\n\nCodex 候選方案：\n${candidatePlan || "（未提供）"}`;
  }

  return `${common}\n\n這是修改後 diff 審查。請優先尋找 correctness、回歸、資料／權限／secret 外洩、測試缺口，以及與實際需求不一致之處；不要因為風格偏好而要求無關重構。\n\n修改摘要：\n${summary || "（未提供）"}\n\n相關 diff：\n${diff || "（未提供）"}\n\n測試結果：\n${tests || "（未提供）"}\n\n剩餘疑慮：\n${remaining || "（未提供）"}`;
}

function extractContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : text(part?.text)).filter(Boolean).join("\n").trim();
  }
  const outputText = payload?.output_text;
  if (typeof outputText === "string") return outputText.trim();
  return "";
}

async function callClaude(stage, input) {
  const apiKey = readApiKey();
  if (!apiKey) {
    throw new Error(`找不到 API credential。請設定 JOINT_DECISION_API_KEY，或執行 ${path.join(PLUGIN_ROOT, "scripts", "setup-credential.ps1")}`);
  }

  const baseUrl = text(process.env.JOINT_DECISION_BASE_URL, DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = text(input.model, text(process.env.JOINT_DECISION_MODEL, DEFAULT_MODEL));
  const timeoutMs = Math.min(Math.max(Number(input.timeout_ms) || 120000, 10000), 180000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "你是嚴謹的軟體工程共同決策人。" },
          { role: "user", content: buildPrompt(stage, input) },
        ],
        temperature: 0.2,
        max_tokens: Math.min(Math.max(Number(input.max_tokens) || 1800, 300), 5000),
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const providerMessage = text(payload?.error?.message, text(payload?.message, `HTTP ${response.status}`));
      throw new Error(`API ${response.status}: ${providerMessage}`);
    }

    const answer = extractContent(payload);
    if (!answer) throw new Error("API 回應沒有可讀的文字內容");
    const requestId = response.headers.get("x-request-id");
    return `${answer}\n\n---\n模型：${model}${requestId ? `\nRequest ID：${requestId}` : ""}`;
  } finally {
    clearTimeout(timeout);
  }
}

const TOOLS = [
  {
    name: "claude_joint_decision",
    description: "在修改內容前，請 Claude 以唯讀方式審查需求、候選方案、限制與風險，提供第二意見。Claude 不會修改檔案或執行命令。",
    inputSchema: {
      type: "object",
      properties: {
        request: { type: "string", description: "使用者需求" },
        context: { type: "string", description: "已確認的架構、資料流、相關檔案與測試方式" },
        constraints: { type: "string", description: "不可改動範圍、相容性、安全或部署限制" },
        candidate_plan: { type: "string", description: "Codex 預計採用的最小修改方案" },
        model: { type: "string", description: "選用模型；預設 claude-opus-5" },
        max_tokens: { type: "integer", description: "輸出上限，預設 1800" },
        timeout_ms: { type: "integer", description: "逾時毫秒數，預設 120000" },
      },
      required: ["request"],
      additionalProperties: false,
    },
  },
  {
    name: "claude_review_diff",
    description: "在修改完成後，請 Claude 以唯讀方式審查實際 diff、測試結果與剩餘疑慮，找出回歸與高風險問題。",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "實際完成的修改摘要" },
        diff: { type: "string", description: "需要審查的相關 diff" },
        tests: { type: "string", description: "已執行的測試與結果" },
        remaining_concerns: { type: "string", description: "尚未解決的疑慮" },
        model: { type: "string", description: "選用模型；預設 claude-opus-5" },
        max_tokens: { type: "integer", description: "輸出上限，預設 1800" },
        timeout_ms: { type: "integer", description: "逾時毫秒數，預設 120000" },
      },
      required: ["summary", "diff"],
      additionalProperties: false,
    },
  },
];

async function handle(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: message.params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "claude-joint-decision", version: "0.1.0" },
    };
  }
  if (message.method === "notifications/initialized" || message.method === "ping") return {};
  if (message.method === "tools/list") return { tools: TOOLS };
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const input = message.params?.arguments || {};
    try {
      if (name === "claude_joint_decision") return { content: [{ type: "text", text: await callClaude("plan", input) }] };
      if (name === "claude_review_diff") return { content: [{ type: "text", text: await callClaude("review", input) }] };
      return errorResult(`未知工具：${name}`);
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  }
  return {};
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    const result = await handle(message);
    if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result });
  }
});
