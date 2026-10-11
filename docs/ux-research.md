# Accounted Mobile: UX research (2026-10-11)

Research only. Sources: Appllama library (34 credits), the app code in `src/`, current screenshots, the web app at phone width, and the locked design rules (`accounted/.claude/rules/design.md`).

**Coverage note.** Appllama does not carry Pleo, Ramp, Brex, Qonto, Revolut Business, Mercury, Fortnox, Bokio, Spiris, QuickBooks, Xero, Shoeboxed or Monzo (searched, no hits). Studied instead: **Expensify** (Home, Expenses, Expense Creation, Account, Security), **Dext** (Costs, Review, More, Settings), **Wave** (Dashboard, Quick Create), **Wise** (Home, Account, Settings), **Everlance** (Transactions, Account & Settings), **Saldo Receipt Scanner** (Dashboard, Expenses, Edit), **ScanNow** (scanner camera). For single patterns: **Slack** (sign-in, notification priming, swipe settings), **Notion** (empty inbox), **Wallet by BudgetBakers** and **LastPass** (Face ID lock).

## Executive summary

- The app already matches the best pattern in this category: Expensify's Home also opens with a serif greeting, a date line and a "time sensitive" to-do card, so keep the IA. The gaps are reach and speed, not structure.
- **Capture is one tab away.** Expensify puts a camera button on every tab and Dext puts it in the tab bar. Add capture to Overview, a Home Screen quick action and an optional "open on scanner" setting.
- **The Missing list cannot be acted on in place.** Add month grouping, swipe actions (Scan / No receipt needed) and a long-press menu. Rows stay one line.
- **Reviewing what the AI read is read-only.** Expensify marks auto-filled fields and Dext shows the receipt full-bleed. Add a full-screen zoom and mark read fields. Mismatches stay as ochre checks. Edits hand off to the web inbox until the API can save them.
- **Notifications are only switched on from Settings.** Slack shows a mock notification before asking, with a plain Skip. Ask after the first attach, and add an app-icon badge for the missing count.
- **Settings reads like a debug page** (raw key prefix, no security, no help). Restructure it into seven flat sections, including Face ID lock (Wallet, LastPass) and Help/Report a problem (Dext, Everlance).
- **Don't build what the web already does**: categorising, the document inbox, KPI tables, company settings, exports. The phone shows counts and links to the web for these.

## 1. Receipt capture and matching

**Top apps.** Expensify: camera button on every tab; "Confirm details" shows the receipt first and labels auto-filled fields "Automatic". Dext: camera in the tab bar (caret for other modes); full-bleed **Review** with **Retake** as back, details in a bottom sheet; settings "Open on camera", "Save to gallery". ScanNow: page-count thumbnail and **Next** for multi-page.

**Ours.** Scan from Receipts and Payment detail (VisionKit, pages joined into one PDF). Review shows a 260px preview, read fields with "% sure", checks against the payment, and a Suggested payment card.

**Gaps.** No capture on Overview, no zoom, no way to fix a misread field, no batch scanning, read values not marked as machine-read.

**Recommendations.**
- Add a `Scan` pill to Overview's top bar. Convention 9 allows one primary action per header, and the + menu stays on Receipts. Add a Home Screen quick action "Scan receipt".
- Tapping the preview opens it full screen with pinch-zoom.
- Label each read field with a muted "read" meta, not a sparkle. If the API can't store corrections yet, add an "Edit on the web" link to the inbox item.
- When exactly one confident match exists, make "Attach to Openrouter, 214,25 kr, 10 Oct" the primary button, and keep "Choose another" second. The outcome is stated before the tap (convention 10).
- Add a batch mode: an "Each page is a separate receipt" option on the scan result. Each page becomes its own capture, and each is auto-suggested a payment.

## 2. Overview for a small-business owner

**Top apps.** Expensify: greeting card, "Time sensitive" items with one action each. Wave: "Here's what you need to know today", setup card, two quick actions (Create new, Scan receipt), "Business at a glance" tiles (overdue, due in 30 days). Wise: action chips incl. Upload, account card, "See all". Saldo: a "Synchronization completed" row.

