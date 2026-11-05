# Dev Dashboard — Spec

A local web app that helps developers **understand and review work faster** — not write code.
It reads the sprint from Jira, summarizes and reviews tickets (grounded in the current source of the
three main repos), and builds the Sprint Review demo slides + demo script with the `sprint-demo-prep` skill.

## Goals
- See "what's in this sprint and what does each ticket really ask" in minutes, in EN or VI.
- Catch weak specs early, with questions precise enough to answer because they cite existing behavior in code.
- Cut Sprint Review prep to: pick tickets → review text → download deck + script.

## Non-goals
- Writing back to Jira — read-only, except the opt-in F2b Kéo Task (sprint sub-task status + the 2 optional AI tracking fields); never comments or anything else.
- Git workflow: no PRs, CI, commits, pushes, branch creation or deletion. The only git write is the explicit
  **branch switch** in Settings (F1). The AI only ever reads source.
- Code generation or code agents.
- Multi-user hosting (local-first, single user, `127.0.0.1` only).
- Editing the non-demo slides of the deck (Sprint Data, Goal, Feedback, Next Sprint).

## Global
- **Dark UI** (dark-only in v1): near-black background, layered dark surfaces, high-contrast text.
  Body text ≥ 12:1 contrast, muted text ≥ 4.5:1 (WCAG AA), one accent colour, status colours tuned for dark.
- **Language switch EN | VI in the header** applies to the whole app: UI strings and every AI output
  (summaries, review findings, questions). AI results are generated in both languages once and
  cached, so switching is instant. Deck + demo script are always English (business audience); questions
  for PO/BA always offer **Copy EN**.
- Glossary (Settings) keeps domain terms consistent in both languages (e.g. B/L, manifest stay as-is).

## Features

### F1 — Settings
- **Jira:** base URL, email, API token, board ID, project key; Story Points + AC fields auto-detected
  from `expand=names`, overridable. **Test connection.**
- **AI:** detects the installed + logged-in CLI — Claude Code (`claude`) or GitHub Copilot (`copilot`).
  No API key. Pick the default; shows version + login status; **Test** runs a tiny prompt.
- **Source repos (local folders, read-only):** frontend, backend, BFF (+ optional protobuf) — folder names and
  paths are set per machine, no defaults. No GitHub connection, no token, no mirror.
  - **Path** typed in per repo (folders differ per machine); server validates it is a git repo. Suggested
    automatically when a sibling folder of the workspace exists.
  - The AI **reads the folder directly**, read-only — whatever is checked out is what gets reviewed.
  - The **current branch is shown as a highlighted badge** next to the path (plus HEAD commit and a "dirty"
    marker when there are uncommitted changes). Refreshed when the page regains focus, so a checkout done in a
    terminal shows up.
  - **Branch dropdown** lists local branches, then remote-tracking branches already known locally (switching to
    one creates its local tracking branch). An optional **↻ Fetch** runs `git fetch` with the developer's own git
    credentials to refresh that list. Switching runs a plain `git switch` — never `--force`, never an auto-stash.
    If git refuses (uncommitted changes would be overwritten, branch missing, lock file…), an **error toast** shows
    git's message and the badge stays on the old branch.
- **PPT template:** upload `.pptx` (drag & drop). Several can be kept; one is marked active. On upload the
  app runs `inspect` and shows the slide kinds found (glance / purpose / demo) so a bad template is caught early.
- **Glossary:** term, EN, VI, keep-as-is.

### F2 — Sprint tickets
- Sprint picker (active / future / recent closed) for the configured board.
- Tree: Story/Bug/Task → Subtasks, collapse/expand per row + all.
- Filters: status, assignee, type, "mine", free-text; group by status or assignee.
- Row: key, type, summary, status, assignee, story points, review-flag badge (F4), "changed" dot.
- Detail drawer: description + AC rendered from ADF, linked issues, attachments list, Open in Jira.

### F2b — Kéo Task (page `/tasks`; the only Jira write; Settings → Features → "Jira write", off by default)
- Lists the sub-tasks of the picked sprint (`issuetype in subTaskIssueTypes()`), filtered by member — me by default,
  any members with sub-tasks in the sprint, or all — with assignee, current status, current
  AI tracking fields (when configured), and the Jira edit/transition permissions.
- AI tracking fields are optional (Settings → Features → Jira write: action field, action value, score field — exact Jira
  names, no defaults). When set, → Done first writes the action value and Score = 4 or 5 (random, shown in the preview;
  "re-roll" to change) — the Done transition's validator requires both — then move. No tag-based rules; the person picks rows.
- Move = the transition into the status "Done" (never Cancelled). When Done isn't reachable from the current status
  (e.g. TO DO), it walks forward through in-progress statuses (max 6 steps, never back) and reports the path.
- Per-row "Move to" picker, defaulting to the current status (= no change): Done (the flow above) or any status reachable in one transition from the current one —
  Done rows too. Cancelled clears the AI fields; other statuses leave them as they are (if a validator asks for them they
  are filled just for the move and cleared again when they were empty). A bulk picker sets the target for all ticked rows
  (only rows that can reach it). Rows already in the picked status are skipped.
