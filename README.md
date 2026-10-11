# Accounted Mobile

An iPhone companion for [Accounted](https://github.com/erp-mafia/accounted), the open-source Swedish bookkeeping system. Snap a receipt, get it read and checked against the bank payment, book it, approve what your agents prepared.

Built for and used by Deus Labs Stockholm AB. Not affiliated with the Accounted project. MIT licensed.

## What it does

- **Receipts:**
  - Payments missing a receipt.
  - Swipe a row to scan it or to mark "no receipt needed": a booked payment gets Accounted's own "Inget underlag krävs" mark, with a reason.
  - Capture with the iOS document scanner (multi-page receipts become one PDF), the latest photos and screenshots, or Files.
- **Reading and checks:**
  - Each receipt is archived and read by the server (supplier, date, totals, VAT).
  - The reading is then *verified*: amounts add up, the VAT is a Swedish rate, the org number passes its checksum, and the amount and date agree with the bank payment.
  - A receipt captured without a payment gets the matching payment suggested.
- **Booking (optional):**
  - Book unbooked payments using the server's proposals.
  - Category and VAT pickers, and a reverse-charge hint from the receipt.
  - A confirmation showing the real voucher lines from a dry run.
- **Approvals:** operations staged by Claude, other agents or the receipt hunt. Approve or reject them; high-risk ones ask for explicit confirmation.
- **Overview:** a to-do list, cash with a runway caption, the year's result, VAT, revenue and expenses, result per month, and bank accounts with their transactions.
- **Notifications:** "Snap the receipt" right after a card payment, and a nudge when something waits for approval.
- **Security:** sign in with Accounted (OAuth with PKCE) or an API key kept in the Keychain. Optional Face ID lock, and amounts hidden in the app switcher.

## Receipts are never lost

Since 2024-07-01 a paper receipt may be thrown away once it is photographed, provided the transfer cannot change or lose it (Bokföringslagen 7 kap. 6 §). The app makes the transfer safe:
- Each capture is copied into the app sandbox and hashed (SHA-256) before any network call.
- Uploads are idempotent.
- The server's hash must match the local one, or the item fails visibly.
- The queue survives restarts and loss of network.

## How it talks to Accounted

The app uses only Accounted's public interfaces, and no Accounted source code is copied, which is why it can be MIT licensed while the server is AGPL-3.0:
- **REST API:** `/api/v1`, with the published OpenAPI spec.
- **MCP tools, called over HTTP with the same key:**
  - the inbox upload, which reads the receipt;
  - booking proposals;
  - pending operations.

Permissions the app needs:
```
companies:read documents:read documents:write transactions:read transactions:write reports:read
bookkeeping:write pending_operations:read pending_operations:approve
```

## Running it against your own Accounted

1. **Build config (`app.json` → `expo.extra`):**
   - `defaultServer`: prefills the server field (optional).
   - `oauthReturnHop`: the https URL of your [OAuth return hop](infra/oauth-bounce). Accounted only redirects to registered https URIs, so this tiny Worker forwards the code to the app. Register the URL in Accounted under Settings as an OAuth client. Leave it empty to use API keys only.
   - `pushRelay`: the URL of your [push relay](infra/push-relay), which needs a `transactions:read` + `pending_operations:read` key. Leave it empty for no notifications.
   - `eas.projectId`: your Expo project id (needed for push tokens).
2. **Native modules:** `npm install`, then `npx expo run:ios` for a development build. The scanner, quick action and share features are native; Expo Go runs everything else, with the camera in place of the scanner.

Both Workers are a few dozen lines of code each and run on the free Cloudflare Workers plan.

## Upstream wishes

Two small changes in Accounted would make the Workers unnecessary for everyone:
1. Accept a native app redirect (`accounted://oauth/callback`, PKCE-bound like the existing Cursor deeplink) in the OAuth allowlist ([erp-mafia/accounted#3497](https://github.com/erp-mafia/accounted/issues/3497)).
2. Publish a `transaction.synced` (new bank transaction) webhook event, so push can be event-driven instead of polled ([erp-mafia/accounted#3498](https://github.com/erp-mafia/accounted/issues/3498)).

## Develop

```bash
npm install
npx expo run:ios     # development build
npx tsc --noEmit
```

## License

MIT, see [LICENSE](LICENSE).
