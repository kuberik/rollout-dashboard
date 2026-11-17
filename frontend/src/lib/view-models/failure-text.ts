/**
 * The one sentence for a failed Retry, wherever it is reported: "Failed to retry: <reason>". A reason that already starts with the
 * prefix (the server answered and `failureText` wrote it) is kept as is; anything else (a network error) gets the prefix.
 */
export const RETRY_FAILED = 'Failed to retry';
export function retryFailureText(e: unknown): string {
	const reason = e instanceof Error && e.message.trim() !== '' ? e.message.trim() : '';
	if (reason === '') return RETRY_FAILED;
	return reason.startsWith(RETRY_FAILED) ? reason : `${RETRY_FAILED}: ${reason}`;
}

/** Where a failed Retry is reported: inside the confirm when one is open (a toast would say it twice, under its backdrop), else a toast. */
export function retryOutcome(e: unknown, confirmOpen: boolean): { message: string; toast: boolean } {
	return { message: retryFailureText(e), toast: !confirmOpen };
}

/**
 * The dialog's own callout for a failed confirm (Roll back and Retry draw it identically): the routine note's shape
 * (icon + tinted panel, `rounded-md border p-3`) in the danger role, inset above the footer.
 */
export const DIALOG_ERROR_CLASS = 't-meta flex items-start gap-2 break-words rounded-md border border-danger-line bg-danger-tint p-3 text-danger';

/**
 * The sentence for a failed request: `prefix`, then the server's own reason when it sent one ("Failed to change version: <reason>").
 * Reads the body's `details`, `error` or `message`, the first that is a non-empty string; a body that is not JSON adds nothing.
 */
export async function failureText(prefix: string, res: Response): Promise<string> {
	const body = (await res.json().catch(() => null)) as { details?: unknown; error?: unknown; message?: unknown } | null;
	const reason = [body?.details, body?.error, body?.message].find((v): v is string => typeof v === 'string' && v.trim() !== '');
	return reason ? `${prefix}: ${reason.trim()}` : prefix;
}
