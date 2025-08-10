import { writable } from 'svelte/store';

const createThemeStore = () => {
    const { subscribe, set, update } = writable<'light' | 'dark'>('light');

    return {
        subscribe,
        set,
        toggle: () => update(theme => {
            const newTheme = theme === 'light' ? 'dark' : 'light';
            document.documentElement.classList.toggle('dark', newTheme === 'dark');
            localStorage.setItem('theme', newTheme);
            return newTheme;
        }),
        init: () => {
            const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const theme = savedTheme || (prefersDark ? 'dark' : 'light');
            document.documentElement.classList.toggle('dark', theme === 'dark');
            set(theme);
        }
    };
};

export const theme = createThemeStore();
