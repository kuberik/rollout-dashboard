/** r34 — the five list pages. Each lane registers its page component here (one line per page). */
import type { Component } from 'svelte';
import type { HomeState } from '$lib/components/home/sketch/home-data';
import Rollouts from './Rollouts.svelte';
import Changes from './Changes.svelte';
import Environments from './Environments.svelte';
import Apps from './Apps.svelte';
import Home from './Home.svelte';

export type PageKey = 'rollouts' | 'changes' | 'environments' | 'apps' | 'inbox';
export type PageProps = { state: HomeState };
export const PAGE_NAME: Record<PageKey, string> = { rollouts: 'Rollouts', changes: 'Changes', environments: 'Environments', apps: 'Apps', inbox: 'Home' };
export const PAGES: Record<PageKey, Component<PageProps>> = { rollouts: Rollouts, changes: Changes, environments: Environments, apps: Apps, inbox: Home };