**Ours.** Greeting, to-do card, Cash with runway, 2x2 tiles, month bars, bank accounts with "updated X h ago". Very close to Expensify and Wave, and on-brand.

**Gaps.** The to-do card only covers what the phone can fix; the web's To do also has 22 transactions to record and 251 vouchers missing documents. No receivables. The month bars are near zero most months.

**Recommendations.**
- Keep at most three rows in the to-do card:
  1. Missing receipts.
  2. Uploads, when there are any.
  3. One "On the web" row with the web's count ("22 transactions to record"), opening the web page in an in-app browser.

  This replaces a separate stale-bank row: the ochre attention line already covers a stale bank.
- Add a VAT due date to the VAT tile caption ("to pay by 12 Nov"). This is the one deadline worth a glance.
- Optionally swap Revenue for Receivables ("0 kr outstanding"). Revenue for the year is already the web KPI's job.

## 3. Account and transaction detail

**Top apps.** Expensify rows: thumbnail, merchant, date and category, amount; a "Missing category" line and "Draft" chip appear **only** on deviating rows. Everlance groups by day. Wise: balance header, segmented Currencies/Transactions/Options. Saldo: search above the list.

**Ours.** One-line rows (date, merchant, amount; convention 4). Account detail groups by month with "Show older". Rows are not tappable, no search, no receipt status, Missing list ungrouped.

**Recommendations.**
- Group the Missing list under month section labels with counts, the same way Account detail does.
- In Account detail, show a muted receipt glyph **only** on outgoing payments that are missing a receipt (convention 5). Tapping such a row opens Payment detail.
- Add the native header search bar on Receipts (merchant or amount).
- Skip filter chips: the Missing/Attached segment is the only filter that's needed.

## 4. Settings

