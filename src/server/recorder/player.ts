import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "playwright";
import type { FlowAction, FlowTarget, RecordingManifest, RecordingShot } from "@/lib/types";
import { HttpError } from "../api";
import type { JobContext } from "../jobs";
import { getSettings } from "../settings";
import { launch, savedSession } from "./browser";
import { muxNarration, speak } from "./media";
import { defaultSelection, ensureRecDir, flowPlaceholders, getFlow, getManifest, saveManifest, sessionFile } from "./store";

export interface RecordOptions {
  video: boolean;
  voice: boolean;
}

const ACTION_TIMEOUT = 15_000;
const MIN_STEP_MS = 1_200; // a silent step still stays on screen long enough to read
const NARRATION_TAIL_MS = 350;

// A visible cursor + click ripple, so viewers can follow what the recorder does.
const CURSOR_SCRIPT = `(() => {
  if (window.__ddCursor) return;
  const install = () => {
    const c = document.createElement('div');
    c.id = '__dd_cursor';
    c.style.cssText = 'position:fixed;left:-40px;top:-40px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
      'background:rgba(79,70,229,.35);border:2px solid #4f46e5;z-index:2147483647;pointer-events:none;' +
      'transition:left .45s ease,top .45s ease,transform .15s ease;';
    document.documentElement.appendChild(c);
    window.__ddCursor = {
      move: (x, y) => { c.style.left = x + 'px'; c.style.top = y + 'px'; },
      press: () => { c.style.transform = 'scale(.7)'; setTimeout(() => (c.style.transform = 'scale(1)'), 180); },
      banner: (text) => {
        const b = document.createElement('div');
        b.className = '__dd_banner';
        b.textContent = text;
        b.style.cssText = 'position:fixed;left:50%;top:24px;transform:translateX(-50%);background:#4f46e5;color:#fff;' +
          'font:600 18px/1.3 system-ui,sans-serif;padding:10px 20px;border-radius:8px;z-index:2147483646;pointer-events:none;' +
          'box-shadow:0 6px 24px rgba(0,0,0,.25)';
        document.documentElement.appendChild(b);
        setTimeout(() => b.remove(), 2200);
      },
    };
  };
  if (document.documentElement) install(); else document.addEventListener('DOMContentLoaded', install);
})();`;

function locate(page: Page, t: FlowTarget): Locator {
  let l: Locator;
  switch (t.by) {
    case "role":
      l = page.getByRole(t.value as Parameters<Page["getByRole"]>[0], t.name ? { name: t.name } : undefined);
      break;
    case "text":
      l = page.getByText(t.value);
      break;
    case "label":
      l = page.getByLabel(t.value);
      break;
    case "placeholder":
      l = page.getByPlaceholder(t.value);
      break;
    case "testId":
      l = page.getByTestId(t.value);
      break;
    default:
      l = page.locator(t.value);
  }
  return l.nth(t.nth || 0);
}

/** Relative paths resolve against the app URL; absolute URLs must stay on the app's own origin. */
function resolveUrl(appUrl: string, value: string): string {
  const base = new URL(appUrl.endsWith("/") ? appUrl : `${appUrl}/`);
  const url = new URL(value.replace(/^\.\//, ""), base);
  if (url.origin !== base.origin) throw new Error(`Refusing to open ${url.origin} — flows may only navigate inside ${base.origin}.`);
  return url.toString();
}

/** Apps that poll never reach "networkidle"; wait for the load event, then a short quiet period. */
async function settle(page: Page, ms: number) {
  await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(ms);
}

async function pointAt(page: Page, l: Locator, animate: boolean) {
  await l.scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT });
  if (!animate) return;
  const box = await l.boundingBox();
  if (!box) return;
  await page.evaluate(([x, y]) => (window as unknown as { __ddCursor?: { move(x: number, y: number): void } }).__ddCursor?.move(x, y), [
    box.x + box.width / 2,
    box.y + box.height / 2,
  ]);
  await page.waitForTimeout(500);
}

