import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BuildMeta, DemoDraft, DemoIntroTemplate, DemoStory, TemplateInspect, TemplateMeta, Ticket } from "@/lib/types";
import { runAi } from "./ai";
import { latestSummary } from "./analysis";
import { HttpError } from "./api";
import { findBinary, run } from "./exec";
import { getIssue } from "./jira";
import { runPool, startJob } from "./jobs";
import { dataPath, ensureDir } from "./paths";
import { demoPrompt, demoStorySchema } from "./prompts";
import { getSettings, skillsDir, updateSettings } from "./settings";
import { readSkillFile } from "./skills";
import { newId, readJson, removeFile, safeName, writeJson } from "./store";
import { slideShots } from "./recorder/store";

const SKILL = "sprint-demo-prep";
const scriptPath = () => path.join(skillsDir(), SKILL, "scripts", "sprint_deck.py");
const venvPython = () => dataPath("venv", "bin", "python");

// ---------------------------------------------------------------- python

export async function pythonStatus() {
  const py = venvPython();
  const system = await findBinary("python3");
  if (!fs.existsSync(py)) return { ready: false, venv: false, systemPython: system, message: "Python venv not created yet" };
  const r = await run(py, ["-c", "import pptx; print(pptx.__version__)"], { timeoutMs: 20000 });
  return r.code === 0
    ? { ready: true, venv: true, systemPython: system, message: `python-pptx ${r.stdout.trim()}` }
    : { ready: false, venv: true, systemPython: system, message: "python-pptx not installed" };
}

const g = globalThis as unknown as { __devDashPython?: Promise<void> | null };

/** Creates the venv + installs python-pptx on first use; concurrent callers share one install. */
export function ensurePython(onStep?: (label: string) => void): Promise<void> {
  if (g.__devDashPython) return g.__devDashPython;
  const p = (async () => {
    if ((await pythonStatus()).ready) return;
    const system = await findBinary("python3");
    if (!system) throw new HttpError(400, "python3 not found — install Python 3 (e.g. brew install python) and retry.");
    onStep?.("Creating venv");
    if (!fs.existsSync(venvPython())) {
      const r = await run(system, ["-m", "venv", dataPath("venv")], { timeoutMs: 120000 });
      if (r.code !== 0) throw new Error(r.stderr || "venv creation failed");
    }
    onStep?.("Installing python-pptx");
    const pip = await run(venvPython(), ["-m", "pip", "install", "--quiet", "python-pptx"], { timeoutMs: 600000 });
    if (pip.code !== 0) throw new Error(pip.stderr.slice(-800) || "pip install failed");
    await reinspectFailed();
  })();
  g.__devDashPython = p;
  p.catch(() => undefined).finally(() => (g.__devDashPython = null));
  return p;
}

export function startPythonInstall() {
  return startJob("python-install", 1, async (ctx) => {
    await ensurePython((label) => ctx.label(label));
    ctx.step("Done");
    return pythonStatus();
  });
}

async function deck(args: string[], timeoutMs = 180000) {
  // Check first: the install itself re-inspects templates through deck(), and must not wait on itself.
  if (!(await pythonStatus()).ready) await ensurePython();
  if (!fs.existsSync(scriptPath())) throw new HttpError(500, `Deck script missing: ${scriptPath()}`);
  return run(venvPython(), [scriptPath(), ...args], { timeoutMs, cwd: path.dirname(scriptPath()) });
}

export function parseInspect(stdout: string): TemplateInspect {
  const slides: TemplateInspect["slides"] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+screenshots=(\d+)(?: notes)?(?: cards=.*?)?(?: items=(\d+))? \| ?(.*)$/);
    if (m) slides.push({ n: Number(m[1]), kind: m[2], screenshots: Number(m[3]), items: m[4] ? Number(m[4]) : null, title: m[5] });
  }
  const num = (re: RegExp) => {
    const m = stdout.match(re);
    return m && /^\d+$/.test(m[1]) ? Number(m[1]) : null;
  };
  const purposeTemplate = num(/template purpose slide:\s*(\S+)/);
  const demoTemplate = num(/template demo slide:\s*(\S+)/);
  return { ok: purposeTemplate !== null && demoTemplate !== null, slides, purposeTemplate, demoTemplate };
}

