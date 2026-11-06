import crypto from "node:crypto";
import fs from "node:fs";
import { run } from "./exec";
import { dataPath, ensureDir } from "./paths";
import { readJson, writeJson } from "./store";

export type SecretName = "jira.token" | "openai.key" | "elevenlabs.key" | "timetracker.password";
export const SECRET_NAMES: SecretName[] = ["jira.token", "openai.key", "elevenlabs.key", "timetracker.password"];

const KEYCHAIN_SERVICE = "dev-dashboard";
const KEYCHAIN_ACCOUNT = "master-key";
let cachedKey: Buffer | null = null;

async function keychainGet(): Promise<string> {
  const r = await run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"], {
    timeoutMs: 8000,
  });
  return r.code === 0 ? r.stdout.trim() : "";
}

async function keychainSet(hex: string): Promise<boolean> {
  const r = await run(
    "security",
    ["add-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w", hex, "-U"],
    { timeoutMs: 8000 },
  );
  return r.code === 0;
}

async function masterKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  const env = process.env.DEV_DASHBOARD_MASTER_KEY;
  if (env && /^[0-9a-f]{64}$/i.test(env)) return (cachedKey = Buffer.from(env, "hex"));

  if (process.platform === "darwin") {
    let hex = await keychainGet();
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      hex = crypto.randomBytes(32).toString("hex");
      if (!(await keychainSet(hex))) throw new Error("Could not store the master key in the macOS Keychain");
    }
    return (cachedKey = Buffer.from(hex, "hex"));
  }

  const file = dataPath("master.key");
  ensureDir(dataPath());
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return (cachedKey = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex"));
}

type SecretFile = Partial<Record<SecretName, { blob: string; last4: string }>>;
const FILE = "secrets.json";

export async function setSecret(name: SecretName, value: string): Promise<void> {
  const key = await masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const blob = [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
  const all = readJson<SecretFile>(FILE, {});
  all[name] = { blob, last4: value.slice(-4) };
  writeJson(FILE, all);
}

export async function getSecret(name: SecretName): Promise<string> {
  const entry = readJson<SecretFile>(FILE, {})[name];
  if (!entry) return "";
  const [iv, tag, ct] = entry.blob.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", await masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function deleteSecret(name: SecretName): void {
  const all = readJson<SecretFile>(FILE, {});
  delete all[name];
  writeJson(FILE, all);
}

export function secretStatus(): Record<SecretName, { set: boolean; last4: string }> {
  const all = readJson<SecretFile>(FILE, {});
  return Object.fromEntries(
    SECRET_NAMES.map((n) => [n, { set: !!all[n], last4: all[n]?.last4 ?? "" }]),
  ) as Record<SecretName, { set: boolean; last4: string }>;
}
