# LinkScout Integration Test Plan

> Version 0.1.0 — Manual verification checklist.
> Run each test after a fresh install unless otherwise noted.

---

## 1. Install & Load

- [ ] Extension loads without errors at `chrome://extensions` (Developer Mode)
- [ ] Popup opens and shows **Settings** view on first install
- [ ] Service worker starts without errors (check "Inspect views: service worker")
- [ ] Content script injects on `linkedin.com` pages without console errors
- [ ] No console errors on non-LinkedIn pages (content script should not inject)
- [ ] All three icon sizes display correctly (16px toolbar, 48px extensions page, 128px)

## 2. Settings

- [ ] Default chip options render: 8 roles, 15 companies, 7 seniority levels
- [ ] Default active seniority: Manager, Senior Manager, Director
- [ ] Clicking a chip toggles its visual state (active/inactive)
- [ ] Custom chip added via text input + Enter: appears, active, with × button
- [ ] Duplicate custom chip (case-insensitive) is rejected silently
- [ ] Custom chip persists after popup close/reopen
- [ ] Removing a custom chip (× button) deletes it permanently
- [ ] School input defaults to "University of Waterloo"
- [ ] Location input defaults to "Greater Toronto Area"
- [ ] "Include remote positions" checkbox defaults to checked
- [ ] Session limit input: min 10, max 80, step 10, default 40
- [ ] "Save & Continue" saves all settings and switches to Results view
- [ ] Gear icon toggles back to Settings view
- [ ] Settings persist across browser restart
- [ ] DevTools: `chrome.storage.local.get(null, console.log)` shows all saved keys

## 3. Query Generation

- [ ] Open `test/test-queries.html` in a browser tab
- [ ] With default settings: 6–9 queries generated
- [ ] No keyword string exceeds 6 words
- [ ] All 6 strategy categories represented (direct_role, seniority_vertical, alumni, hiring_signal, adjacent, recruiter)
- [ ] Click "Re-run" 3 times: adjacent role query varies (randomization)
- [ ] Copy 3 query URLs → paste into LinkedIn while logged in → produces relevant People results
- [ ] URLs are properly encoded (no broken characters or special characters)

## 4. Scanning

- [ ] Click "Start Scan" → background tab opens with first LinkedIn search URL
- [ ] Scan bar shows: pulsing blue dot, "Scanning... (0/40)", "Stop" button
- [ ] Query indicator shows current search label
- [ ] Summary bar shows elapsed timer: "Scanning... Xm XXs · N/40 profiles"
- [ ] Search results page is parsed: profile URLs collected (check SW console)
- [ ] Scanner navigates to individual profiles sequentially
- [ ] Content script extracts data from each profile
- [ ] Scoring runs and produces valid scores (check with SW console)
- [ ] Result cards appear in popup dashboard in real-time
- [ ] Delays between profiles are randomized (observe in SW console — not uniform)
- [ ] Every 10th profile has a noticeably longer pause
- [ ] Duplicate profiles (same URL) are skipped across sessions
- [ ] "Stop" button: scanning stops, tab closes, state saved
- [ ] Scanning stops automatically when `maxProfilesPerScan` is reached
- [ ] Scanning tab closes when scan finishes or stops
- [ ] Close and reopen popup mid-scan: state is accurate (scanning indicator visible, progress correct)

## 5. Resilience

- [ ] Rate limit detection: modify extractor to return `rate_limited` on 6th profile → scan pauses with warning message
- [ ] Pause banner shows: "LinkedIn has detected unusual activity..."
- [ ] Resume button appears and works → scanning continues from correct position
- [ ] Extraction failure on one profile doesn't crash the entire scan (next profile proceeds)
- [ ] Empty/minimal LinkedIn profiles don't produce errors (just low scores)
- [ ] Closing the scanning tab manually during a scan → service worker detects and handles gracefully
- [ ] Service worker stays alive during long scans (close popup, wait 60s, reopen — scan still running)
- [ ] Browser restart: scan state is recoverable (shows idle, not stuck in "scanning")

