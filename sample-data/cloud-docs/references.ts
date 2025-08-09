export const substitutions = {
    "service": 'Atlas',
} as const;
export const refs = {
    'cluster-private-endpoint': { title: 'Set Up a Private Endpoint for a Dedicated Cluster', url: 'cluster-private-endpoint' },
    'manage-atlas-cli': { title: 'Manage the Atlas CLI', url: 'manage-atlas-cli' },
} as const;
const references = { substitutions, refs } as const;
export default references;
