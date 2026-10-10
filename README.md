# Accounted Mobile

An iPhone companion for [Accounted](https://github.com/erp-mafia/accounted), the open-source Swedish bookkeeping system. Snap a receipt, match it to the bank payment, glance at your balances.

Status: v0, in use at Deus Labs Stockholm AB. Not affiliated with the Accounted project.

## What it does

- **Missing receipts:** outgoing bank payments from the last 120 days that have no underlag.
- **Capture:** the iOS document scanner (multi-page receipts become one PDF), a photo, or a file.
- **Attach:** upload to the archive and pin the receipt to the payment in one step, or archive now and match later.
- **Overview:** bank balances as reported by the bank, plus result, revenue, expenses and VAT for the current fiscal year.

## Receipts are never lost

Since 2024-07-01 a paper receipt may be thrown away once it is photographed, if the transfer can't change or lose it (Bokföringslagen 7 kap. 6 §). The app makes the transfer safe:

1. Each capture is copied into the app's sandbox and hashed (SHA-256) before any network call.
2. The upload uses the capture id as `Idempotency-Key`, so a retry after a dropped response cannot create a duplicate.
3. The server's `sha256_hash` must equal the local hash, or the item fails visibly and the paper must be kept.
4. The queue survives app restarts and no network. It retries on launch, on foreground, on reconnect, and every minute.

## Requirements

- An Accounted server (self-hosted or hosted) with the public v1 API.
- An API key created under **Settings → API** with these scopes: `companies:read`, `documents:read`, `documents:write`, `transactions:read`, `transactions:write`, `reports:read`. Limit it to one company.

## Develop

```bash
npm install
npx expo run:ios          # development build; the document scanner does not run in Expo Go
npx tsc --noEmit
```

The app only talks to the server over the documented REST API (`/api/v1/openapi.json`). It contains no Accounted source code, which is why it can be MIT licensed while the server is AGPL-3.0.

## Roadmap

- **v0:** API key, missing receipts, capture, attach, overview. (This version.)
- **v1:**
  - Sign in with OAuth (PKCE). Needs `accounted://` accepted as a redirect upstream.
  - Push after a card payment, through a webhook relay. Needs `transaction.synced` exposed as a public webhook event upstream.
  - Share-sheet extension.
- **v2:**
  - Uploads that go through the inbox, with AI field extraction.
  - Approving pending operations.
  - Android.

## License

MIT, see [LICENSE](LICENSE).
