import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HttpError } from "./api";
import { dataPath, ensureDir } from "./paths";

export function readJson<T>(rel: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(dataPath(rel), "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(rel: string, value: unknown): void {
  const file = dataPath(rel);
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function removeFile(rel: string): void {
  fs.rmSync(dataPath(rel), { force: true, recursive: true });
}

export function appendJsonLine(rel: string, value: unknown): void {
  const file = dataPath(rel);
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(value) + "\n", { mode: 0o600 });
}

export function readJsonLines<T>(rel: string): T[] {
  try {
    return fs
      .readFileSync(dataPath(rel), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

export function hashKey(...parts: unknown[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

export function newId(): string {
  return `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

/** Keys used in file names come from Jira (`INTERNAL-123`) or our ids; anything else is rejected. */
export function safeName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(name)) throw new HttpError(400, `Invalid name: ${name}`);
  return name;
}