**Top apps.** Expensify Account: Profile, Subscription, Preferences, Security, then General (Help, What's new, About, Troubleshoot, Sign out). Dext More: profile card, Switch logins, capture toggles, Support, Legal (incl. open-source licenses). Everlance: grouped sections, red Sign Out, version label. Wallet and LastPass: "Require Face ID on startup", lock timeout.

**Ours.** Company (name, host, "Access gnubok_sk_Q...", Open Accounted), Notifications, Receipts, This iPhone (Disconnect), footer.

**Gaps.** Raw key prefix at top level; no app lock, help, problem report or licenses; no sign when iOS has blocked notifications.

**Recommendations.** See the proposed section list at the end.

## 5. Onboarding, empty states, permission priming

**Top apps.** Slack sign-in asks for one thing, with "Enter a workspace URL" and "Continue with a QR code" as small links; it primes notifications with sample notifications on a phone outline plus a plain "Skip". Notion's empty Inbox: "You're all caught up", what will appear, one link.

**Ours.** Server field, "Sign in with Accounted", API key fallback. Good "All caught up" empty state. Push is only offered in Settings.

**Recommendations.**
- When the build has a preset server, hide the Server field behind a "Use another server" link. The screen becomes one button.
- Later, add a "Scan the code shown in Accounted on the web" QR sign-in. This needs server work.
- After the **first successful attach**, show one priming sheet:
  - A mock notification: "Card payment 214,25 kr, Openrouter. Snap the receipt."
  - "Turn on" and "Not now".
- In the empty state, add a "Get a notification after each card payment" link while push is off.

## 6. Polish

**Already in place:** success haptics on attach and connect, selection haptics on the segmented control, a toast host, skeletons, pull-to-refresh, no press-scale.

**Add:**
- **Swipe on Missing rows.** Leading swipe = Scan, trailing swipe = No receipt needed, using Gesture Handler `ReanimatedSwipeable`. The swipe has no overshoot, with one haptic at the threshold.
- **Undo toast for "No receipt needed".** This replaces the current Alert: hiding is reversible, so the toast confirms afterwards instead of asking first.
- **Long-press menu on rows:** Scan, Photo, File, No receipt needed, Open in Accounted.
- **App-icon badge** showing the missing count.
- **Privacy cover** in the app switcher (amounts hidden).
- **Fix "No receipt needed" being local only.** It hides the payment on the iPhone, but the web still counts it among vouchers missing documents. Raise this upstream so the dismissal is stored on the server.

## Prioritised backlog

| # | Item | Why | Effort | Impact | Native dev build? |
|---|------|-----|--------|--------|-------------------|
| 1 | Swipe actions + long-press menu on Missing rows | Act without opening each payment (Expensify, Slack) | S | H | No (Gesture Handler, Expo Router menus are in Expo Go; verify Link.Menu) |
| 2 | Scan pill on Overview | Capture from the first screen (Expensify, Wave) | S | H | Scanner already needs the dev build; photo/file fallback works in Expo Go |
| 3 | Post-first-attach notification priming sheet | Push is the main nudge; it is hidden in Settings now (Slack) | S | H | No for the sheet; push tokens need the dev build |
| 4 | Settings restructure (below) | Trust, support, security | M | H | Face ID row: yes (Face ID usage string); rest no |
| 5 | Face ID app lock + privacy cover | Expected for financial apps (Wallet, LastPass) | M | M | Yes for Face ID; the privacy cover is JS (AppState) |
| 6 | Full-screen receipt zoom + "read" markers | Trust the AI read (Expensify, Dext Review) | S | M | No |
| 7 | Home Screen quick action "Scan receipt" | One tap from the icon | S | M | Yes (expo-quick-actions) |
| 8 | Month grouping + header search on Receipts | 120-day lookback gets long | S | M | No |
| 9 | Undo toast replaces the "No receipt needed" alert | Faster, reversible | S | M | No |
| 10 | App-icon badge = missing count | Passive nudge | S | M | Needs the notification permission; dev build for reliability |
| 11 | To-do "On the web" hand-off row + VAT due date | Whole picture without duplicating the web | M | M | No |
| 12 | Batch scan (one receipt per page) | Shoebox evenings (ScanNow, Expensify multi-receipt) | M | M | Yes (scanner) |
| 13 | Receipt glyph + tap-through in Account detail | Connects balances to the work | S | L | No |
| 14 | Server-side "no receipt needed" | Stops the web/phone mismatch | M (upstream) | M | No |
| 15 | QR sign-in from the web | Removes typing the server address | L (upstream) | L | Yes (camera) |
| 16 | Share-sheet extension, widget | Capture from Mail/Files; glance at cash | L | M | Yes |

## Proposed Settings sections

These are flat hairline rows ("Fönster", convention 15). Switches are for toggles only; there is no save button, and there are no cards.

1. **Company:** Deus Labs Stockholm AB with the server host as meta. Tapping it opens a detail page: org number, server, how you signed in, key prefix, scopes, and "Switch company" (reconnect). The key prefix leaves the top level.
2. **Capture:**
   - Open on the scanner (off by default; Dext).
   - Save scans to Photos (off).
   - Look for missing receipts (30 days).
3. **Notifications:**
   - Snap the receipt (after card payment).
   - Weekly reminder of missing receipts (Monday morning).
   - Upload problems.

   If iOS has blocked notifications, show one ochre line: "Notifications are off in iOS Settings. Open Settings."
4. **Security:**
   - Require Face ID.
   - Lock after: Immediately / 1 min / 5 min.
   - Hide amounts in the app switcher.
5. **On this iPhone:**
   - Waiting to upload (tap opens the list, with Retry).
   - Kept for 30 days (with "Clear now").
6. **Help:**
   - Open Accounted on the web.
   - Report a problem: mail with the version, server host and queue state, no amounts.
   - Privacy.
   - Open-source licenses.
7. **Disconnect** (destructive, on its own).

Footer: version and build, MIT, the not-affiliated line.

Leave out a theme picker (follow the system), subscription, and data export (SIE and backups live on the web).