async function inspectFile(file: string): Promise<TemplateInspect> {
  const r = await deck(["inspect", file]);
  if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout).slice(-600), slides: [], purposeTemplate: null, demoTemplate: null };
  const res = parseInspect(r.stdout);
  if (!res.ok) res.error = "No Purpose + WHAT WE'LL DEMO slide pair found — the deck builder can't use this template.";
  return res;
}

// ---------------------------------------------------------------- templates

const TPL_INDEX = "templates/index.json";
const tplFile = (id: string) => dataPath("templates", `${safeName(id)}.pptx`);

export function listTemplates(): { templates: TemplateMeta[]; activeId: string } {
  return { templates: readJson<TemplateMeta[]>(TPL_INDEX, []), activeId: getSettings().demo.activeTemplateId };
}

export async function addTemplate(name: string, data: Buffer): Promise<TemplateMeta> {
  if (data.subarray(0, 2).toString() !== "PK") throw new HttpError(400, "Not a .pptx file");
  const id = newId();
  ensureDir(dataPath("templates"));
  fs.writeFileSync(tplFile(id), data);
  let inspect: TemplateInspect;
  try {
    inspect = await inspectFile(tplFile(id));
  } catch (e) {
    inspect = { ok: false, error: e instanceof Error ? e.message : String(e), slides: [], purposeTemplate: null, demoTemplate: null };
  }
  const meta: TemplateMeta = { id, name: name.replace(/[^\w .()[\]–-]+/g, "_").slice(0, 120) || "template.pptx", size: data.length, uploadedAt: new Date().toISOString(), inspect };
  writeJson(TPL_INDEX, [meta, ...listTemplates().templates]);
  if (!getSettings().demo.activeTemplateId) updateSettings({ demo: { ...getSettings().demo, activeTemplateId: id } });
  return meta;
}

export async function reinspectTemplate(id: string): Promise<TemplateMeta> {
  const all = listTemplates().templates;
  const t = all.find((x) => x.id === id);
  if (!t) throw new HttpError(404, "Template not found");
  removeFile(`templates/${safeName(id)}-intro`);
  t.inspect = await inspectFile(tplFile(id));
  writeJson(TPL_INDEX, all);
  return t;
}

/** Templates uploaded before Python was ready are re-checked once it is. */
async function reinspectFailed() {
  const all = listTemplates().templates;
  let changed = false;
  for (const t of all) {
    if (t.inspect.ok || !fs.existsSync(tplFile(t.id))) continue;
    t.inspect = await inspectFile(tplFile(t.id));
    changed = true;
  }
  if (changed) writeJson(TPL_INDEX, all);
}

export function deleteTemplate(id: string) {
  writeJson(TPL_INDEX, listTemplates().templates.filter((x) => x.id !== id));
  removeFile(`templates/${safeName(id)}.pptx`);
  removeFile(`templates/${safeName(id)}-intro`);
  if (getSettings().demo.activeTemplateId === id) updateSettings({ demo: { ...getSettings().demo, activeTemplateId: "" } });
}

export function activateTemplate(id: string) {
  if (!listTemplates().templates.some((x) => x.id === id)) throw new HttpError(404, "Template not found");
  updateSettings({ demo: { ...getSettings().demo, activeTemplateId: id } });
}

// ---------------------------------------------------------------- opening slides

const introDir = (tplId: string) => dataPath("templates", `${safeName(tplId)}-intro`);
const INTRO_UPLOADS = "demo/intro";
const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", tiff: "image/tiff" } as const;

