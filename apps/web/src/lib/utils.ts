import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names with Tailwind CSS classes
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Detect the user's operating system
 */
export type OS = 'macos' | 'windows' | 'linux' | 'unknown';
export type Arch = 'x64' | 'arm64' | 'unknown';

export function detectOS(): { os: OS; arch: Arch } {
  if (typeof window === 'undefined') {
    return { os: 'unknown', arch: 'unknown' };
  }

  const userAgent = navigator.userAgent.toLowerCase();

  let os: OS = 'unknown';
  let arch: Arch = 'unknown';

  // Detect OS from userAgent
  if (userAgent.includes('mac')) {
    os = 'macos';
  } else if (userAgent.includes('win')) {
    os = 'windows';
  } else if (userAgent.includes('linux')) {
    os = 'linux';
  }

  // Detect architecture from userAgent
  // ARM indicators: arm, aarch64, or Apple Silicon Macs (M1/M2/M3)
  if (userAgent.includes('arm') || userAgent.includes('aarch64')) {
    arch = 'arm64';
  } else {
    arch = 'x64';
  }

  return { os, arch };
}

/**
 * Format a number for display (e.g., 1000 -> 1k)
 */
export function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}k`;
  }
  return num.toString();
}