- Two-step confirm; the server re-reads each issue before writing. Writes only `PUT /issue/{key}` (those 2 fields) and
  `POST /issue/{key}/transitions` — every other Jira call stays GET.

### F3 — Summary
- Per ticket or batch (selected / all): summary paragraph, AC checklist, affected screens/areas,
  business rules, edge cases — in the global language.
- Cached by `issueKey + fields.updated + promptVersion`; Regenerate on demand.

### F4 — Ticket / spec review (code-aware)
- The AI reads the ticket **and the local source of the selected repos** (read-only) before answering.
- **Current behavior:** what the code does today for this area, with file references.
- **Quality check:** missing / ambiguous / untestable AC, contradictions between description and AC,
  and **conflicts with existing code** (validation, enum, field, flow already behaving differently).
  Each finding: severity, quoted sentence, file refs, suggestion.
- **Questions for PO/BA:** grounded in the findings, editable, Copy EN.
- **Likely impact:** which repos/modules the ticket touches (informational, not a plan).
- **What changed:** diff vs the version I last viewed.
- **Refinement prep:** batch review over a sprint / JQL → one markdown checklist download.
- Every result records, per repo, the branch + commit it was reviewed against (and "dirty" if local changes
  were present); the Review page header shows the branches currently in effect.

### F4b — Implementation spec for a coding agent
- Drawer tab **Spec**: the AI reads the ticket, its summary, the latest review and the current source (read-only)
  and writes a markdown spec in the team's format (Summary · Scope + Projects in scope · Business rules · AC ·
  Current state per repo with `repo/path:line` refs · Implementation outline per in-scope project · Decisions ·
  Open questions).
- Copy markdown, download `.md`, or **Save to workspace** → `.claude/docs/features/<KEY>.md` (two-step overwrite
  if the file exists) so Claude Code / Copilot pick it up through the CLAUDE.md feature workflow.
- Cached by ticket version + repo branch/commit + review version.

### F4c — Test scenarios
- Drawer tab **Test scenarios**: the AI turns the AC into Given/When/Then scenarios (happy · edge · negative ·
  permission · regression, with priority, covered AC numbers and test data) plus an **AC coverage** list (uncovered
  AC in red) and **gaps** QA still needs. No code access; uses the latest review's code facts for boundary values.
- Filter by type, copy markdown, download CSV (UTF-8 BOM for Excel) in the current language.
- Cached by ticket content hash + review version + glossary.

### F4d — Outdated results
- Review, spec and test scenarios store a hash of the ticket's summary + description + AC. When it changes, the
  drawer tab shows ⚠ and a banner with **Re-run**; the Tickets list shows an *Outdated* tag next to review counts.
- Old records without a hash fall back to "ticket updated after this" (softer banner, not shown in the list).
- A spec is also outdated when the review was re-run after it.

### F4e — Estimation (page `/estimate`)
- Enter one or more story keys / Jira links → load the story (content collapsible) → **Estimate**.
- The AI proposes story points on 0.5·1·2·3·5·8·13·21 with a range and confidence, an analysis, a task breakdown
  per project (XS–XL), reasons (↑/↓), 1–3 comparable done stories, risks, assumptions, questions, and a split
  proposal when ≥ 13.
- Calibration: the team's last 150 done Stories with points (JQL, cached 6 h). The prompt gets the team's point
  distribution + median, the 12 most similar stories (word overlap, same epic/label bonus) with an excerpt, and the
  rest as one-liners. Procedure: pick references by size of change → anchor on their median → adjust ≤ 1 step for a
  named difference → prefer the lower value; routine work (tests, QA, review) never adds points.
- Anchor guard (server): the final points stay within one step of the median Jira points of the references the AI
  picked (made-up references are dropped); the UI shows the anchor and "AI proposed X → Y" when it was clamped.
- Backtest 2026-11-03 (5 done stories, ticket only): exact on 5 and 8 pts, +1 step on 1/2/3-pt stories; code-aware
  inflation fixed (INTERNAL-127 8→5, INTERNAL-7248 5→3). The current Jira points are hidden from the prompt to avoid anchoring and shown next to the
  AI number with the difference.
- **Read source code** toggle (default on when repos are set): code-aware like Review; off = ticket only.
- **Next sprint backlog** card: preloads the first future sprint (switchable), Stories only by default, multi-select
  (quick picks: not yet estimated / no Jira points) → one batch estimate; Jira vs AI points side by side.
- Input accepts bare numbers (`8376` → `<project key>-8376`, project key from Settings; without one only full keys are accepted).
- History of recent estimates: running ones stay listed, delete per item or clear all (AI cache kept, so
  re-estimating an unchanged story is instant). A 2-line "in short" answer for planning. Never written to Jira.

