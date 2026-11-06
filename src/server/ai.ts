import { z } from "zod";
import type { AiProvider, UsageEntry } from "@/lib/types";
import { HttpError } from "./api";
import { findBinary, run } from "./exec";
import { aiWorkDir } from "./paths";
import { getSettings } from "./settings";
import { appendJsonLine, hashKey, readJson, readJsonLines, writeJson } from "./store";

const CLAUDE_READ_TOOLS = "Read,Grep,Glob";
const CLAUDE_BLOCKED = "Write,Edit,MultiEdit,NotebookEdit,Bash,WebFetch,WebSearch,Task,Agent";

export async function resolveBin(provider: AiProvider): Promise<string> {
  const s = getSettings();
  const configured = provider === "claude" ? s.ai.claudeBin : s.ai.copilotBin;
  return configured || (await findBinary(provider));
}

export async function detectCli(provider: AiProvider) {
  const bin = await resolveBin(provider);
  if (!bin) return { provider, found: false, bin: "", version: "" };
  const r = await run(bin, ["--version"], { timeoutMs: 15000 });
  return { provider, found: r.code === 0, bin, version: (r.stdout || r.stderr).trim().split("\n")[0] ?? "" };
}

export interface AiRunOptions<T> {
  task: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Directories the model may READ (repos). Empty → no tools at all. */
  readDirs?: string[];
  timeoutMs?: number;
  provider?: AiProvider;
}

export interface AiRunResult<T> {
  data: T;
  provider: AiProvider;
  ms: number;
  costUsd?: number;
}

/**
 * Every top-level JSON object in a CLI's text output, in order. Copilot can print the answer more than once,
 * add prose or a stats line after it, or wrap it in fences, so slicing first "{" … last "}" is not enough.
 */
export function jsonCandidates(text: string): unknown[] {
  const out: unknown[] = [];
  const tryParse = (s: string) => {
    try {
      out.push(JSON.parse(s));
    } catch {
      /* not JSON on its own */
    }
  };
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) tryParse(m[1].trim());
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"' && depth > 0) inStr = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) tryParse(text.slice(start, i + 1));
    }
  }
  return out;
}

async function runOnce(provider: AiProvider, prompt: string, jsonSchema: object, readDirs: string[], timeoutMs: number) {
  const s = getSettings();
  const bin = await resolveBin(provider);
  if (!bin) throw new HttpError(400, `${provider} CLI not found — install it or set its path in Settings → AI.`);
  const cwd = aiWorkDir();

  if (provider === "claude") {
    const args = ["-p", "--output-format", "json", "--json-schema", JSON.stringify(jsonSchema), "--permission-mode", "dontAsk"];
    if (readDirs.length) {
      args.push("--tools", CLAUDE_READ_TOOLS, "--allowedTools", CLAUDE_READ_TOOLS);
      for (const d of readDirs) args.push("--add-dir", d);
    } else {
      args.push("--tools", "");
    }
    args.push("--disallowedTools", CLAUDE_BLOCKED);
    if (s.ai.claudeModel) args.push("--model", s.ai.claudeModel);
    const r = await run(bin, args, { cwd, input: prompt, timeoutMs });
    if (r.timedOut) throw new Error(`claude timed out after ${Math.round(timeoutMs / 1000)}s`);
    let out: { is_error?: boolean; result?: string; structured_output?: unknown; total_cost_usd?: number };
    try {
      out = JSON.parse(r.stdout);
    } catch {
      throw new Error(`claude failed (exit ${r.code}): ${(r.stderr || r.stdout).slice(0, 600)}`);
    }
    if (out.is_error) throw new Error(`claude: ${String(out.result ?? "error").slice(0, 600)}`);
    return { candidates: out.structured_output !== undefined ? [out.structured_output] : jsonCandidates(out.result ?? ""), costUsd: out.total_cost_usd };
  }

  const full =
    `${prompt}\n\n## Output format\nReturn ONLY one JSON object (no prose, no code fences) that validates against this JSON Schema:\n` +
    JSON.stringify(jsonSchema);
  // -p needs --allow-all-tools; deny rules always win over it, so shell/write/url stay blocked.
  const args = ["-p", full, "--allow-all-tools", "--deny-tool", "shell", "--deny-tool", "write", "--deny-tool", "url"];
  args.push("--disable-builtin-mcps", "--no-color", "-s");
  for (const d of readDirs) args.push("--add-dir", d);
  if (s.ai.copilotModel) args.push("--model", s.ai.copilotModel);
  const r = await run(bin, args, { cwd, timeoutMs });
  if (r.timedOut) throw new Error(`copilot timed out after ${Math.round(timeoutMs / 1000)}s`);
  if (r.code !== 0) throw new Error(`copilot failed (exit ${r.code}): ${(r.stderr || r.stdout).slice(0, 600)}`);
  return { candidates: jsonCandidates(r.stdout), costUsd: undefined };
}

export async function runAi<T>(opts: AiRunOptions<T>): Promise<AiRunResult<T>> {
  const provider = opts.provider ?? getSettings().ai.provider;
  // Claude's --json-schema validator rejects the draft-2020-12 `$schema` URI zod emits.
  const { $schema: _unused, ...jsonSchema } = z.toJSONSchema(opts.schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  void _unused;
  const timeoutMs = opts.timeoutMs ?? 240000;
  const started = Date.now();
  let prompt = opts.prompt;
  let lastError = "";
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { candidates, costUsd } = await runOnce(provider, prompt, jsonSchema, opts.readDirs ?? [], timeoutMs);
      // The final answer usually comes last; take the last object that fits the schema.
      for (const c of [...candidates].reverse()) {
        const parsed = opts.schema.safeParse(c);
        if (!parsed.success) continue;
        const ms = Date.now() - started;
        logUsage({ ts: new Date().toISOString(), task: opts.task, provider, ms, ok: true, costUsd });
        return { data: parsed.data, provider, ms, costUsd };
      }
      const biggest = [...candidates].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
      lastError = biggest
        ? (opts.schema.safeParse(biggest).error?.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : "the output contained no JSON object";
      prompt = `${opts.prompt}\n\nYour previous answer failed validation (${lastError}). Return corrected JSON only.`;
    }
    throw new Error(`AI output did not match the expected shape: ${lastError}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logUsage({ ts: new Date().toISOString(), task: opts.task, provider, ms: Date.now() - started, ok: false, error: msg.slice(0, 300) });
    throw e;
  }
}

export function logUsage(entry: UsageEntry): void {
  appendJsonLine("usage.jsonl", entry);
}

export function readUsage(): UsageEntry[] {
  return readJsonLines<UsageEntry>("usage.jsonl");
}

export function cacheGet<T>(ns: string, ...keyParts: unknown[]): T | null {
  return readJson<{ value: T } | null>(`cache/${ns}/${hashKey(...keyParts)}.json`, null)?.value ?? null;
}

export function cacheSet(ns: string, value: unknown, ...keyParts: unknown[]): void {
  writeJson(`cache/${ns}/${hashKey(...keyParts)}.json`, { value, at: new Date().toISOString() });
}

/** Latest value per ticket, independent of the version-specific cache key. */
export function latestGet<T>(ns: string, key: string): T | null {
  return readJson<{ value: T } | null>(`latest/${ns}/${key}.json`, null)?.value ?? null;
}

export function latestSet(ns: string, key: string, value: unknown): void {
  writeJson(`latest/${ns}/${key}.json`, { value, at: new Date().toISOString() });
}
