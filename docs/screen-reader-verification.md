# Screen reader verification: toasts, Shop undo bar, route-change focus

Source: issue #67. Base revision of the code described here: `c618d3639c11402eb41fe0b22476292633a7231b`. Line numbers below refer to that revision and may drift.

## Status

**No screen-reader results are recorded in this document yet.** It is a manual test script and a results template only. Nothing in it claims that any check passed, failed, or was run with a screen reader. The "Expected" lines describe what the code is written to do (from reading it); they are not observations. Anything the code reading could not confirm is labelled **Observe and record**: write down what you hear and see instead of judging against an expectation.

## 1. Setup

### Start the app

Backend (port 8000):

```
cd backend; pip install -r requirements.txt; uvicorn app.main:app --reload
```

Frontend (http://localhost:5173):

```
cd frontend; npm install; npm run dev
```

The backend command is inferred from `backend/requirements.txt` and `backend/app/main.py`; it was **not verified by running it** (the README run-command blocks are blank in the repo). The frontend calls `http://localhost:8000` (`frontend/src/api.js:1`), so the backend must be running. CORS allows localhost:5173 and 5174 (`backend/app/main.py:22-30`).

### Recommended screen reader and browser

- Primary: NVDA with Firefox or Chrome (Windows).
- Alternative: Narrator with Edge (Windows).

Record exact versions in section 9. Use one pairing per pass; repeat the whole script for a second pairing if time allows. Turn off browse-mode surprises where you can: note whether NVDA was in browse or focus mode when an announcement happened.

### Test data needed

| Scenario | Data needed |
|---|---|
| 2 (global toast with Undo, check-time) | A Shop entry whose item is stocked in exactly one place (Fridge or Pantry) in Kitchen inventory and has a parseable quantity (e.g. "2 lb flour"). Create by planning a meal with measured ingredients, then Shop > Review changes > Apply, with that ingredient already in stock in one place. |
| 3 (Shop undo bar) | Any one Shop list row (for Remove). Optionally plan changes for Review changes > Apply. A manually added item (Add item) works. |
| 4 (Put away panel and toast) | At least one checked item with no known location, two locations, or no quantity, so it lands in "Waiting to be put away". A manually typed item with a quantity prefix such as "2 lb rice" works. Ideally two or more such items, so you can test both "some remain pending" and "all put away". |
| 5 (route focus) | Only the running app. |
| 6 (week toggle, week radiogroup) | The Plan page must load (backend creates the current week plan). Next week is believed to load via `getCurrentWeekPlan(nextWeekStart(...))`; not verified against the backend. |
| 1 (plain 6 s toast) | No clean user trigger was identified. Mark not applicable unless you find one (see scenario 1). |

Data requirements come from code reading and were not exercised. No seed script was looked for; build data by hand.

## 2. How to use this script

For each scenario, do the steps, then fill the three blank fields: announcement heard (quote it, or "silent"), where focus landed (element and how you know), and result (pass / fail / defect). "Pass" means it matched the Expected line; for **Observe and record** lines, record the behavior and mark it "observed" unless you judge it a defect. File defects per section 10.

Global keys to know: Ctrl+Z triggers the most recent Undo (Cmd+Z on Apple). It is ignored in text inputs, textareas, selects and contenteditable, and when Alt or Shift is held (`frontend/src/components/ui/useUndoShortcut.js:17-41`). Checkboxes, radios and buttons do not block it.

## 3. Scenario 1: Global toast, plain (no Undo)

Component: `ToastProvider` in `frontend/src/components/ui/Toast.jsx`.

Steps:
1. Find a way to produce a plain toast. Known paths: the "Couldn't undo X of N items..." toast after a failed Put away undo (`ShoppingList.jsx:769-771`), and Kitchen error toasts (`KitchenPage.jsx:319`). Neither has a simple trigger; if you cannot produce one, write "not triggered" and move on.
2. Listen for the announcement. Do nothing and wait about 6 seconds.

Expected (code):
- The toast is mounted inside a persistent `<div class="ui-toast-region" role="status" aria-live="polite">` (`Toast.jsx:116-127`). The live-region text is the message. Source: `Toast.jsx:116-127`.
- It auto-dismisses after 6000 ms (`TOAST_DURATION_MS`, `Toast.jsx:8,17`), and timeout never moves focus (`Toast.jsx:25-33, 79-80`).
- A new toast replaces the old one (`key={toast.id}`) and should be announced again (`Toast.jsx:99-110, 118-119`).

Observe and record: whether the message is announced at all, and whether a replacement toast is announced again.

| Announcement heard | Where focus landed | Pass / fail / defect |
|---|---|---|
| | | |

## 4. Scenario 2: Global toast with Undo (check-time)

Steps:
1. Shop page. Check an item that has a single known stock location and a parseable quantity (see Test data).
2. Listen for the toast. Do not touch anything for a few seconds.
3. Press Tab to move to the toast's buttons. Note the order and names read.
4. Press Shift+Tab or click elsewhere to leave; note whether the toast stays or goes.
5. Repeat step 1, then press Ctrl+Z with focus on the checkbox (not in a text field).
6. Repeat step 1, then activate Dismiss.
7. Repeat step 1, do not interact, and wait 30 seconds.

Expected (code):
- Toast message reads `Added <amount> to Fridge|Pantry` with action "Undo" (`ShoppingList.jsx:604-617`).
- Live-region text is the message span; the buttons are not normally read unless the screen reader reads the whole region (`Toast.jsx:51-65`).
- Action button name is "Undo" (the key hint is `aria-hidden`, `ui/UndoHint.jsx:8`), with `aria-keyshortcuts` of `Control+Z` or `Meta+Z` on Apple (`useUndoShortcut.js:14-15`, `Toast.jsx:56`). Close button name is "Dismiss" (`Toast.jsx:63`).
- Duration is 30000 ms for a toast with an action (`ACTION_TOAST_DURATION_MS`, `Toast.jsx:10,17`). Timeout does not move focus.
- The timer pauses while the pointer hovers over the toast or focus is inside it, and resumes with the remaining time (`Toast.jsx:18-33, 44-50`).
- Undo or Dismiss: if focus is inside the toast or on the page body, focus returns to the element focused when the toast was shown; if that is gone, to the `returnFocus` target. If focus is elsewhere, it is left alone (`Toast.jsx:81-98`).
- Undo reverts the entry and focuses its checkbox (`ShoppingList.jsx:613-616, 656-660`).
- Ctrl+Z runs the same Undo (`useUndoShortcut.js:17-41`).

Observe and record: whether Tabbing into the toast actually keeps it open past 30 seconds (inferred from the focus handler, never run); how the keyboard shortcut is announced ("Control+Z"); whether the Undo button is reachable in a sensible Tab order from where you are.

| Step | Announcement heard | Where focus landed | Pass / fail / defect |
|---|---|---|---|
| 2 (appearance) | | | |
| 3 (Tab to buttons) | | | |
| 5 (Ctrl+Z) | | | |
| 6 (Dismiss) | | | |
| 7 (30 s timeout) | | | |

## 5. Scenario 3: Shop undo bar

Component: in-page bar in `frontend/src/components/ShoppingList.jsx`, separate from the global toast.

Steps:
1. Activate the "Remove <name>" button on a row (`ShoppingList.jsx:1167-1175, 782-792`). Listen.
2. Tab to the bar's Undo and Dismiss buttons; note order and names.
3. Activate Undo. Note announcement and focus.
4. Remove another row; activate Dismiss. Note announcement and where focus lands.
5. Remove another row; do not interact; wait 30 seconds. Note any announcement.
6. Remove another row; hover the pointer over the bar (and separately, Tab focus into it) for over 30 seconds. Note whether it disappears.
7. Remove a row, then press Ctrl+Z with focus on a non-text control.
8. Optional: Review changes > Apply (message "Changes applied.") then Undo (`ShoppingList.jsx:835`).
9. If testing on a narrow window (under 1024 px), repeat step 1 and note that the bar sits above the Put away bar and bottom nav (visual only; DOM order is Put away bar then undo bar, `ShoppingList.jsx:1419-1443`).

Expected (code):
- Message `Removed "<name>".` in `<div class="shopping-list__undo" role="status" aria-live="polite">` with a message span, an "Undo" button and an icon button named "Dismiss" (`ShoppingList.jsx:1432-1443`).
- Timeout clears the bar after 30 s via `setTimeout` (`ShoppingList.jsx:451-455`).
- Undo clears the bar, calls the API, focuses the restored row's checkbox (else the "To buy (N)" heading), then sets a flash `Undone.` in `<p class="shopping-list__flash" role="status" aria-live="polite">`, auto-cleared after 8 s. On failure the flash is `<err.message> Nothing was changed.` (`ShoppingList.jsx:794-808, 656-660, 445-449, 1360`).
- The focus request after Undo applies only if focus is free (page body, disabled element, inside the toast region, or a fallback heading); otherwise it is dropped (`ShoppingList.jsx:419-443`).
- Ctrl+Z is wired through `useUndoShortcut(Boolean(undo), undoLast)` (`ShoppingList.jsx:810`). If a global toast Undo is also live, the most recently shown one fires.

Observe and record (the research could not confirm these):
- **Probe P1:** Dismiss calls only `setUndo(null)` with no focus handling (`ShoppingList.jsx:1439`). Hypothesis: focus is lost to the page body after Dismiss. Record exactly where the screen reader cursor/focus ends up and what is read next.
- **Probe P2:** the bar has a 30 s `setTimeout` with no pause on hover or focus, unlike the global toast (`ShoppingList.jsx:451-455`). Hypothesis: it vanishes while the user is interacting with it. Record whether it disappears at about 30 s while pointer or focus is on it, and whether the removal is announced or silent.
- **Probe P3:** the live-region element is inserted already carrying `role="status"` and `aria-live`. Hypothesis: some screen readers do not announce a live region that arrives already populated. Record whether the "Removed ..." message is announced at all, with which screen reader and browser.
- Whether the "Changes applied." Undo path puts focus on the "To buy (N)" heading when `payload.removed` is empty (payload shape not traced).
- Whether the `Undone.` flash is announced, and whether it competes with the focus announcement.
- Behavior when the global toast and the bar are both live (Ctrl+Z order).

| Step | Announcement heard | Where focus landed | Pass / fail / defect |
|---|---|---|---|
| 1 (Remove) | | | |
| 2 (Tab order) | | | |
| 3 (Undo) | | | |
| 4 (Dismiss, P1) | | | |
| 5 (timeout) | | | |
| 6 (hover/focus hold, P2) | | | |
| 7 (Ctrl+Z) | | | |
| 8 (Apply then Undo, optional) | | | |

## 6. Scenario 4: Put away panel and its toast

Steps:
1. Check items so at least two are "Waiting to be put away". Note the status line announcement ("N waiting to be put away", `ShoppingList.jsx:1274-1278`).
2. Tab to the "Put away groceries (N)" button. Note its name and expanded state. Activate it.
3. Note the announcement and focus on open. Tab through the first row: quantity field, then the "Where does X go?" group with Fridge, Pantry, Keep on list.
4. Press Escape; note focus. Reopen.
5. Submit with a missing or invalid quantity. Note the failure announcement and focus.
6. Put away one item only, leaving at least one pending. Note the toast announcement and focus after submit.
7. Press Undo on that toast. Note focus.
8. Repeat steps 2 to 6 putting away all remaining items (so the Put away button disappears). Note the toast announcement and focus after submit.
9. Dismiss that toast (Dismiss button, then separately a fresh toast with Undo). Note where focus lands each time.

Expected (code):
- Bar button "Put away groceries (N)" with `aria-expanded` and `aria-controls="put-away-panel"` (`ShoppingList.jsx:1419-1430`).
- Panel is a `<form role="region">` labelled by its "Put away groceries" heading. On mount the heading (tabindex -1) is scrolled into view and focused (`PutAwayPanel.jsx:28-34, 117-126`).
- Each row has "Quantity of X" and a fieldset "Where does X go?" with radios Fridge, Pantry, Keep on list. Primary button reads "Done" (nothing ready) or "Put away N item(s)" (`PutAwayPanel.jsx:112-114, 195-198`). Escape or Cancel closes the panel (`PutAwayPanel.jsx:105-110`).
- Failure: summary `<p role="status" tabindex="-1">` reading `N put away, M couldn't be saved. Try again.`, with focus on the first invalid quantity input, else the summary. Per-row errors are `role="alert"` (`PutAwayPanel.jsx:56-61, 95-100, 179-184, 194`).
- Success: the panel closes and a toast `Put away N item(s)` with action Undo appears; a 0 ms timeout then focuses the Put away trigger if it still exists, else the "Bought (N)" heading (`ShoppingList.jsx:754-780`). Which of the two applies depends on whether items remain pending.
- Undo on the toast calls `focusReverted(credited)`, targeting the first reverted entry's checkbox (`ShoppingList.jsx:763-768`). If a revert fails, a second plain toast says "Couldn't undo X of N items. They are still in stock." (`ShoppingList.jsx:769-771`).
- Dismissing (Undo or Dismiss) restores focus to the element focused when the toast was shown if still connected, else to the `returnFocus` target: the Put away trigger if connected, else the "Bought" heading (`ShoppingList.jsx:762`, `Toast.jsx:81-98`).

Observe and record:
- **Probe P4:** focus after dismissing the Put away toast depends on the focus captured when the toast was shown. `show()` runs before the 0 ms focus timeout, so it may capture the submit button (about to unmount), the page body, or the panel. Record exactly where focus lands after Dismiss and after Undo, in both the "items remain pending" and "all put away" cases. Expected end states are the Put away trigger or the Bought heading; treat any other result as something to record.
- Ordering when Undo is activated: the toast's focus restore and the pending `focusReverted` focus request can compete (`Toast.jsx:35-38`); record the final focus position (expected: first reverted entry's checkbox, not confirmed).
- Whether the Put away button's name and expanded state are read as expected, and whether the heading focus on open is announced as a region.
- Whether the toast announcement and the new focus announcement interrupt each other.

