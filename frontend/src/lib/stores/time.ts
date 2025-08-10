import { readable } from 'svelte/store';

export const now = readable<Date>(new Date(), (set) => {
    const interval = setInterval(() => set(new Date()), 1000);
    return () => clearInterval(interval);
});
