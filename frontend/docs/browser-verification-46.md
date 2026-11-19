# Browser verification pass for issue #46

Date: 2026-11-18. Base revision 756d322. The browser checks ran against this branch's working tree at ec92733 (the two code fixes below; the committed change differs from that only in this document), served by Vite at http://localhost:5175, with the backend at http://localhost:8000 on a scratch database; viewport emulation at 375x812 and 1280x800. Before checking, the served `Toast.jsx` and `States.css` were fetched from the page to confirm the fixed code was being served.

Sources: the results table (the Kitchen seeded row's "Running low" group and reserved-pill wording is from the earlier pass; the facts agree in both), D1, D3, D4's Tab count and timeout, F1/F2 (filed as #54/#55) and the limitations come from the final browser pass. D2, N1, N2 and the CORS observation come from an earlier pass whose toast results were discarded (it hit a dev server for a different branch, so no toast finding from it is used here); they do not depend on the toast code, and D2 and the badge geometry were seen again in the final pass. The CORS entry was also confirmed by reading `backend/app/main.py`. The relation of D4 to #48 and the issue numbers are from reading the issue tracker.

Method: S = scripted DOM or JS-driven checks, M = manual mouse, keyboard or tap interactions. The browser pane emulates a mobile viewport with mouse clicks, not real touch, so "tap" means a click at 375px width. Most checks ran in dark mode; light mode is noted where checked.

## Results by item

| Item | 375x812 | 1280x800 | Method and evidence summary |
|---|---|---|---|
| Kitchen loading | PASS | PASS | S, M. With fetches delayed, `.ui-skeleton` (role=status, aria-busy, label "Loading your kitchen") shows, pulses (opacity 0.55 to 1.0) and resolves to the rows. Checked in dark and light. |
| Kitchen empty | PASS | PASS | S, M. "Nothing in the fridge yet..." with a "Go to Shop" button that goes to #/shop (focus moved to the page title when checked at 1280); tabs read "Fridge (0)" and "Pantry (0)"; no horizontal overflow. Dark mode only. |
| Shop badge 99+ | PASS | PASS | S, M. No badge at 0; exact count at 1, 98, 99; "99+" at 100. Badge is never clipped (20 to 28px wide) in the tab bar or the rail. At 1280 the counts 0, 1, 99 and 100 were checked (98 was not re-run). See D2. |
| Plan Next week | PASS | PASS | S, M. Heading "Next week", Nov 23 to Nov 29 (Monday start, correct), toggle back to "This week, Nov 16 - Nov 22". Loading: button disabled with aria-busy and label "Loading next week" while the current week stays. A forced 500 shows an alert with Retry; Retry succeeds once the error is cleared. No overflow. See F2. |
| 1280px layout (Plan, Meals, Shop, Kitchen) | n/a | PASS | S, screenshots. No overflow, clipping or misalignment on any page; left rail intact. |
| Kitchen page (seeded) | PASS | PASS | M. Fridge and Pantry rows, "Running low" group, reserved pills, Use some flow, and the nav dot with name "Kitchen, staples running low". |
| Pantry tab | PASS | PASS | M. Switching, listing, `#/kitchen?tab=pantry` surviving a reload, Used up and Undo. |
| Toast Undo | PASS | PASS | M. Undo by mouse, tap, and keyboard restores the quantity with focus on the row's Adjust button. Toast clears the tab bar by 15px at 375. The toast times out (about 12s) without moving focus. See D4. |

## Fixed in this change

- **D1 (minor, cosmetic).** In dark mode the loading skeleton rows were nearly invisible because `.ui-skeleton__row` used `--surface-sunk`. They now use `--surface` with a 1px `--line` border. Re-checked in the browser: dark border contrast against the page is about 1.69:1 (was barely distinguishable), light about 1.24:1 (the old light-mode values were not measured); rows still pulse. They are visible but still a quiet placeholder. `node scripts/check-contrast.mjs` was run by the coordinator on this change and exits 0 ("all required pairings pass"); it lists `--line` only as decorative (informational) pairings, so the skeleton border is not a required pairing.
- **D3 (minor, keyboard).** After tapping the toast Dismiss button in the Kitchen Use some or Used up flows, focus fell to the page body. `Toast.jsx` now accepts an optional `returnFocus` resolver, used only when the user closes the toast and the previously focused element is gone; the Kitchen toasts use it to focus the row's Adjust button, else the page title. Re-checked in the browser at both widths: focus lands on the Adjust button, or the page title when the row is gone. Timeout dismissal still never moves focus; Undo is unchanged.

## Filed as separate issues

- **D4 (#51).** The toast comes after the page content, so Undo takes 7 Tab presses on a five-row Kitchen list, and the toast auto-dismisses after about 12 seconds. Related to #48 (the same problem on the Shop page).
- **F1 (#54).** Shop: dismissing the "Put away" toast sends focus to the page body (same class as D3; the Shop toasts pass no `returnFocus`).
- **F2 (#55).** Plan: focus drops to the page body after switching weeks and after Retry.

## Decisions and observations

- **D2 (kept as is).** The visible badge caps at "99+", but the accessible name gives the exact count ("Shop, 100 items to buy"; the badge itself is aria-hidden). The acceptance criterion wording says the cap applies to the accessible name too, so the wording differs from the code. Kept: the exact count is arguably better for screen-reader users.
- **CORS (not changed).** http://127.0.0.1:5173 is not an allowed origin (`allow_origins` in `backend/app/main.py` lists only http://localhost:5173 and http://localhost:5174), so the app fails to load data from 127.0.0.1. Checks used localhost.
- **N1.** The Shop badge overlaps the top-right corner of the Shop icon at both widths. It is not clipped and looks intentional.
- **N2.** In the earlier pass the badge once read "98" with 99 entries. It was not observed in the final pass.
- **N3.** Backend, not UI: setting a staple's minimum to "0" with quantity 0 leaves it listed as low; setting the minimum to null removes it. Not investigated.

## Limitations

- Not checked: empty Kitchen in light mode; badge at 98 and 101+ at 1280, and any count above 100; the Kitchen "Correct count" edit, the over-use validation error, and the "Out" pill beyond a zero-quantity staple; Plan, Meals and Shop at 375 in a seeded state beyond the checks above.
- Setup steps (opening forms and menus, some toggles at 1280) were scripted; the toast actions, tab and nav controls were real clicks, taps or key presses.
- No automated accessibility audit, screen-reader run, cross-browser run or real touch input. Accessibility findings come from tracking `document.activeElement`, accessible names and computed styles.
- F1 and F2 were not tested on the base revision; they appear to pre-date this change.