| Step | Announcement heard | Where focus landed | Pass / fail / defect |
|---|---|---|---|
| 1 (status line) | | | |
| 2 (open) | | | |
| 3 (panel Tab order) | | | |
| 4 (Escape) | | | |
| 5 (failure) | | | |
| 6 (submit, items remain) | | | |
| 7 (Undo) | | | |
| 8 (submit, all put away) | | | |
| 9 (Dismiss, P4) | | | |

## 7. Scenario 5: Route-change focus via the main nav

Component: `frontend/src/App.jsx`.

Steps:
1. Load the app fresh. Note what is announced and focused on initial load (do not expect focus to move).
2. Tab to the skip link "Skip to content". Activate it. Note focus.
3. Move to the main nav (`<nav aria-label="Main">`). Note how each link is read, including the current page and any hint text.
4. Activate Meals, Shop, Kitchen, Plan in turn. After each, note the announcement and focus.
5. Activate the link for the page you are already on. Note whether anything changes.
6. Use browser Back and Forward between pages. Note announcement and focus.
7. Type a bogus hash (e.g. `#/nope`) and note which page loads.

Expected (code):
- Routes are hash-based: `#/plan`, `#/meals`, `#/shop`, `#/kitchen`; empty or unknown hash falls back to Plan (`App.jsx:11-24`).
- Nav links carry `aria-current="page"` on the active one (`App.jsx:76-85`).
- On a route change, the page scrolls to top and focus moves to `<h1 id="page-title" tabindex="-1">` whose text is the page label (Plan, Meals, Shop, Kitchen), so something like "Shop, heading level 1" is expected (`App.jsx:54-62, 101`). It does nothing on initial mount (`App.jsx:58`). Back/Forward use the same effect via hashchange (`App.jsx:48-52`).
- The h1 is the same element across routes. Activating the link for the current page does not move focus (`App.jsx:58`).
- "Skip to content" focuses `<main id="main" tabindex="-1">` (`App.jsx:68-70, 100`).
- Pages have their own h2s following the h1, e.g. "This week"/"Next week" on Plan (`WeekPlanner.jsx:1043`) and several on Shop (`ShoppingList.jsx:1377-1388`).

