# Dev Dashboard — Implementation Plan

Source spec: `./SPEC.md`. Update this file in place as phases progress.

## Progress tracker

**Progress legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked/needs decision

**Status: IMPLEMENTED (2026-11-03)** — all phases coded; Jira-backed flows await a first run with a real token + board ID.

| Phase | Status |
| ----- | ------ |
| 0 — Scaffold & foundations | ✅ done |
| 1 — Settings (F1) | ✅ done — Jira test/detect/boards, AI CLI detect + test, repos + branch switch, template upload, skills list, glossary |
| 2 — Sprint tickets (F2) | 🔄 implemented — needs real Jira test |
| 3 — Summary (F3) | ✅ verified with Claude + Copilot on a sample ticket; batch/cache path needs real Jira |
| 4 — Code-aware ticket review (F4) | ✅ verified on the 3 local repos (Claude + Copilot, no file written); batch/checklist need real Jira |
| 5 — Sprint Review demo via skill (F5) | ✅ draft → build → check → .pptx/.md download verified · [!] PDF preview: Keynote export failed on the dev machine, LibreOffice not installed |
| 6 — Insights (F6) | 🔄 implemented — needs real Jira test |
| 7 — Extras (F7) | 🔄 implemented — Figma needs a token; usage page verified |

## Implementation notes — deviations from this plan

- **Pages Router + React 18** (not App Router + React 19). Tailwind v4 with preflight off and the `ui-*` colour tokens
  (neutral slate + indigo palette, `ui-*` colour tokens), light mode.
- **No design-system package:** the earlier private design-system dependency was removed, so installs need no
  registry token. UI comes from `src/components/kit.tsx` (Button, Tag, Spinner, Checkbox, Input, Textarea, Toggle, Segmented,
  Tabs, Drawer, Tooltip), `src/components/Select.tsx` (single/multi, searchable, portal-positioned) and
  `src/components/icons.tsx` (lucide-react).
- **JSON files instead of SQLite** in `~/.dev-dashboard/` (settings, secrets, cache, latest, snapshots, templates,
  builds, usage.jsonl) — no native module to build; single-user local app.
- **Secrets:** AES-256-GCM; master key in the macOS Keychain via the `security` CLI (no native keyring dep);
  `DEV_DASHBOARD_MASTER_KEY` env override; `master.key` (0600) fallback off macOS.
- **i18n:** small in-house dictionary (`src/lib/messages.ts`, VI typed against EN keys) instead of `next-intl`.
- **Jobs:** in-process registry polled every 1s by the client instead of SSE.
- **Skill is bundled** in `skills/sprint-demo-prep` (+ `skills/references/architecture.md`) so any dev can run
  it without the INTERNAL `.claude/` folder; the app injects SKILL.md + format + example into the prompt and runs
  `sprint_deck.py` itself. The demo script is rendered deterministically from the skill's format file so
  scenario names always match the slide items.
- **Source repos are local folders only** (no GitHub, no mirror); the AI reads them directly with read-only tools:
  Claude `--tools/--allowedTools Read,Grep,Glob` + `--permission-mode dontAsk`; Copilot `--allow-all-tools` with
  `--deny-tool shell|write|url` (deny always wins, per `copilot help permissions`).
- **`proxy.ts`** rejects non-localhost Host headers and cross-origin writes to `/api/*`.
- **One Tickets page** (2026-11-03, after first use): the separate Review page duplicated Sprint, so it was merged —
  Sprint | JQL source switch, branch badges strip, batch summarize/review and the refinement checklist all live on
  `/sprint`; `/review` redirects there.
- **Standup and burndown removed** from Insights (user request); Insights = sprint health KPIs + risk lists, and the sprint report.
- **Spec tab (F4b)** added on request: implementation-ready spec for a coding agent, saved to
  `.claude/docs/features/<KEY>.md` on demand — the only file the app writes into the workspace, and only on click.
