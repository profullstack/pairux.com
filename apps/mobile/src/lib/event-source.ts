/**
 * SSE (Server-Sent Events) wrapper for React Native.
 *
 * Wraps react-native-sse's EventSource with proper typing
 * for PairUX signaling events.
 */
import RNEventSource from 'react-native-sse';

type PairUXEvents = 'connected' | 'heartbeat' | 'signal' | 'presence-join' | 'presence-leave';

export type SSEEventHandler = (event: { data: string }) => void;

export interface SSEOptions {
  /** Extra request headers, e.g. the Authorization bearer token. */
  headers?: Record<string, string>;
}

export interface SSEConnection {
  addEventListener: (event: string, handler: SSEEventHandler) => void;
  close: () => void;
}

export function createEventSource(url: string, options: SSEOptions = {}): SSEConnection {
  // pollingInterval: 0 disables the library's built-in auto-reconnect. Its
  // retries would replay the captured Authorization header long after the
  // token expired, silently downgrading the stream to a guest identity —
  // callers own reconnection so every attempt carries a fresh token.
  const es = new RNEventSource<PairUXEvents>(url, {
    headers: options.headers,
    pollingInterval: 0,
  });

  return {
    addEventListener(event: string, handler: SSEEventHandler) {
      if (event === 'error') {
        es.addEventListener('error', () => {
          handler({ data: '' });
        });
        return;
      }

      // Cast to handle custom event types
      (es as RNEventSource<string>).addEventListener(event, (e) => {
        if ('data' in e && e.data != null) {
          handler({ data: e.data });
        }
      });
    },
    close() {
      es.close();
    },
  };
}
