/**
 * The User-Agent pairux.com sends on its server-side CoinPay calls. Every
 * Profullstack app shares one host, so the runtime default UA made them one
 * caller in CoinPay's logs and throttle. Server-only: browsers cannot set it.
 */
import pkg from '../../package.json';

export const COINPAY_UA = `pairux.com/${pkg.version} (+https://pairux.com)`;

/** A fetch that sends COINPAY_UA, for libraries that take one (coinpay-onboard oauth). */
export const coinpayFetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('user-agent', COINPAY_UA);
  return fetch(input, { ...init, headers });
}) as typeof fetch;
