/** Keep the real-mainnet lab switch out of production unless explicitly enabled. */
export const LAB_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_LAB === 'true';