- **Test scenarios, outdated badges, Estimation page (F4c–F4e)** added on request (2026-11-03); verified on
  INTERNAL-8377 (tests ~100 s / $0.34, estimate ticket-only ~90 s / $0.47 → 2 pts vs Jira 3, 3 references).
- **Global job tracker**: summary / review / spec / tests / estimate / demo jobs survive tab switches and navigation; one watcher
  refreshes data and toasts on completion.
- **Field detection** samples the active sprint and picks the most-filled Story Points / AC field, then saves it;
  progress falls back to item counts when the sprint has no points.

## Context & guiding principles

- **Review, not code. Read-only everywhere:** Jira is never written to; the AI only reads source. The single git
  write is the user-triggered branch switch on a local-folder repo (plain `git switch`, no force, no stash).
  Code-side tooling (plans, git, agent launchers) stays in the VS Code extension `tools/workspace-dashboard`.
- **Local-first.** The deck script (Python) and the AI CLIs run on the developer's machine. Next.js binds
  `127.0.0.1`; no auth layer.
- **Stack:** Next.js 16 (App Router, Turbopack) + React 19 + TypeScript + Tailwind v4 + Zustand (UI state) +
  TanStack Query (REST). External calls only in Node-runtime route handlers / server actions.
  Next 16 notes: async `params`/`searchParams`/`cookies()`, `proxy.ts` replaces `middleware.ts`,
  `better-sqlite3` in `serverExternalPackages`.
- **AI = CLI only, no API keys.** `AiRunner.run({ prompt, cwd, readOnly, schema })` with two impls:
  - Claude: `claude -p --output-format json [--allowedTools "Read,Grep,Glob"]`
  - Copilot: `copilot -p … --allow-all-tools` (required for non-interactive) plus deny rules for write/shell
    tools — exact flags verified against `copilot --help` in P1 (see risks).
  Output validated with zod, one retry with the validation error, raw output shown on failure.
- **Skill reuse, not copies:** F5 drives `.claude/skills/sprint-demo-prep` (SKILL.md, `scripts/sprint_deck.py`,
  `assets/content.example.json`, `references/demo-script-format.md`) from the workspace root, which both
  CLIs load natively. F2 ports the ADF→text logic of `jira-story-breakdown/scripts/extract_fields.py` to TS.
- **Global language** EN | VI: UI via `next-intl` (cookie locale, no locale routes); AI outputs generated as
  `{ en, vi }` once and cached; the switch only changes what's displayed.
- **Dark theme tokens** in `globals.css` (Tailwind v4 `@theme`): `bg #0b0d10`, `surface #12151a`,
  `surface-2 #181c22`, `border #262b33`, `text #e6e9ee`, `text-muted #9aa4b2`, `accent #6ea8fe`,
  `ok #4cc38a`, `warn #e5b454`, `danger #f07178`. Contrast checked in P0; components use tokens only.
- **Secrets** (Jira token, optional Figma PAT): AES-256-GCM in SQLite, master key in the
  macOS Keychain (`@napi-rs/keyring`), fallback env `DEV_DASHBOARD_MASTER_KEY`. API returns only `{ set, last4 }`.

### Target layout
```
AgileSupporter/
  app/
    [shell]/layout.tsx                # header: language switch, sprint, connection dots · sidebar
    sprint/  review/  demo/  insights/  settings/   page.tsx
    api/{settings,jira,ai,repos,review,demo,insights,jobs}/**/route.ts
  src/
    server/
      db/            # better-sqlite3 + drizzle (settings, secrets, templates, ai_cache, ticket_snapshots, demo_builds, jobs, ai_usage)
      secrets/
      jira/          # read-only client + mappers
      repos/         # local path config, git status / branches / switch / fetch
      ai/            # AiRunner: claude-cli, copilot-cli
      jobs/          # in-process queue + SSE progress
      demo/          # venv bootstrap, skill runner, deck build/inspect, pdf export
    features/<sprint|summary|review|demo|insights|settings>/
    i18n/            # en.json, vi.json
    lib/             # adf, fetchJson, zod schemas, prompts (versioned)
  docs/SPEC.md, docs/PLAN.md
```
Data home `~/.dev-dashboard/`: `db.sqlite`, `venv/`, `templates/`, `builds/`.

