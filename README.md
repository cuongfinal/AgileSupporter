# Dev Dashboard

Local web app for INTERNAL developers: read the sprint from Jira, get EN/VI summaries, review tickets against the
current source code, and build the Sprint Review deck + demo script. It never writes to Jira or edits code.

Spec and plan: [`docs/SPEC.md`](docs/SPEC.md), [`docs/PLAN.md`](docs/PLAN.md).

## Requirements

- Node 20+ and npm
- Logged-in **Claude Code** (`claude`) and/or **GitHub Copilot CLI** (`copilot`). No API key is needed.
- Python 3, used by the deck builder. The app creates its own venv with `python-pptx`.
- Optional: LibreOffice or Keynote, for the in-app PDF preview.

## Install and run

```bash
cd AgileSupporter
npm install                                  # public npm only — no registry token needed
npm run dev                                  # http://127.0.0.1:4310
```

In VS Code, open the workspace file and run the task **Dev Dashboard: start**.

The server only listens on `127.0.0.1`. `src/proxy.ts` rejects other Host headers and cross-site writes.

## First-time setup (Settings page)

1. **Jira**: enter the email, API token and **board ID** (use *Find* to list boards). Click *Detect* to fill
   the Story Points, AC and Flagged fields, then *Test connection*.
2. **AI**: pick Claude or Copilot and click *Test*.
3. **Source repos**: the paths are filled in automatically when the repos sit next to `tools/`. Otherwise type
   the local path for each repo. The highlighted badge shows the branch that will be reviewed. Use the
   dropdown to switch branch. Switching is a plain `git switch`; git's error is shown if it refuses.
4. **PPT template**: click *Install Python deps* once, then drop the Sprint Review `.pptx`.

## Optional: demo recording (beta)

Turn on **Settings → Features → Demo recording**. It needs Google Chrome (or click *Install browser* for Playwright
Chromium), and an OpenAI or ElevenLabs API key for the voice. On the Sprint demo page: sign in to the test site once,
let the AI write each story's flow, review + approve it, then **Record**. Flows only navigate inside the configured
app URL and never run until approved.

## Where data lives

All data lives in `~/.dev-dashboard/` (override with `DEV_DASHBOARD_HOME`): settings, encrypted tokens, AI
cache, ticket snapshots, templates, builds, `usage.jsonl` and the Python venv. Tokens are encrypted with
AES-256-GCM. The master key is kept in the macOS Keychain (service `dev-dashboard`), or in
`DEV_DASHBOARD_MASTER_KEY` if set.

## Layout

```
skills/            bundled sprint-demo-prep skill + references/architecture.md (review map)
src/pages/         UI pages (sprint = Tickets incl. review, demo, insights, usage, settings) + api/ routes
src/server/        jira, ai (claude/copilot CLI runner), repos (git), demo (deck/script), insights (health/report), secrets
src/features/      ticket drawer, sprint picker, repo branch badges
src/lib/           shared types, i18n messages (EN/VI), ADF→markdown, client helpers
```

## Troubleshooting

- **PDF preview fails**: install LibreOffice (`brew install --cask libreoffice`), or open Keynote once,
  dismiss any dialog and allow automation when macOS asks. The `.pptx` and script downloads work either way.
- **"CLI not found"**: set the binary path under Settings → AI. The server may run with a shorter `PATH`
  than your shell.
- **Review takes minutes**: this is expected, because the AI reads the code. Results are cached per ticket
  version and per repo branch/commit.
