export function getBakeStatusColor(
    bakeStatus?: string
): 'green' | 'red' | 'yellow' | 'blue' | 'gray' {
    switch (bakeStatus) {
        case 'Succeeded':
            return 'green';
        case 'Failed':
            return 'red';
        case 'InProgress':
            return 'yellow';
        case 'Deploying':
            return 'blue';
        default:
            return 'gray';
    }
}
