/**
 * SSE (Server-Sent Events) wrapper for React Native.
 *
 * Wraps react-native-sse's EventSource with proper typing
 * for PairUX signaling events.
 */
import RNEventSource from 'react-native-sse';

type PairUXEvents = 'connected' | 'signal' | 'presence-join' | 'presence-leave';

export type SSEEventHandler = (event: { data: string }) => void;

export interface SSEConnection {
  addEventListener: (event: string, handler: SSEEventHandler) => void;
  close: () => void;
}

export function createEventSource(url: string): SSEConnection {
  const es = new RNEventSource<PairUXEvents>(url);

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