/** The active template's opening slides (text boxes + screenshot slots); read once per template and cached with its previews. */
export async function templateIntro(): Promise<DemoIntroTemplate> {
  const tplId = getSettings().demo.activeTemplateId;
  if (!tplId || !listTemplates().templates.some((t) => t.id === tplId)) return { templateId: null, slides: [] };
  const dir = introDir(tplId);
  const cache = path.join(dir, "intro.json");
  if (fs.existsSync(cache)) return { templateId: tplId, ...JSON.parse(fs.readFileSync(cache, "utf8")) };
  ensureDir(dir);
  const r = await deck(["intro", tplFile(tplId), dir]);
  if (r.code !== 0) return { templateId: tplId, slides: [], error: (r.stderr || r.stdout).slice(-600) };
  const parsed = JSON.parse(r.stdout) as Omit<DemoIntroTemplate, "templateId">;
  fs.writeFileSync(cache, JSON.stringify(parsed));
  return { templateId: tplId, ...parsed };
}

function imageExt(data: Buffer): keyof typeof IMAGE_TYPES | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  return null;
}

/** Stores a screenshot for an opening-slide slot; PNG / JPEG only (what python-pptx embeds reliably). */
export function saveIntroImage(data: Buffer): { name: string } {
  const ext = imageExt(data);
  if (!ext) throw new HttpError(400, "Only PNG or JPEG images are supported");
  const name = `${newId()}.${ext}`;
  ensureDir(dataPath(INTRO_UPLOADS));
  fs.writeFileSync(dataPath(INTRO_UPLOADS, name), data);
  return { name };
}

/** Resolves an uploaded image, or (with tplId) a template preview, to a path + content type. */
export function introImageFile(name: string, tplId?: string): { file: string; type: string } {
  const file = tplId ? path.join(introDir(tplId), safeName(name)) : dataPath(INTRO_UPLOADS, safeName(name));
  if (!fs.existsSync(file)) throw new HttpError(404, "Image not found");
  const ext = path.extname(file).slice(1).toLowerCase() as keyof typeof IMAGE_TYPES;
  return { file, type: IMAGE_TYPES[ext] ?? "application/octet-stream" };
}

/** Drops uploaded images the draft no longer uses; recent ones are kept because their draft save may still be in flight. */
function pruneIntroImages(d: DemoDraft) {
  const dir = dataPath(INTRO_UPLOADS);
  if (!fs.existsSync(dir)) return;
  const used = new Set(Object.values(d.intro?.slides ?? {}).flatMap((s) => Object.values(s.images)));
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (!used.has(f) && fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { force: true });
  }
}

/** The `intro` block for content.json: only edits made for this template, with image names turned into paths. */
function introContent(draft: DemoDraft, tplId: string) {
  if (!draft.intro || draft.intro.templateId !== tplId) return undefined;
  const out = Object.entries(draft.intro.slides)
    .map(([n, s]) => ({
      slide: Number(n),
      texts: s.texts,
      images: Object.fromEntries(
        Object.entries(s.images)
          .map(([id, name]) => [id, dataPath(INTRO_UPLOADS, safeName(name))])
          .filter(([, file]) => fs.existsSync(file)),
      ),
    }))
    .filter((s) => Object.keys(s.texts).length || Object.keys(s.images).length);
  return out.length ? out : undefined;
}

// ---------------------------------------------------------------- draft

const DRAFT = "demo/draft.json";

export function getDraft(): DemoDraft {
  return readJson<DemoDraft>(DRAFT, { sprintId: null, sprintName: "", glanceTitle: "", stories: [], updatedAt: "" });
}

export function saveDraft(d: DemoDraft): DemoDraft {
  const next = { ...d, updatedAt: new Date().toISOString() };
  writeJson(DRAFT, next);
  pruneIntroImages(next);
  return next;
}

export function statusBadge(t: Ticket): string {
  return t.statusCategory === "done" || /tested|done/i.test(t.status) ? "✓ BUILT" : t.status.toUpperCase();
}

function skillDocs() {
  return {
    skillMd: readSkillFile(SKILL, "SKILL.md"),
    scriptFormat: readSkillFile(SKILL, "references", "demo-script-format.md"),
    example: readSkillFile(SKILL, "assets", "content.example.json"),
  };
}