async function runAction(page: Page, a: FlowAction, appUrl: string, animate: boolean) {
  const need = () => {
    if (!a.target) throw new Error(`${a.type} needs a target`);
    return locate(page, a.target);
  };
  switch (a.type) {
    case "goto":
      await page.goto(resolveUrl(appUrl, a.value), { waitUntil: "domcontentloaded", timeout: 60_000 });
      await settle(page, 1_200);
      return;
    case "click": {
      const l = need();
      await pointAt(page, l, animate);
      if (animate) await page.evaluate(() => (window as unknown as { __ddCursor?: { press(): void } }).__ddCursor?.press());
      await l.click({ timeout: ACTION_TIMEOUT });
      await settle(page, 400);
      return;
    }
    case "dblclick": {
      const l = need();
      await pointAt(page, l, animate);
      await l.dblclick({ timeout: ACTION_TIMEOUT });
      await settle(page, 400);
      return;
    }
    case "fill": {
      const l = need();
      await pointAt(page, l, animate);
      await l.fill("", { timeout: ACTION_TIMEOUT });
      await l.pressSequentially(a.value, { delay: animate ? 45 : 0, timeout: ACTION_TIMEOUT * 2 });
      return;
    }
    case "select": {
      const l = need();
      await pointAt(page, l, animate);
      await l.selectOption({ label: a.value }, { timeout: ACTION_TIMEOUT }).catch(() => l.selectOption(a.value, { timeout: ACTION_TIMEOUT }));
      return;
    }
    case "press":
      if (a.target) await need().press(a.value, { timeout: ACTION_TIMEOUT });
      else await page.keyboard.press(a.value);
      return;
    case "hover": {
      const l = need();
      await pointAt(page, l, animate);
      await l.hover({ timeout: ACTION_TIMEOUT });
      return;
    }
    case "waitFor":
      if (a.target) await need().waitFor({ state: "visible", timeout: Number(a.value) || ACTION_TIMEOUT * 2 });
      else await settle(page, Math.min(Number(a.value) || 1_000, 5_000));
      return;
    case "scroll":
      if (a.target) await pointAt(page, need(), animate);
      else await page.mouse.wheel(0, Number(a.value) || 600);
      return;
    case "wait":
      await page.waitForTimeout(Math.min(Number(a.value) || 1000, 15_000));
      return;
    case "resize": {
      // The video frame keeps its size; a wider viewport is scaled into it, which is what a responsive demo needs.
      const m = /^(\d{3,4})\s*[x×]\s*(\d{3,4})$/.exec(a.value.trim());
      if (!m) throw new Error(`resize needs "WIDTHxHEIGHT", got "${a.value}"`);
      await page.setViewportSize({ width: Math.min(Number(m[1]), 3840), height: Math.min(Number(m[2]), 2160) });
      await page.waitForTimeout(600);
    }
  }
}