## Blocker - Risks / watch-outs

- [!] Jira board ID + Story Points / AC field IDs for the new project — needed before P2.
- [!] New project's PPT template must keep the glance / purpose / demo structure `sprint_deck.py` expects;
  the upload-time `inspect` will tell — if not, the skill needs a slide-kind mapping first.
- [!] Copilot `-p` needs `--allow-all-tools`. If its deny flags can't reliably block write/shell tools, Copilot is
  not offered for repo-reading tasks (Review, demo skill run) — Claude only there, Copilot still fine for Summary.
  Claude is safe via `--allowedTools "Read,Grep,Glob"`.
- Reviewing a local folder reads the current checkout, incl. uncommitted changes → results carry branch + commit +
  dirty flag so a stale/odd review is explainable; cache key includes them.
- Local-folder paths differ per machine → stored per machine in the local DB, never in the repo; a moved/deleted
  folder shows a clear "path missing" status instead of failing reviews silently.
- CLI JSON reliability → zod + retry; large repos → review prompts point the AI at the relevant module first
  (ticket keywords → `grep`), and use `jira-story-breakdown/references/architecture.md` as the map.
- Code-aware review is slow (agentic reads) → runs as a job with progress; cached by ticket `updated` + repo commits.
- LibreOffice may be missing → Keynote fallback or skip preview with a clear message.

## Implementation Phases

### Phase 0 — Scaffold & foundations
- [x] `create-next-app@16` (TS, Tailwind v4, App Router, ESLint); `dev`/`start` bind `-H 127.0.0.1`
- [x] Dark theme tokens + base components (button, badge, select, toast, drawer, table) using tokens only;
      verify contrast (text ≥ 12:1, muted ≥ 4.5:1)
- [x] Shell: sidebar (Sprint · Review · Demo · Insights · Settings), header with **EN | VI switch**, connection dots
- [x] Toast system (success / error, error toasts stay until dismissed and show the raw message)
- [x] `next-intl` with cookie locale; `en.json` / `vi.json`; every UI string through it from day one
- [x] SQLite + drizzle schema + migration on boot
- [x] `secrets` module + unit tests
- [x] Job runner + `/api/jobs/[id]/events` SSE; `useJob(id)` hook
- **Done when:** app runs locally, switching EN/VI re-labels the whole shell, a dummy job streams progress.

### Phase 1 — Settings (F1)
- [x] Jira section: save + Test (`/rest/api/3/myself`); field auto-detect via `expand=names`
- [x] AI section: detect `claude` / `copilot` on PATH, version + login check, default picker, Test prompt;
      confirm Copilot read-only flags from `copilot --help`