export function startDraftJob(keys: string[], sprint: { id: number | null; name: string }) {
  keys.forEach(safeName);
  return startJob("demo-draft", keys.length, async (ctx) => {
    const docs = skillDocs();
    if (!docs.skillMd) throw new Error(`Skill not found in ${skillsDir()}/${SKILL}`);
    const drafted: Record<string, DemoStory> = {};
    let failed = 0;
    for (const k of keys) ctx.item(k, "pending");
    await runPool(keys, getSettings().ai.concurrency, async (key) => {
      ctx.item(key, "running");
      try {
        const t = await getIssue(key);
        const { data } = await runAi({ task: "demo", prompt: demoPrompt(t, latestSummary(key), docs, getSettings().glossary), schema: demoStorySchema });
        drafted[key] = {
          key,
          title: data.title,
          tag: data.tag || "IMPROVEMENT",
          status: statusBadge(t),
          headline: [data.headlineLead, data.headlineRest],
          purpose: data.purpose,
          why: data.why,
          improving: data.improving,
          scenarios: data.scenarios.slice(0, 6),
          testIds: data.testIds.join("\n"),
        };
        ctx.item(key, "done");
      } catch (e) {
        failed++;
        ctx.item(key, "error", e instanceof Error ? e.message : String(e));
      }
      ctx.step();
    });

    const cur = getDraft();
    const sameSprint = cur.sprintId === sprint.id;
    const stories = sameSprint ? [...cur.stories] : [];
    for (const key of keys) {
      const d = drafted[key];
      if (!d) continue;
      const i = stories.findIndex((s) => s.key === key);
      if (i >= 0) stories[i] = { ...d, testIds: stories[i].testIds || d.testIds };
      else stories.push(d);
    }
    saveDraft({
      sprintId: sprint.id,
      sprintName: sprint.name,
      glanceTitle: sameSprint && cur.glanceTitle ? cur.glanceTitle : `${sprint.name} at a glance`,
      stories,
      // Opening-slide edits (sprint data screenshots, goal text …) are hand-made: never drop them when stories are re-drafted.
      intro: cur.intro,
      updatedAt: "",
    });
    return { failed };
  });
}

// ---------------------------------------------------------------- script

const DEFAULT_OPENING =
  "Good morning everyone. Today, I'd like to walk you through the user stories we completed in this sprint. I'll briefly introduce each story, explain what has changed, and then demonstrate the key scenarios directly in the system. Let's get started with the first user story.";
const DEFAULT_CLOSING = [
  "That concludes all the user stories completed in this sprint.",
  "Before moving on to the next topic, I'd be happy to answer any questions or hear any feedback regarding these enhancements.",
];

function scriptFrame() {
  const fmt = readSkillFile(SKILL, "references", "demo-script-format.md");
  const block = fmt.match(/```\n(DEMONSTRATION[\s\S]*?)```/)?.[1] ?? "";
  const lines = block.split("\n");
  const sep = lines.find((l) => /^—{20,}$/.test(l.trim()))?.trim() ?? "—".repeat(72);
  const ci = lines.findIndex((l) => l.trim() === "Closing");
  const closing = ci >= 0 ? lines.slice(ci + 1).map((l) => l.trim()).filter(Boolean) : DEFAULT_CLOSING;
  return { opening: lines[1]?.trim() || DEFAULT_OPENING, sep, closing: closing.length ? closing : DEFAULT_CLOSING };
}

export function testLinks(story: DemoStory): { label: string; url: string }[] {
  const tpl = getSettings().demo.testLinkTemplate;
  return story.testIds
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.+?):\s+(\S+)$/);
      const [label, id] = m ? [m[1].trim(), m[2]] : ["", l];
      return { label, url: /^https?:\/\//.test(id) ? id : tpl.includes("{id}") ? tpl.replace("{id}", encodeURIComponent(id)) : id };
    });
}

export function renderScript(draft: DemoDraft): string {
  const { opening, sep, closing } = scriptFrame();
  const out = ["DEMONSTRATION", opening, sep, "", ""];
  draft.stories.forEach((s, i) => {
    if (i > 0) out.push(sep);
    out.push(`${s.key} – ${s.title}`, "");
    const links = testLinks(s);
    if (links.length) {
      for (const l of links) out.push(l.label ? `${l.label}: ${l.url}` : l.url);
      out.push("");
    }
    s.scenarios.forEach((sc, n) => {
      out.push(`Scenario ${n + 1}. ${sc.name}`);
      for (const step of sc.steps) out.push(`* ${step.replace(/^\*\s*/, "")}`);
    });
    out.push("");
  });
  out.push(sep, "", "Closing", ...closing);
  return out.join("\n") + "\n";
}