### F5 — Sprint Review demo (via `sprint-demo-prep` skill)
- Select tickets (or all) and the active template.
- Draft step runs the `sprint-demo-prep` skill with the AI CLI, passing the ticket content from F2 (no
  second Jira fetch); it returns `content.json` (per story: `key, title, headline[2], purpose, why,
  improving, demo[], tag, status, demo_notes`) and the demo script `.md` in the skill's format
  (`references/demo-script-format.md`: fixed DEMONSTRATION opening, separators, `INTERNAL-xxx – Title`, test
  link, `Scenario N.` blocks with `* I …` / `* I can see …`).
- **Review form:** edit every field with the skill's length guards (title ≤ ~70 chars, why ≤ ~45 words,
  2–6 demo items ≤ ~60 chars), drag-to-reorder, test B/L ID per story, status badge from Jira (anything not
  TESTED/DONE shows its real status). Script scenario names follow the demo items.
- Apply one story or all → skill's `sprint_deck.py build` → `inspect` check (1 purpose + 1 demo slide per
  story, 0 screenshots) → in-page PDF preview → **Download .pptx** and **Download script .md**.
- Builds are kept in a history list (re-download, rebuild from saved content).

### F5b — Demo recording (optional, beta — Settings → Features → "Demo recording", off by default)
- Settings: demo app URL (test environment), browser (system Chrome by default — best with SSO — or Playwright
  Chromium), video size, TTS provider (OpenAI `gpt-4o-mini-tts` + voice + speaking style, or ElevenLabs voice ID +
  model) with encrypted API keys and a "Listen to a sample" button.
- Sprint demo page → **Record demo** card with per-run toggles: *Screenshots on the slides*, *Record video*,
  *AI voice narration* (needs video). All off/absent = the page behaves exactly as before.
- Login: "Sign in to the test site" opens a visible browser; the person signs in (SSO) and clicks "save session";
  Playwright `storageState` is stored in `~/.dev-dashboard/demo/session.json` (0600). The app never handles passwords.
- Flow per story: the AI reads the frontend repo (read-only) and writes a replayable JSON flow (scenarios → steps →
  narration + actions: goto/click/fill/select/press/hover/waitFor/scroll/wait/resize, targets by role/label/text/
  testId/css). A person reviews it (step view or JSON) and ticks **Approved**; unapproved flows or flows with a
  `TODO_*` placeholder never run. Navigation outside the app URL's origin is refused. The prompt forbids delete/
  cancel/send/approve actions on the shared test environment.
- Record: headless Playwright replays the flow with a visible cursor and scenario banners; narration is synthesised
  first and each step stays on screen for its narration length; screenshots on flagged steps (cursor/banner hidden);
  ffmpeg (`ffmpeg-static`) muxes the narration clips at their offsets into one H.264/AAC mp4. A failed step saves an
  error screenshot and skips the rest of that scenario.
- Results per story: video player + MP4 download, screenshot thumbnails — tick up to 3 for the WHAT WE'LL DEMO slide;
  the deck build places them in the template's screenshot area (`sprint_deck.py place_screenshots`).

### F6 — Insights (Jira, read-only)
- Sprint health: points/items done, days left, carry-over risk, blocked / flagged tickets.
- Sprint report: DONE tickets grouped by epic → markdown download (feeds the Sprint Data slide).

### F6b — Sprint retro (page `/retro`)
- Facts from Jira only (sprint issues + changelog, no AI): done vs total vs committed at start (items added > 12 h after the
  sprint start count as added), not done / carried out, carried in, reopened after Done, re-estimated, requirement edits
  (summary / description / AC) after the start, flagged / blocked, bugs created in the sprint, cycle time (first In progress →
  start of the final Done streak; median + slowest), unpointed, velocity of the 3 previous sprints, stories whose spec review
  has high-severity findings.
- "Generate cards": one AI call (no tools) turns the facts + optional team notes into bilingual cards in 3 columns —
  Went well / To improve / Action items — each with ticket evidence (filtered to keys in the facts) and a metric.
  Process-focused, never names people. Regenerating keeps cards a person added, edited or pushed.
- Cards can be edited, moved between columns, added, deleted. Copy (card or column, one line per card) marks them as
  pushed; "hide pushed", copy all as markdown, CSV. Stored in `~/.dev-dashboard/retro/<sprintId>.json`; a banner shows when
  the sprint changed since the cards were made. Nothing is written to Jira.

### F7 — Extras
- Figma: detect Figma links in tickets, show frame thumbnails (Figma PAT, optional).
- AI usage log: runs, duration, cache hits per day.

## Constraints
- Python 3 + `python-pptx` for the skill's deck script (auto-provisioned venv). PDF preview via LibreOffice
  headless, Keynote fallback on macOS.
- The skill and its script are read from the workspace (`.claude/skills/sprint-demo-prep`), not copied.
- AI CLIs run non-interactively with read-only tools directly in the local repo folders. A CLI that can't be
  restricted to read-only is not offered for repo-reading tasks (see PLAN risks).
- Jira custom field IDs differ per instance — never hard-code.