Observe and record:
- How the nav hint (", N items to buy" on Shop, ", staples running low" on Kitchen, `App.jsx:29-38, 86-95`) is read. Whether it is spoken depends on `.app-nav__hint` CSS, which was not read, so there is no expectation.
- Whether the h1 announcement is clean or is followed by an h2 that repeats context.

| Step | Announcement heard | Where focus landed | Pass / fail / defect |
|---|---|---|---|
| 1 (initial load) | | | |
| 2 (skip link) | | | |
| 3 (nav reading) | | | |
| 4 Meals | | | |
| 4 Shop | | | |
| 4 Kitchen | | | |
| 4 Plan | | | |
| 5 (same link) | | | |
| 6 (Back / Forward) | | | |
| 7 (bogus hash) | | | |

## 8. Scenario 6: Week toggle focus (Plan) and Shop week radiogroup

### 6a. Plan page toggle

Steps:
1. Go to Plan. Tab to the button "See next week". Activate it.
2. Listen during loading and after it finishes. Note the button name, focus and any announcements.
3. Activate "See this week" to switch back.
4. If you can force a load failure (e.g. stop the backend), activate the toggle and note the alert and focus; then restart the backend and use Retry.

Expected (code):
- Button label flips between "See next week" and "See this week", and the h2 between "This week" and "Next week" (`WeekPlanner.jsx:1043-1054`).
- While loading, the button shows `aria-label="Loading next|this week"` (`WeekPlanner.jsx:1051`). Once loading finishes, focus is returned to the same toggle button (`WeekPlanner.jsx:658, 708-714, 895-913`).
- On failure a `role="alert"` reads "Could not load next|this week. <detail>" with a Retry button, and focus still returns to the toggle (`WeekPlanner.jsx:1058-1063, 708-714`).
- There is no dedicated live announcement of the week change.