- [x] Source repos section (local folders only; 3 defaults + protobuf optional)
  - Path text input → server validates (`git -C <path> rev-parse --show-toplevel`); auto-suggest sibling folders
    of the workspace root
  - `GET /api/repos/[key]/status` → `{ branch, headSha, dirty, ahead, behind }`; current branch rendered as a
    highlighted accent badge, dirty marker beside it; refetch on window focus
  - `GET /api/repos/[key]/branches` → local branches, then remote-tracking (`git for-each-ref refs/heads refs/remotes`)
  - `POST /api/repos/[key]/fetch` → `git fetch` (developer's own credentials); error toast on failure
  - `POST /api/repos/[key]/switch { branch }` → `git switch <branch>` (remote-tracking → `git switch --track origin/<b>`);
    no `--force`, no stash; on non-zero exit return git's stderr → error toast, badge unchanged; success toast otherwise
  - Per-repo status dot (ok / path missing / not a git repo)
- [x] Template section: upload `.pptx`, list, set active, delete; `inspect` summary on upload
- [x] Glossary editor
- **Done when:** Jira + AI test green, every repo path validates and shows its branch badge, a branch switch
  succeeds (and a blocked one shows git's error toast), a template uploads and shows its slide kinds,
  and no response body ever contains a secret.

### Phase 2 — Sprint tickets (F2)
- [x] Jira client: `/rest/agile/1.0/board/{id}/sprint?state=active,future,closed`,
      `/rest/agile/1.0/sprint/{id}/issue?fields=…&expand=names` (paginate)
- [x] `src/lib/adf.ts` (port of `extract_fields.py`) + tests on real samples
- [x] Mapper → `Ticket { key, type, summary, status, assignee, points, parentKey, ac, description, links, attachments, updated }`
- [x] Sprint picker + ticket tree with collapse/expand row + all
- [x] Filters + group-by in Zustand, mirrored to the URL
- [x] Detail drawer; snapshot saved on open (feeds "what changed")
- **Done when:** the active sprint renders as a tree matching Jira; filters survive reload.

### Phase 3 — Summary (F3)
- [x] `AiRunner` (claude-cli, copilot-cli) with timeout, zod validation, retry, usage row
- [x] Prompt + schema `{ en: {summary, ac[], areas[], rules[], edgeCases[]}, vi: {…} }`, glossary injected, `promptVersion`
- [x] Cache by `key + updated + promptVersion`
- [x] Summarize in drawer; batch selected / all as a job (concurrency 2, SSE progress)
- [x] Rendering follows the global language; Copy as text / markdown; Regenerate
- **Done when:** summarizing the whole sprint a second time makes zero AI runs.

### Phase 4 — Code-aware ticket review (F4)
- [x] Review job: run AI read-only over the configured local repo folders with ticket + F3 summary +
      `architecture.md` as context
- [x] Review page header: per-repo branch badges currently in effect (+ dirty marker)
- [x] Schema: `currentBehavior[{ en, vi, refs[] }]`, `findings[{ kind, severity, quote, refs[], suggestion{en,vi} }]`,
      `questions[{ en, vi }]`, `impact[{ repo, area }]`, `reviewedAt{ repo: { branch, commit, dirty } }`
- [x] Drawer tab "Review" + severity badge on the tree row; file refs open the local file at the line (`vscode://file/<path>:<line>`)
- [x] Questions editor (edit, reorder, Copy EN)
- [x] "What changed" diff vs last snapshot (summary / description / AC), word-level highlight
- [x] Review page: sprint or JQL → batch review → refinement checklist `.md` download
- [x] Cache by `key + updated + per-repo (branch, commit, dirty) + promptVersion`
- **Done when:** a real ticket's review cites real files, and at least one question references existing behavior.

### Phase 5 — Sprint Review demo via skill (F5)
- [x] Python bootstrap: detect `python3`, create `~/.dev-dashboard/venv`, install `python-pptx`
- [x] Skill runner: AI CLI in the workspace root, prompt = "use the sprint-demo-prep skill, sections 3 + 5 only;
      here are the tickets (from F2/F3); return content.json + demo script markdown; don't fetch Jira, don't build"
- [x] Demo page: active template's `inspect` summary + ticket multi-select from the sprint
- [x] Review form: skill's field table + length guards, reorder, test B/L ID, tag, status from Jira;
      script scenarios stay in sync with demo items
- [x] Apply one / all → skill's `sprint_deck.py build` into `~/.dev-dashboard/builds/<id>/` → `inspect` structural check
- [x] PDF preview (LibreOffice headless → Keynote fallback) in-page
- [x] Download `.pptx` + script `.md`; build history with re-download / rebuild
- **Done when:** a real sprint's deck + script come out of the UI matching what the skill produces in a chat session.

### Phase 6 — Insights (F6)
- [x] Sprint health: points/items done, days left, carry-over risk, blocked/flagged (burndown dropped)
- [x] Sprint report: DONE tickets by epic → markdown download
- **Done when:** sprint health and the sprint report load for the selected sprint.

### Phase 7 — Extras (F7)
- [x] Figma link detection + thumbnails (`/v1/images/{fileKey}`, optional PAT)
- [x] AI usage page (runs, duration, cache hit rate)
- **Done when:** each item works behind its own toggle in Settings.
