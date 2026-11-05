import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Browser, BrowserContext, LaunchOptions } from "playwright";
import { HttpError } from "../api";
import { run } from "../exec";
import { getSettings } from "../settings";
import { startJob } from "../jobs";
import { sessionFile } from "./store";

const CHROME_APP = "/Applications/Google Chrome.app";

async function pw() {
  return import("playwright");
}

export function chromeInstalled(): boolean {
  return process.platform !== "darwin" || fs.existsSync(CHROME_APP);
}

/** Bundled Chromium is only needed when the system Chrome isn't used. */
export async function bundledChromiumReady(): Promise<boolean> {
  try {
    const { chromium } = await pw();
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** Playwright records video with its own ffmpeg build, downloaded separately from the browsers. */
export function playwrightFfmpegReady(): boolean {
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "node_modules", "playwright-core", "browsers.json"), "utf8")) as {
      browsers: { name: string; revision: string }[];
    };
    const rev = reg.browsers.find((b) => b.name === "ffmpeg")?.revision;
    const base =
      process.env.PLAYWRIGHT_BROWSERS_PATH ||
      (process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Caches", "ms-playwright")
        : process.platform === "win32"
          ? path.join(os.homedir(), "AppData", "Local", "ms-playwright")
          : path.join(os.homedir(), ".cache", "ms-playwright"));
    return !!rev && fs.existsSync(path.join(base, `ffmpeg-${rev}`));
  } catch {
    return false;
  }
}

export async function browserReady(): Promise<boolean> {
  const browser = getSettings().recording.browser === "chrome" ? chromeInstalled() : await bundledChromiumReady();
  return browser && playwrightFfmpegReady();
}

export function startBrowserInstall() {
  return startJob("demo-setup", 1, async (ctx) => {
    const what = getSettings().recording.browser === "chrome" ? ["ffmpeg"] : ["chromium", "ffmpeg"];
    ctx.label(`Downloading ${what.join(" + ")} for Playwright`);
    const cli = path.join(process.cwd(), "node_modules", "playwright", "cli.js");
    const r = await run(process.execPath, [cli, "install", ...what], { timeoutMs: 15 * 60_000 });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).slice(-600));
    ctx.step("Done");
  });
}

export async function launch(headless: boolean): Promise<Browser> {
  const { chromium } = await pw();
  const opts: LaunchOptions = { headless };
  if (getSettings().recording.browser === "chrome") opts.channel = "chrome";
  try {
    return await chromium.launch(opts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HttpError(
      500,
      opts.channel
        ? `Could not start Google Chrome for Playwright (${msg.split("\n")[0]}). Install Chrome or switch the browser to Chromium in Settings.`
        : `Playwright Chromium is not installed — click "Install browser" (${msg.split("\n")[0]}).`,
    );
  }
}

export function savedSession(): { saved: boolean; savedAt: string | null } {
  try {
    return { saved: true, savedAt: fs.statSync(sessionFile()).mtime.toISOString() };
  } catch {
    return { saved: false, savedAt: null };
  }
}

// One visible login window at a time; the person signs in, then the app saves cookies + storage.
const g = globalThis as unknown as {
  __ddLogin?: { browser: Browser; context: BrowserContext } | null;
  __ddLoginOpening?: Promise<void> | null;
};

export function loginOpen(): boolean {
  return !!g.__ddLogin?.browser.isConnected();
}

/** Opens the single login window, or brings the existing one to the front (double clicks don't open a second one). */
export async function openLogin(): Promise<void> {
  const url = getSettings().recording.appUrl;
  if (!url) throw new HttpError(400, "Set the demo app URL first (Settings → Demo recording).");
  if (g.__ddLoginOpening) return g.__ddLoginOpening;
  if (loginOpen()) {
    const pages = g.__ddLogin!.context.pages();
    const page = pages[pages.length - 1] ?? (await g.__ddLogin!.context.newPage());
    await page.bringToFront();
    if (page.url() === "about:blank") await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
    return;
  }
  g.__ddLoginOpening = doOpenLogin(url).finally(() => (g.__ddLoginOpening = null));
  return g.__ddLoginOpening;
}

async function doOpenLogin(url: string): Promise<void> {
  const browser = await launch(false);
  const s = savedSession();
  // viewport: null → the window behaves like normal Chrome (resizable, new tabs with Cmd+T share this session).
  const context = await browser.newContext({ viewport: null, storageState: s.saved ? sessionFile() : undefined });
  g.__ddLogin = { browser, context };
  browser.on("disconnected", () => {
    if (g.__ddLogin?.browser === browser) g.__ddLogin = null;
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
}

export async function saveLogin(): Promise<void> {
  const cur = g.__ddLogin;
  if (!cur || !cur.browser.isConnected()) throw new HttpError(400, "The login window is closed — open it again, sign in, then save.");
  fs.mkdirSync(path.dirname(sessionFile()), { recursive: true });
  await cur.context.storageState({ path: sessionFile() });
  fs.chmodSync(sessionFile(), 0o600);
  await cur.browser.close();
  g.__ddLogin = null;
}

export async function closeLogin(): Promise<void> {
  await g.__ddLogin?.browser.close().catch(() => undefined);
  g.__ddLogin = null;
}

export function clearSession(): void {
  fs.rmSync(sessionFile(), { force: true });
}