Observe and record:
- The summary `<p role="status">` "N of M slots planned..." (`WeekPlanner.jsx:1066-1074`) updates after a switch; record whether it is announced.
- How the loading state is conveyed, since `Button` `loading` semantics (aria-busy or disabled) were not read. Record whether focus is dropped while the button is disabled and whether the final focus announcement is the new label.

| Step | Announcement heard | Where focus landed | Pass / fail / defect |
|---|---|---|---|
| 2 (switch to next week) | | | |
| 3 (switch back) | | | |
| 4 (failure/Retry, optional) | | | |

### 6b. Shop week radiogroup

Steps:
1. Go to Shop. Tab to the "Week" radiogroup. Note the group name, radio names ("This week", "Next week") and checked state.
2. With a radio focused, use Right/Left/Up/Down, Home and End. Note announcement and focus after each.
3. Activate the other radio with Space/Enter and with the mouse. Note focus and what is announced as the "Needs for this/next week" section reloads.

Expected (code):
- `role="radiogroup" aria-label="Week"` with two `role="radio"` buttons, roving tabindex and `aria-checked`. Arrow keys, Home and End select and move focus (`ShoppingList.jsx:877-892, 1319-1340`).
- Activating the other radio selects it and focus stays on that button.
- The needs section reloads with a skeleton labelled `Loading what this week needs` and the section named `Needs for <week>` (`ShoppingList.jsx:1061`).