export async function recordStory(key: string, opts: RecordOptions, ctx: JobContext): Promise<RecordingManifest> {
  const f = getFlow(key);
  if (!f) throw new HttpError(400, `${key}: generate the demo flow first.`);
  if (!f.approved) throw new HttpError(400, `${key}: review the flow and tick "Approved" before running it on the test environment.`);
  const missing = flowPlaceholders(f.flow);
  if (missing.length) throw new HttpError(400, `${key}: fill in the test data first (${missing.join(", ")}).`);
  const { appUrl, width, height } = getSettings().recording;
  if (!appUrl) throw new HttpError(400, "Set the demo app URL first (Settings → Demo recording).");
  const session = savedSession();
  const dir = ensureRecDir(key);
  for (const old of fs.readdirSync(dir)) {
    if (/\.(png|mp4|webm)$/.test(old) || old.startsWith("raw")) fs.rmSync(path.join(dir, old), { recursive: true, force: true });
  }

  // Narration first: its length sets how long each step stays on screen.
  const voice: ({ file: string; ms: number } | null)[][] = [];
  if (opts.voice) {
    ctx.label(`${key}: voice`);
    for (const sc of f.flow.scenarios) {
      const row: ({ file: string; ms: number } | null)[] = [];
      for (const st of sc.steps) row.push(st.narration.trim() ? await speak(st.narration.trim()) : null);
      voice.push(row);
    }
  }

  ctx.label(`${key}: recording`);
  const browser = await launch(true);
  // A run-specific temp folder, so two runs can never delete each other's video.
  const videoTmp = path.join(dir, `raw-${Date.now().toString(36)}`);
  const context = await browser.newContext({
    viewport: { width, height },
    storageState: session.saved ? sessionFile() : undefined,
    recordVideo: opts.video ? { dir: videoTmp, size: { width, height } } : undefined,
  });
  await context.addInitScript(CURSOR_SCRIPT);
  const page = await context.newPage();
  const t0 = Date.now();
  const appOrigin = new URL(appUrl).origin;
  const shots: RecordingShot[] = [];
  const errors: RecordingManifest["errors"] = [];
  const clips: { file: string; startMs: number }[] = [];

  try {
    for (const [si, sc] of f.flow.scenarios.entries()) {
      const anyFlagged = sc.steps.some((s) => s.screenshot);
      let firstStep = true;
      for (const [ti, st] of sc.steps.entries()) {
        ctx.label(`${key}: ${sc.name} · step ${ti + 1}/${sc.steps.length}`);
        const start = Date.now();
        const clip = voice[si]?.[ti] ?? null;
        if (clip) clips.push({ file: clip.file, startMs: start - t0 });
        try {
          for (const a of st.actions) {
            await runAction(page, a, appUrl, opts.video);
            if (a.type === "goto" && new URL(page.url()).origin !== appOrigin)
              throw new Error(`Redirected to ${new URL(page.url()).origin} — the saved login session has expired. Sign in again.`);
          }
          if (firstStep && opts.video) {
            await page
              .evaluate((txt) => (window as unknown as { __ddCursor?: { banner(t: string): void } }).__ddCursor?.banner(txt), `Scenario ${si + 1} · ${sc.name}`)
              .catch(() => undefined);
          }
          firstStep = false;
          const hold = Math.max(clip ? clip.ms + NARRATION_TAIL_MS : 0, MIN_STEP_MS) - (Date.now() - start);
          if (hold > 0) await page.waitForTimeout(hold);
          if (st.screenshot || (!anyFlagged && ti === sc.steps.length - 1)) {
            const file = `s${si + 1}-${ti + 1}.png`;
            // The demo cursor and scenario banner help the video, not the slide.
            await page.screenshot({ path: path.join(dir, file), style: "#__dd_cursor,.__dd_banner{display:none!important}" });
            shots.push({ file, scenario: si, step: ti, caption: sc.name });
          }
        } catch (e) {
          const file = `error-s${si + 1}-${ti + 1}.png`;
          const ok = await page.screenshot({ path: path.join(dir, file) }).then(() => true, () => false);
          errors.push({ scenario: si, step: ti, message: (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 400), shot: ok ? file : null });
          break; // the rest of this scenario depends on the failed step; carry on with the next scenario
        }
      }
    }
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  let video: string | null = null;
  if (opts.video) {
    ctx.label(`${key}: encoding video`);
    const raw = fs.existsSync(videoTmp) ? fs.readdirSync(videoTmp).find((n) => n.endsWith(".webm")) : undefined;
    if (raw) {
      await muxNarration(path.join(videoTmp, raw), clips, path.join(dir, "video.mp4"));
      video = "video.mp4";
    } else errors.push({ scenario: -1, step: -1, message: "The browser did not save a video for this run.", shot: null });
    fs.rmSync(videoTmp, { recursive: true, force: true });
  }

  const prev = getManifest(key);
  const keep = prev?.selected.filter((s) => shots.some((x) => x.file === s)) ?? [];
  const m: RecordingManifest = {
    key,
    recordedAt: new Date().toISOString(),
    ok: errors.length === 0,
    video,
    voice: opts.voice && clips.length > 0,
    durationMs: Date.now() - t0,
    shots,
    selected: keep.length ? keep : defaultSelection({ shots }),
    errors,
  };
  saveManifest(m);
  return m;
}

