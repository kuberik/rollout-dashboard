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

export class FetchCommitsError extends Error {
    reason: CommitsError;
    constructor(reason: CommitsError, message: string) {
        super(message);
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
    dashboard?: string
) => ['rollout-commits', namespace, name, base, head, dashboard] as const;

export const githubStatusQueryKey = ['github-status'] as const;

export async function fetchCommits(
    namespace: string,
    name: string,
    base: string,
    head: string,
    dashboard?: string
): Promise<CommitsResponse> {
    const params = new URLSearchParams({ base, head });
    if (dashboard) params.set('dashboard', dashboard);
    const res = await fetch(`/api/rollouts/${namespace}/${name}/commits?${params}`);
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'github_not_connected') {
            throw new FetchCommitsError('not_connected', 'Connect GitHub to see changes');
        }
        if (body.error === 'github_no_access') {
            throw new FetchCommitsError('no_access', 'You do not have access to this repository');
        }
        throw new FetchCommitsError('error', body.error || 'Failed to fetch commit range');
    }
    return (await res.json()) as CommitsResponse;
}

export async function fetchGithubStatus(): Promise<GithubStatus> {
    const res = await fetch('/api/auth/github/status');
    if (!res.ok) return { configured: false, connected: false };
    return (await res.json()) as GithubStatus;
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
