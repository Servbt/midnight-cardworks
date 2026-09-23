/**
 * Payment errors split into two kinds.
 *
 * Transient failures (Stripe unreachable, database contention) are worth retrying, so the
 * webhook answers 5xx and Stripe redelivers. Permanent failures (an over-refund, a currency
 * mismatch, an order that no longer exists) can never succeed on retry: answering 5xx for
 * those makes Stripe redeliver forever and eventually disable the endpoint, which would
 * stall *every* payment event rather than just the bad one.
 *
 * Permanent failures are therefore recorded on the event and acknowledged with 2xx.
 */
export class PermanentPaymentError extends Error {
  readonly permanent = true;
  constructor(message: string) {
    super(message);
    this.name = 'PermanentPaymentError';
  }
}

/**
 * Detects permanent errors across module boundaries. The flag is checked as well as the
 * prototype so a duplicated module instance cannot silently downgrade the classification
 * and reintroduce the retry storm.
 */
export function isPermanentPaymentError(error: unknown): boolean {
  if (error instanceof PermanentPaymentError) return true;
  return typeof error === 'object' && error !== null && (error as { permanent?: unknown }).permanent === true;
}
