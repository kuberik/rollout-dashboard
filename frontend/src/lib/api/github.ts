import { ApiError, apiJson } from './errors';

export type CommitInfo = {
    sha: string;
    message: string;
    author: string;
    authorUrl: string;
    avatarUrl: string;
    commitDate: string;
    url: string;
};

export type CommitsResponse = {
    // Inferred by the server from the range: 'forward' = commits deployed,
    // 'rollback' = commits reverted (head is behind base; the server re-fetched
    // the swapped range so `commits` lists what was reverted), 'same' = no change.
    direction: 'forward' | 'rollback' | 'same';
    ahead: number;
    behind: number;
    commits: CommitInfo[];
    additions: number;
    deletions: number;
    changedFiles: number;
};

// Distinguishable failure reasons so the UI can show a "Connect GitHub" prompt
// (not-connected) vs. a "you don't have access" note vs. a generic error.
export type CommitsError = 'not_connected' | 'no_access' | 'error';

/**
 * ⛔ IT EXTENDS `ApiError` NOW, AND THAT IS THE WHOLE POINT.
 *
 * A live UX critique measured **16 consecutive 401s** on this endpoint,
 * retried indefinitely, flooding the console with nothing visible on screen.
 * The cause was that this was a plain `Error`: it carried no status, so the
 * query client's retry policy could not tell "the user has not connected
 * GitHub" (an answer — a person has to act) from "the server hiccuped" (worth
 * one more try). Carrying the status makes `isRetryable` correct for free, and
 * `reason` stays for the three different things the UI SAYS.
 */
export class FetchCommitsError extends ApiError {
    reason: CommitsError;
    constructor(reason: CommitsError, message: string, status = 0, detail = '', url = '') {
        super(status, message, detail || message, url);
        this.name = 'FetchCommitsError';
        this.reason = reason;
    }
}

export type GithubStatus = {
    // Whether the server has GitHub App user-auth configured at all.
    configured: boolean;
    // Whether the current user has connected their GitHub account.
    connected: boolean;
    login?: string;
    avatarUrl?: string;
};

export const commitsQueryKey = (
    namespace: string,
    name: string,
    base: string,
    head: string,
    cluster?: string
) => ['rollout-commits', namespace, name, base, head, cluster] as const;

export const githubStatusQueryKey = ['github-status'] as const;

export async function fetchCommits(
    namespace: string,
    name: string,
    base: string,
    head: string,
    cluster?: string
): Promise<CommitsResponse> {
    const params = new URLSearchParams({ base, head });
    if (cluster) params.set('cluster', cluster);
    const url = `/api/rollouts/${namespace}/${name}/commits?${params}`;
    const res = await fetch(url).catch(() => null);
    if (!res) {
        throw new FetchCommitsError('error', 'No response from the server', 0, '', url);
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'github_not_connected') {
            throw new FetchCommitsError(
                'not_connected',
                'Connect GitHub to see changes',
                res.status,
                'GitHub account not connected',
                url
            );
        }
        if (body.error === 'github_no_access') {
            throw new FetchCommitsError(
                'no_access',
                'You do not have access to this repository',
                res.status,
                body.details || 'No access to this repository',
                url
            );
        }
        throw new FetchCommitsError(
            'error',
            body.error || 'Failed to fetch commit range',
            res.status,
            body.details || body.error || '',
            url
        );
    }
    return (await res.json()) as CommitsResponse;
}

export async function fetchGithubStatus(): Promise<GithubStatus> {
    // Not being able to ask IS the answer here: "GitHub is not available to
    // you". There is nothing for the reader to do about it and nothing to
    // print, so this one legitimately swallows.
    return apiJson<GithubStatus>('/api/auth/github/status').catch(() => ({
        configured: false,
        connected: false
    }));
}

// Full-page navigation to start the OAuth flow (a 302 to GitHub can't be
// followed by fetch). return_to brings the user back to where they were.
export function connectGithub(returnTo: string = window.location.pathname + window.location.search) {
    const params = new URLSearchParams({ return_to: returnTo });
    window.location.href = `/api/auth/github/login?${params}`;
}

export async function disconnectGithub(): Promise<void> {
    await fetch('/api/auth/github/logout', { method: 'POST' });
}

// First line of a commit message, truncated for compact display.
export function formatCommitMessage(message: string): string {
    const firstLine = message.split('\n')[0];
    return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
}