// ---------------------------------------------------------------- build

const buildDir = (id: string) => dataPath("builds", safeName(id));

export function listBuilds(): BuildMeta[] {
  const dir = dataPath("builds");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((id) => readJson<BuildMeta | null>(`builds/${id}/meta.json`, null))
    .filter((m): m is BuildMeta => !!m)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteBuild(id: string): void {
  if (!fs.existsSync(buildDir(id))) throw new HttpError(404, "Build not found");
  removeFile(`builds/${safeName(id)}`);
}

export function buildFile(id: string, name: "deck.pptx" | "deck.pdf" | "script.md" | "content.json"): string {
  const f = path.join(buildDir(id), name);
  if (!fs.existsSync(f)) throw new HttpError(404, `${name} not found for this build`);
  return f;
}

export function startBuildJob(keys: string[] | null, opts: { screenshots?: boolean } = {}) {
  return startJob("demo-build", 3, async (ctx) => {
    const draft = getDraft();
    const stories = keys ? draft.stories.filter((s) => keys.includes(s.key)) : draft.stories;
    if (!stories.length) throw new Error("Nothing to build — draft at least one story first.");
    const tplId = getSettings().demo.activeTemplateId;
    const tpl = listTemplates().templates.find((t) => t.id === tplId);
    if (!tpl) throw new Error("No active PPT template — upload one in Settings.");

    const id = newId();
    const dir = ensureDir(buildDir(id));
    const withShots = !!opts.screenshots && getSettings().features.recording;
    const shots = Object.fromEntries(stories.map((s) => [s.key, withShots ? slideShots(s.key) : []]));
    const content = {
      glance_title: draft.glanceTitle,
      intro: introContent(draft, tplId),
      stories: stories.map((s) => ({
        key: s.key,
        title: s.title,
        tag: s.tag,
        status: s.status,
        headline: s.headline,
        purpose: s.purpose,
        why: s.why,
        improving: s.improving,
        demo: s.scenarios.map((x) => x.name),
        screenshots: shots[s.key].length ? shots[s.key] : undefined,
        demo_notes: testLinks(s).length ? `Test data: ${testLinks(s).map((l) => (l.label ? `${l.label} ${l.url}` : l.url)).join(" · ")}` : undefined,
      })),
    };
    fs.writeFileSync(path.join(dir, "content.json"), JSON.stringify(content, null, 2));
    ctx.step("Building deck");
    const out = path.join(dir, "deck.pptx");
    const r = await deck(["build", tplFile(tplId), path.join(dir, "content.json"), out]);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).slice(-800) || "deck build failed");

    ctx.step("Checking deck");
    const insp = await inspectFile(out);
    const issues: string[] = [];
    const purpose = insp.slides.filter((s) => s.kind === "purpose");
    const demo = insp.slides.filter((s) => s.kind === "demo");
    if (purpose.length !== stories.length) issues.push(`Expected ${stories.length} purpose slides, found ${purpose.length}`);
    if (demo.length !== stories.length) issues.push(`Expected ${stories.length} demo slides, found ${demo.length}`);
    for (const s of purpose) if (s.screenshots > 0) issues.push(`Slide ${s.n} still has ${s.screenshots} screenshot(s)`);
    demo.forEach((d, i) => {
      const want = shots[stories[i]?.key ?? ""]?.length ?? 0;
      if (d.screenshots !== want) issues.push(`Slide ${d.n}: ${d.screenshots} screenshot(s), expected ${want}`);
    });
    demo.forEach((d, i) => {
      const want = stories[i]?.scenarios.length;
      if (want !== undefined && d.items !== null && d.items !== want) issues.push(`Slide ${d.n}: ${d.items} demo items, expected ${want}`);
    });

    fs.writeFileSync(path.join(dir, "script.md"), renderScript({ ...draft, stories }));
    const meta: BuildMeta = {
      id,
      createdAt: new Date().toISOString(),
      sprintName: draft.sprintName,
      templateName: tpl.name,
      storyKeys: stories.map((s) => s.key),
      check: { ok: issues.length === 0, issues },
      hasPdf: false,
    };
    writeJson(`builds/${id}/meta.json`, meta);
    ctx.step("Done");
    return meta;
  });
}

