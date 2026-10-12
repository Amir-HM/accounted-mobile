/**
 * One-shot intents handed from a notification to a screen. Kept in memory,
 * never in the URL, so a link someone sends cannot open the camera by itself.
 */
let scanFor: string | null = null;

export function armScan(transactionId: string) {
  scanFor = transactionId;
}

export const hasScan = (transactionId: string) => scanFor === transactionId;

/** True once, for the payment the notification was about. */
export function takeScan(transactionId: string): boolean {
  if (scanFor !== transactionId) return false;
  scanFor = null;
  return true;
}
