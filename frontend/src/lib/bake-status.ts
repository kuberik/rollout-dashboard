import type { Component } from 'svelte'
import type { SVGAttributes } from 'svelte/elements';
import {
    CheckCircleSolid,
    ExclamationCircleSolid,
    ClockSolid,
    PauseSolid,
    CloseOutline
} from 'flowbite-svelte-icons';

type BakeStatusIconComponent = Component<SVGAttributes<SVGElement> & { color?: string }>;

export type BakeStatusIconConfig = {
    icon: BakeStatusIconComponent;
    color: string;
};

export function getBakeStatusIcon(bakeStatus?: string): BakeStatusIconConfig {
    switch (bakeStatus) {
        case 'Succeeded':
            return { icon: CheckCircleSolid, color: 'text-green-600 dark:text-green-400' };
        case 'Failed':
            return { icon: ExclamationCircleSolid, color: 'text-red-600 dark:text-red-400' };
        case 'InProgress':
            return { icon: ClockSolid, color: 'text-yellow-600 dark:text-yellow-400' };
        case 'Cancelled':
            return { icon: CloseOutline, color: 'text-gray-600 dark:text-gray-400' };
        case 'None':
            return { icon: PauseSolid, color: 'text-gray-600 dark:text-gray-400' };
        default:
            return { icon: ClockSolid, color: 'text-gray-600 dark:text-gray-400' };
    }
}
