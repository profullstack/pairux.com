/**
 * Datafast Analytics - Goal tracking for PairUX
 * https://datafa.st
 */

// Extend Window interface for datafast
declare global {
  interface Window {
    datafast?: (event: string, data?: Record<string, unknown>) => void;
  }
}

/**
 * Track a custom goal/event with Datafast
 */
export function trackGoal(event: string, data?: Record<string, unknown>): void {
  if (typeof window !== 'undefined' && window.datafast) {
    window.datafast(event, data);
  }
}

// Pre-defined goal tracking functions for common events

/**
 * Track when user initiates checkout
 */
export function trackCheckout(data: {
  name?: string;
  email?: string;
  product_id?: string;
  plan?: 'pro' | 'team';
  price?: number;
}): void {
  trackGoal('initiate_checkout', data);
}

/**
 * Track successful signup
 */
export function trackSignup(data?: {
  method?: 'email' | 'google' | 'github';
  plan?: 'free' | 'pro' | 'team';
}): void {
  trackGoal('signup', data);
}

/**
 * Track successful login
 */
export function trackLogin(data?: { method?: 'email' | 'google' | 'github' }): void {
  trackGoal('login', data);
}

/**
 * Track app download click
 */
export function trackDownload(data: {
  platform: 'macos' | 'windows' | 'linux';
  method: 'direct' | 'homebrew' | 'winget' | 'apt' | 'aur' | 'script';
}): void {
  trackGoal('download', data);
}

/**
 * Track session start (host)
 */
export function trackSessionStart(data?: { mode?: 'p2p' | 'sfu' }): void {
  trackGoal('session_start', data);
}

/**
 * Track session join (viewer)
 */
export function trackSessionJoin(data?: { as_guest?: boolean }): void {
  trackGoal('session_join', data);
}

/**
 * Track feature page view
 */
export function trackPageView(data?: { page?: string; referrer?: string }): void {
  trackGoal('page_view', data);
}

/**
 * Track CTA button click
 */
export function trackCTAClick(data: { button: string; location: string }): void {
  trackGoal('cta_click', data);
}

/**
 * Track plan upgrade initiation
 */
export function trackUpgradeStart(data: {
  from_plan: 'free' | 'pro';
  to_plan: 'pro' | 'team';
}): void {
  trackGoal('upgrade_start', data);
}

/**
 * Track successful plan upgrade
 */
export function trackUpgradeComplete(data: { plan: 'pro' | 'team'; price: number }): void {
  trackGoal('upgrade_complete', data);
}

/**
 * Track RTMP stream start
 */
export function trackStreamStart(data: {
  platform: 'youtube' | 'twitch' | 'facebook' | 'custom';
}): void {
  trackGoal('stream_start', data);
}

/**
 * Track password reset request
 */
export function trackPasswordReset(): void {
  trackGoal('password_reset');
}

/**
 * Track contact/support form submission
 */
export function trackContact(data?: { type?: 'support' | 'sales' | 'feedback' }): void {
  trackGoal('contact', data);
}
