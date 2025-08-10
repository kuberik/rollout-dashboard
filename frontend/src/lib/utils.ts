import type { Rollout } from "../types";


export function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

export function formatTimeAgo(start: string, end: Date = new Date()): string {
    return `${formatDuration(start, end)} ago`;
}

export function formatDuration(timestamp: string, now: Date = new Date()): string {
    const date = new Date(timestamp);
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) {
        return `${diffInSeconds} second${diffInSeconds === 1 ? '' : 's'}`;
    }

    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) {
        return `${diffInMinutes} minute${diffInMinutes === 1 ? '' : 's'}`;
    }

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
        return `${diffInHours} hour${diffInHours === 1 ? '' : 's'}`;
    }

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 30) {
        return `${diffInDays} day${diffInDays === 1 ? '' : 's'}`;
    }

    const diffInMonths = Math.floor(diffInDays / 30);
    if (diffInMonths < 12) {
        return `${diffInMonths} month${diffInMonths === 1 ? '' : 's'}`;
    }

    const diffInYears = Math.floor(diffInMonths / 12);
    return `${diffInYears} year${diffInYears === 1 ? '' : 's'}`;
}

type StatusColor = 'yellow' | 'green' | 'red';

export function getRolloutStatus(deployment: Rollout): { color: StatusColor; text: string } {
    const readyCondition = deployment.status?.conditions?.find((c) => c.type === 'Ready');
    if (!readyCondition) {
        return { color: 'yellow', text: 'Unknown' };
    }
    return readyCondition.status === 'True'
        ? { color: 'green', text: 'Ready' }
        : { color: 'red', text: 'Error' };
}
