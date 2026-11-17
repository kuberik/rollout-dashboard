/**
 * The sentence for a failed request: `prefix`, then the server's own reason when it sent one ("Failed to change version: <reason>").
 * Reads the body's `details`, `error` or `message`, the first that is a non-empty string; a body that is not JSON adds nothing.
 */
export async function failureText(prefix: string, res: Response): Promise<string> {
	const body = (await res.json().catch(() => null)) as { details?: unknown; error?: unknown; message?: unknown } | null;
	const reason = [body?.details, body?.error, body?.message].find((v): v is string => typeof v === 'string' && v.trim() !== '');
	return reason ? `${prefix}: ${reason.trim()}` : prefix;
}