async function ensureKeynoteRunning(): Promise<void> {
  const isRunning = async () => (await run("osascript", ["-e", 'application "Keynote" is running'], { timeoutMs: 10000 })).stdout.trim() === "true";
  if (!(await isRunning())) await run("open", ["-ga", "Keynote"], { timeoutMs: 15000 });
  for (let i = 0; i < 30 && !(await isRunning()); i++) await new Promise((res) => setTimeout(res, 1000));
  await new Promise((res) => setTimeout(res, 1500));
}

export function startPdfJob(id: string) {
  return startJob("demo-pdf", 1, async (ctx) => {
    const src = buildFile(id, "deck.pptx");
    const dir = buildDir(id);
    const pdf = path.join(dir, "deck.pdf");
    const soffice = (await findBinary("soffice")) || (fs.existsSync("/Applications/LibreOffice.app/Contents/MacOS/soffice") ? "/Applications/LibreOffice.app/Contents/MacOS/soffice" : "");
    let ok = false;
    let err = "";
    if (soffice) {
      ctx.label("LibreOffice export");
      const r = await run(soffice, ["--headless", "--convert-to", "pdf", "--outdir", dir, src], { timeoutMs: 180000 });
      ok = r.code === 0 && fs.existsSync(pdf);
      err = r.stderr;
    }
    if (!ok && process.platform === "darwin" && fs.existsSync("/Applications/Keynote.app")) {
      ctx.label("Keynote export");
      // Keynote is sandboxed: stage files in its own container so it can always read and write them.
      const box = path.join(os.homedir(), "Library/Containers/com.apple.iWork.Keynote/Data/tmp");
      const stage = fs.existsSync(box) ? box : dir;
      const copy = path.join(stage, `dd-${safeName(id)}.pptx`);
      const out = path.join(stage, `dd-${safeName(id)}.pdf`);
      fs.copyFileSync(src, copy);
      // Keynote imports .pptx asynchronously, so `open` can return missing value; wait for the document instead.
      const script = [
        'tell application "Keynote"',
        `  set d to open POSIX file "${copy}"`,
        "  if d is missing value then",
        "    repeat 90 times",
        "      delay 1",
        "      if (count of documents) > 0 then exit repeat",
        "    end repeat",
        "    set d to front document",
        "  end if",
        `  export d to POSIX file "${out}" as PDF`,
        "  close d saving no",
        "end tell",
      ].join("\n");
      // A cold Keynote rejects the open with -600 ("Application isn't running"): start it in the background first.
      await ensureKeynoteRunning();
      let r = await run("osascript", ["-"], { input: script, timeoutMs: 240000 });
      if (r.code !== 0 && /-600\b/.test(r.stderr)) {
        await ensureKeynoteRunning();
        r = await run("osascript", ["-"], { input: script, timeoutMs: 240000 });
      }
      if (fs.existsSync(out)) fs.renameSync(out, pdf);
      fs.rmSync(copy, { force: true });
      ok = r.code === 0 && fs.existsSync(pdf);
      if (!ok)
        err =
          `Keynote could not export the deck (${(r.stderr || "").trim()}). Open Keynote once and dismiss any dialog, ` +
          "allow automation when macOS asks, or install LibreOffice (brew install --cask libreoffice). The .pptx download works either way.";
    }
    if (!ok) throw new Error(err.trim() || "No PDF exporter found — install LibreOffice, or Keynote on macOS.");
    const meta = readJson<BuildMeta>(`builds/${id}/meta.json`, {} as BuildMeta);
    writeJson(`builds/${id}/meta.json`, { ...meta, hasPdf: true });
    ctx.step("Done");
    return { ok: true };
  });
}