## 6. Results

- [ ] Results sorted by score (highest first)
- [ ] Score badges show correct colors: green (75+), blue (55–74), amber (35–54), gray (0–34)
- [ ] Signal tags render correctly (max 3 per card, priority order: Hiring > Active > Alumni > Mutual)
- [ ] "View Profile →" link appears on hover, opens correct LinkedIn URL in new tab
- [ ] 200 result maximum enforced: inject 210 mock results, confirm only 200 stored (lowest dropped)
- [ ] Results persist after popup close/reopen
- [ ] Results persist after browser restart

## 7. Export CSV

- [ ] "Export CSV ↓" button visible when results exist, hidden when empty
- [ ] Click export: file downloads as `linkscout-results-YYYY-MM-DD.csv`
- [ ] Open CSV in Excel/Google Sheets: 12 columns present
- [ ] Commas in titles/company names don't break CSV columns
- [ ] Quotes in data are properly escaped (doubled)
- [ ] All rows present, sorted by score descending

## 8. Session Management

- [ ] Session history recorded: check storage key `sessionHistory` after completing a scan
- [ ] Session entry has correct fields: sessionId, startedAt, endedAt, profilesScanned, stoppedReason
- [ ] Daily scan counter increments: check `dailyScanCount` key in storage
- [ ] Set `dailyScanCount` to `{date:"YYYY-MM-DD",count:99}` (today's date), start scan → after 1 profile, warning banner appears
- [ ] Warning banner: red background, "100+ profiles today" message with "I understand" button
- [ ] Dismissing warning hides banner for current popup session
- [ ] "Clear All Data" button: shows confirmation dialog
- [ ] Confirm → clears results, scan state, scanned URLs, session history
- [ ] Settings (roles, companies, school, etc.) are preserved after clear
- [ ] Cancel → nothing is cleared

## 9. Debug Mode

- [ ] Click version number "v0.1.0" 5 times within 3 seconds → "🐛 Debug mode ON" toast
- [ ] Debug badge "🐛 Debug" appears next to version number
- [ ] Debug panel appears at bottom of Settings view with orange dashed border
- [ ] Debug panel shows: scanState, counts (results, URLs, sessions, daily), storage info
- [ ] "Inject Mock Results" button: populates dashboard with scored mock profiles
- [ ] Mock results have valid scores, correct badges, signal tags
- [ ] "Reset All Storage" button: wipes everything (including settings) — toast confirms
- [ ] "Export Debug Log" button: downloads JSON file with all storage data + log buffer
- [ ] Debug mode persists across popup close/reopen
- [ ] Click version number 5 more times → "Debug mode OFF" toast, badge and panel disappear

## 10. Cross-Browser & Edge Cases

- [ ] Extension works in Chrome stable (latest)
- [ ] Extension works in Chrome Beta or Canary
- [ ] Extension works in Microsoft Edge (Chromium-based)
- [ ] Very long names/titles don't overflow card layout (truncated with ellipsis)
- [ ] Profiles with unicode characters in names render correctly
- [ ] LinkedIn logged-out state: content script should not crash
- [ ] Multiple rapid Start/Stop clicks don't create duplicate scan loops

---

## Scoring Spot-Checks

Run `test/test-scoring.html` and verify:

- [ ] HIGH mock profiles: all score as `reach_out_today` or `strong_candidate`
- [ ] LOW mock profiles: all score as `archive`
- [ ] Empty profile: score ≤ 10, confidence `low`
- [ ] Breakdown sums equal totalScore for every profile
- [ ] No dimension exceeds its max cap

---

## Performance

- [ ] Popup opens in < 200ms (no visible delay)
- [ ] Scrolling through 50+ result cards is smooth (no jank)
- [ ] Service worker memory usage stays under 50MB during scanning
- [ ] Storage usage stays under 5MB after 200 results

---

**Test completed by:** _______________
**Date:** _______________
**Issues found:** _______________
