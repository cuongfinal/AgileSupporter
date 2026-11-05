---
name: sprint-demo-prep
description: Prepare the INTERNAL Sprint Review demo — rewrite the Demonstration slides of the "[INTERNAL] [Sprint Review] Sprint N.pptx" deck from Jira stories (at-a-glance cards + a Purpose slide and a WHAT WE'LL DEMO slide per story, old screenshots removed) and write the presenter's demo script .md in the team's DEMONSTRATION / Scenario format. Use this whenever the user mentions sprint review, sprint demo, demo slides, demo script, the Sprint Review pptx, or lists INTERNAL ticket numbers to "put in the deck" / "soạn demo script" / "sửa slide demo" — even if they only ask for one of the two outputs.
---

# Sprint demo prep (INTERNAL Sprint Review)

Two deliverables, both built from the sprint's Jira stories:

1. **The deck** — the Demonstration section of the Sprint Review `.pptx` rewritten for this
   sprint's stories, with old screenshots removed (the user captures new ones later).
2. **The demo script** — a `.md` the presenter reads while clicking through the app.

The slide's WHAT WE'LL DEMO items and the script's `Scenario N.` names are the same list, so
write the scenarios once and use them in both.

## 1. Gather inputs

- **Deck**: usually `~/Downloads/[INTERNAL] [Sprint Review] Sprint <N>.pptx`. Find it with
  `ls ~/Downloads | grep -i "sprint review"`; if several match, ask which one.
- **Tickets**: the Jira keys the user lists (`828` means `INTERNAL-828`). Fetch each with the
  workspace Jira script, from the workspace root:
  ```bash
  bash .claude/skills/jira-story-breakdown/scripts/fetch_issue.sh INTERNAL-828 \
    | python3 .claude/skills/jira-story-breakdown/scripts/extract_fields.py
  ```
  It needs `JIRA_EMAIL` + `JIRA_API_TOKEN` in the env (or a `.env` in the cwd). On exit 2 (no
  credentials), stop and ask the user to export them or paste the story text, and don't write
  slides from a guessed ticket. A `! export …` the user runs doesn't carry into your own Bash
  calls, so pass the values they gave inline in the same command as the fetch.
- **What was actually built**: if `.claude/docs/features/INTERNAL-<key>.md` or
  `.claude/docs/features/plans/INTERNAL-<key>-*.md` exist, read their scope section. Stories get
  narrowed during development (INTERNAL-6208 dropped two of its five rules), and the demo should
  only show what shipped. Note the ticket status too. Anything not TESTED / DONE gets its real
  status on the glance badge (e.g. `IN QA`) and goes in your final message.
- **Test B/L IDs** for the script links: the AC example tables often name real TEST-environment
  B/Ls (`ZHOV31733501`, with the party and customer code), so use those first, then any the
  user gives. Otherwise write `blId=<BL_ID>` and list the gaps in your final message. Don't
  invent IDs.
- **Demo order**: follow any run order in the tickets' testing notes, e.g. save → edit →
  delete, because a delete can't be undone. Otherwise keep related stories together.

## 2. Inspect the deck

python-pptx is needed. If `python3 -c "import pptx"` fails, make a venv in the scratchpad
(`python3 -m venv <scratch>/venv && <scratch>/venv/bin/pip install python-pptx`) and use its
python for the commands below.

```bash
python scripts/sprint_deck.py inspect "<deck.pptx>"
```

This lists each slide's kind (`glance`, `purpose`, `demo`, `other`), screenshot count and
notes, and which existing Purpose/Demo pair will be cloned as the template. The script only
touches the glance slide and story slides. Sprint Data, Sprint Goal, Feedback and Next Sprint
slides belong to other presenters, so leave them alone. Only change the cover if the user
asks (`cover` key below).

## 3. Write the slide content

Write a `content.json` in the scratchpad (shape: `assets/content.example.json`). One entry
per story, in the order they'll be demoed. Match the voice of the existing slides, which is
plain language for a business audience rather than developer wording:

| Field | What it is | Guidance |
|---|---|---|
| `key` | `INTERNAL-828` | |
| `title` | slide title after `INTERNAL-xxx ·` | An action phrase rewritten from the Jira summary, ≤ ~70 chars: "Break down the package units on the B/L cargo total". Drop the "As a … I want" framing. |
| `headline` | two-part hook `[lead, rest]` | Lead in dark blue, rest in default. Short and concrete: `["One number, ", "now you can see what it holds"]`. |
| `purpose` | text after "Purpose:" | One sentence: "Let an Outbound Documentation Agent <do X>, <instead of / so that …>." |
| `why` | text after "Why it matters:" | 2–3 sentences: today's pain, then the payoff. Keep it under ~45 words or it overflows the box. |
| `improving` | WHAT WE'RE IMPROVING panel | One sentence on the concrete behaviour change. |
| `demo` | WHAT WE'LL DEMO items | 2–6 scenario names, sentence case, ≤ ~60 chars each. These become the script's scenario names. |
| `tag` | optional, default keeps `IMPROVEMENT` | e.g. `NEW FEATURE`, `BUG FIX`. |
| `status` | optional glance badge, default `✓ BUILT` | |
| `demo_notes` / `purpose_notes` | optional speaker notes | Put the test B/L link(s) in `demo_notes`. |
| `glance_title` (top level) | e.g. `Sprint 22–23 at a glance` | Take the sprint number from the deck file name. |
| `cover` (top level, optional) | `{"title": "...", "dates": "..."}` | Only when the user asks. |

Bug and NFR tickets go in the deck too if the user listed them. Frame them the same way:
what the agent couldn't do before, and what they can do now.

## 4. Build the deck

```bash
python scripts/sprint_deck.py build "<deck.pptx>" <scratch>/content.json "<out.pptx>"
python scripts/sprint_deck.py inspect "<out.pptx>"     # verify
```

Write to a **new file** next to the original, e.g. `... Sprint 22_23 (demo).pptx`, so the
user's deck stays intact until they've looked. Only overwrite the original if the user asks.
`build` deletes every old story slide, clones the template pair once per story, fills in
the text, removes screenshots, renumbers or adds demo items (the spacing compresses to fit), fills
the glance cards in reading order, deletes unused cards, and adds a second glance slide if
there are more stories than cards.

Check the second `inspect`: one purpose and one demo slide per story, `screenshots=0`, and item
counts that match. Then check the layout by eye. Export a PDF with Keynote
(`osascript -e 'tell application "Keynote"' -e 'set d to open POSIX file "<copy.pptx>"' -e 'export d to POSIX file "<out.pdf>" as PDF' -e 'close d saving no' -e 'end tell'`,
run on a scratchpad copy) and Read the story pages. Look for headlines wrapping to two lines,
Why-it-matters overflowing its box, and leftover card pieces on the glance slide. Shorten the
text in `content.json` and rebuild. If the user only wants the old screenshots removed (no rewrite), use
`python scripts/sprint_deck.py strip "<deck.pptx>" "<out.pptx>"`.

## 5. Write the demo script

Follow `references/demo-script-format.md` exactly: the fixed opening and closing, the
separators, `INTERNAL-xxx – Title`, test links, and `Scenario N.` blocks with `* I …` /
`* I can see …` bullets drawn from the acceptance criteria. Save it next to the deck as
`[INTERNAL] [Sprint Review] Sprint <N> - Demo Script.md`, unless the user names another path.

## 6. Report back

Keep it short. Give both output paths and the stories covered, in order. List anything left
as a placeholder (missing B/L IDs, tickets that couldn't be fetched) and any judgement calls,
such as an AC dropped because it can't be demoed. Remind the user that the demo slides have
no screenshots yet.
