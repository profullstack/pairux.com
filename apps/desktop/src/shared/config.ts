/**
 * Shared configuration for the desktop app.
 *
 * API_BASE_URL always defaults to pairux.com.
 * Override with the PAIRUX_API_URL env var to point at a different server
 * (e.g. PAIRUX_API_URL=http://localhost:3000 for local development).
 */

export const APP_URL = 'https://pairux.com';

const raw = typeof process !== 'undefined' ? process.env.PAIRUX_API_URL?.trim() : undefined;
const envOverride = raw !== '' ? raw : undefined;

export const API_BASE_URL = envOverride ?? APP_URL;