Observe and record: whether the reload and the new section name are announced, or the change happens silently.

| Step | Announcement heard | Where focus landed | Pass / fail / defect |
|---|---|---|---|
| 1 (group and radios) | | | |
| 2 (arrow, Home, End) | | | |
| 3 (activate other radio) | | | |

## 9. Results recording

Fill this in when you run the script. Nothing below has been filled in.

| Field | Value |
|---|---|
| Screen reader and version | |
| Browser and version | |
| OS and version | |
| Date | |
| Tester | |
| Commit tested (`git rev-parse HEAD`) | |
| Screen reader mode notes (browse/focus) | |

Summary of outcomes (fill in after the run):

| Scenario | Overall result (pass / fail / defects found) | Notes |
|---|---|---|
| 1 Plain toast | | |
| 2 Undo toast | | |
| 3 Shop undo bar | | |
| 4 Put away panel and toast | | |
| 5 Route-change focus | | |
| 6 Week toggle and radiogroup | | |

Probe summary:

| Probe | What to answer | Observed |
|---|---|---|
| P1 | Does Dismiss on the Shop undo bar leave focus lost? | |
| P2 | Does the Shop undo bar vanish after 30 s even while hovered or focused? | |
| P3 | Is the Shop undo bar message announced when it appears? | |
| P4 | Where does focus land after dismissing the Put away toast, in both pending cases? | |

## 10. Defect procedure

1. For each defect, file a **separate GitHub issue** (one defect per issue). Do not bundle.
2. Reference #67 in the issue body (for example "Found while verifying #67").
3. Include: scenario and step number, screen reader plus version, browser, OS, steps to reproduce, announcement heard versus expected, where focus landed versus expected, and the commit tested.
4. Add the issue number to the table below.
5. Do not edit the Expected lines or this script to make a result pass. If the intended behavior is unclear, say so in the issue.

| Defect ID | Scenario / step | Short description | Announcement heard | Focus landed | Expected | Issue # |
|---|---|---|---|---|---|---|
| D1 | | | | | | |
| D2 | | | | | | |
| D3 | | | | | | |

## 11. Known gaps in this script

- Written from code reading only; nothing here was executed or checked with a screen reader.
- Not read when preparing it: `frontend/src/components/ui/Button.jsx` (loading semantics), `frontend/src/App.css` (`.app-nav__hint`), the Kitchen page triggers for undo toasts, the backend seed data and start command.
- The backend start command was not verified by running it.
