# Demo script format

The presenter reads this file aloud while clicking through the app, so it is written in the
first person, as actions followed by what the audience should see. Keep the fixed opening and
closing word for word — the team reuses them every sprint.

## Skeleton

```
DEMONSTRATION
Good morning everyone. Today, I'd like to walk you through the user stories we completed in this sprint. I'll briefly introduce each story, explain what has changed, and then demonstrate the key scenarios directly in the system. Let's get started with the first user story.
————————————————————————————————————————————————————————————————————————


INTERNAL-XXXX – <story title, same wording as the slide title>

https://<test-app>/bill-of-lading?blId=<BL_ID>

Scenario 1. <scenario name, same wording as demo item 1 on the slide>
* I <set-up action: open a B/L, go to a section, select something>.
* I can see <the observable result>.
* I <change something>, and can see <the result follows>.
Scenario 2. <...>
* ...

————————————————————————————————————————————————————————————————————————
INTERNAL-YYYY – <next story>
...

————————————————————————————————————————————————————————————————————————

Closing
That concludes all the user stories completed in this sprint.
Before moving on to the next topic, I'd be happy to answer any questions or hear any feedback regarding these enhancements.
```

## Rules

- Separator: the long em-dash line (`—` × 72) between stories. Story heading uses an en dash: `INTERNAL-5496 – Title`.
- Test link(s) go right under the heading. Several B/Ls are fine when scenarios need different
  cargo shapes — label each one (`1 Container + 1 Description: <url>`, `No container: <url>`).
- Scenarios come from the ticket's acceptance criteria — usually one scenario per AC, merged or
  dropped when an AC isn't demoable on screen (permissions, audit, "no restore option").
- Bullets: `* I …` for actions, `* I can see …` for results. 2–4 bullets per scenario. Use real
  values where the ticket gives them (`P: 440 PK`, `Filer Type`, message text in quotes).
- "Verify …" bullets are acceptable (the team mixes them), but stay consistent within one story.
- Scenario names match the slide's WHAT WE'LL DEMO items one-for-one, so the slide and script line up.

## Worked example (from a past sprint)

```
INTERNAL-5496 – Show a Ready or Non-Ready state on every House B/L

https://<test-app>/bill-of-lading?blId=TESTBL000001

Scenario 1. Status chip in Detail View
* I open a Master B/L with several house bills, and open the House B/L section in Detail View.
* I can see each house bill carries a Ready or Non-Ready chip beside its Manifest File No.
* I can see a house bill with manifest file number assigned + cargo mapped shows Ready; one missing either shows Non-Ready.
Scenario 2. State recomputes as the cause is fixed
* I select a house bill marked Non-Ready (no cargo mapped), map cargo to it and add a new cargo manifest record.
* I can see the chip changes to Ready immediately.
* I remove the CM record and can see it returns to Non-Ready.
Scenario 3. Filter the navigation panel by state
* I open the filter above the List View panel, and can see All / Ready / Non-Ready offered, with All selected.
* I select Non-Ready, and can see only Non-Ready house bills listed with the footer count matching.
* I set it back to All, and can see every house bill listed again with its chip.
```

```
INTERNAL-5603 – Suggest the print layout from the cargo, and keep the choice the agent makes

1 Container + 1 Description: https://<test-app>/bill-of-lading?blId=TESTBL000002
Several containers: https://<test-app>/bill-of-lading?blId=TESTBL000001
No container: https://<test-app>/bill-of-lading?blId=TESTBL000003

Scenario 1. Layout suggested from the cargo shape, with the reason on hover
* I open a B/L and go to the B/L Cargo Print Style area.
* I can see 1 container + 1 description shows Summary; several containers shows Detail.
* I hover the information icon beside the layout, and can see a multi-container B/L reads that Detail itemises packages by commodity.
Scenario 2. The agent's choice is left alone
* On a B/L suggesting Detail, I open print setting, select Summary and save.
* I add a cargo line with a different description, and can see Summary stays selected.
* I close and reopen, and can see Summary still selected, not the suggestion returning.
```
