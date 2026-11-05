import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DemoFlow, FlowFile, RecordingManifest } from "@/lib/types";
import { HttpError } from "../api";
import { dataPath, ensureDir } from "../paths";
import { readJson, removeFile, safeName, writeJson } from "../store";

const target = z.object({
  by: z.enum(["role", "text", "label", "placeholder", "testId", "css"]),
  value: z.string(),
  name: z.string(),
  nth: z.number().int().min(0),
});

export const flowSchema = z.object({
  scenarios: z.array(
    z.object({
      name: z.string(),
      steps: z.array(
        z.object({
          narration: z.string(),
          actions: z.array(
            z.object({
              type: z.enum(["goto", "click", "fill", "select", "press", "hover", "waitFor", "scroll", "wait", "resize", "dblclick"]),
              target: target.nullable(),
              value: z.string(),
            }),
          ),
          screenshot: z.boolean(),
        }),
      ),
    }),
  ),
  notes: z.array(z.string()),
});

export const recDir = (key: string) => dataPath("demo", "recordings", safeName(key));
export const sessionFile = () => dataPath("demo", "session.json");

export function getFlow(key: string): FlowFile | null {
  return readJson<FlowFile | null>(`demo/flows/${safeName(key)}.json`, null);
}

export function saveFlow(key: string, flow: DemoFlow, opts: { approved: boolean; generated?: boolean }): FlowFile {
  const parsed = flowSchema.parse(flow);
  const cur = getFlow(key);
  const now = new Date().toISOString();
  const next: FlowFile = {
    key,
    flow: parsed,
    generatedAt: opts.generated || !cur ? now : cur.generatedAt,
    editedAt: opts.generated ? undefined : now,
    approved: opts.approved,
  };
  writeJson(`demo/flows/${safeName(key)}.json`, next);
  return next;
}

export const PLACEHOLDER_RE = /TODO_[A-Z0-9_]+/g;

/** Placeholders the AI left for test data it didn't have, e.g. TODO_MASTER_BL. */
export function flowPlaceholders(flow: DemoFlow): string[] {
  return [...new Set(JSON.stringify(flow).match(PLACEHOLDER_RE) ?? [])];
}

function replaceStrings<T>(v: T, values: Record<string, string>): T {
  if (typeof v === "string") return v.replace(PLACEHOLDER_RE, (m) => (values[m] !== undefined && values[m] !== "" ? values[m] : m)) as T;
  if (Array.isArray(v)) return v.map((x) => replaceStrings(x, values)) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replaceStrings(x, values)])) as T;
  return v;
}

/** Swaps placeholders for real test data; only the data changes, so the approval stays as it was. */
export function fillPlaceholders(key: string, values: Record<string, string>): FlowFile {
  const cur = getFlow(key);
  if (!cur) throw new HttpError(404, "No flow for this story yet.");
  const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([k, v]) => /^TODO_[A-Z0-9_]+$/.test(k) && v));
  if (!Object.keys(clean).length) throw new HttpError(400, "Enter at least one value.");
  return saveFlow(key, replaceStrings(cur.flow, clean), { approved: cur.approved });
}

export function deleteFlow(key: string): void {
  removeFile(`demo/flows/${safeName(key)}.json`);
}

export function getManifest(key: string): RecordingManifest | null {
  return readJson<RecordingManifest | null>(`demo/recordings/${safeName(key)}/manifest.json`, null);
}

export function saveManifest(m: RecordingManifest): void {
  writeJson(`demo/recordings/${safeName(m.key)}/manifest.json`, m);
}

export function setSelected(key: string, files: string[]): RecordingManifest {
  const m = getManifest(key);
  if (!m) throw new HttpError(404, "No recording for this story yet.");
  const known = new Set(m.shots.map((s) => s.file));
  m.selected = files.filter((f) => known.has(f)).slice(0, 3);
  saveManifest(m);
  return m;
}

export function deleteRecording(key: string): void {
  fs.rmSync(recDir(key), { recursive: true, force: true });
}

/** Only files the recorder wrote (no path parts) can be served. */
export function recordingFile(key: string, name: string): string {
  if (!/^[\w.-]+\.(png|mp4|mp3|webm)$/.test(name)) throw new HttpError(400, "Invalid file name");
  const f = path.join(recDir(key), name);
  if (!fs.existsSync(f)) throw new HttpError(404, `${name} not found`);
  return f;
}

/** Absolute paths of the screenshots chosen for the slide (defaults to one per scenario, max 3). */
export function slideShots(key: string): string[] {
  const m = getManifest(key);
  if (!m) return [];
  const names = m.selected.length ? m.selected : defaultSelection(m);
  return names.map((n) => path.join(recDir(key), n)).filter((f) => fs.existsSync(f));
}

export function defaultSelection(m: Pick<RecordingManifest, "shots">): string[] {
  const out: string[] = [];
  const byScenario = new Map<number, string>();
  for (const s of m.shots) byScenario.set(s.scenario, s.file); // last flagged shot of each scenario
  for (const f of byScenario.values()) if (out.length < 3) out.push(f);
  return out;
}

export function ensureRecDir(key: string): string {
  return ensureDir(recDir(key));
}
