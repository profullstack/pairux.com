import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures variables are available when vi.mock factories run (hoisted above imports)
const { mockAddEventListener, mockClose } = vi.hoisted(() => ({
  mockAddEventListener: vi.fn(),
  mockClose: vi.fn(),
}));

vi.mock('react-native-sse', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(() => ({
    addEventListener: mockAddEventListener,
    removeEventListener: vi.fn(),
    close: mockClose,
  })),
}));

import { createEventSource } from './event-source';
import RNEventSource from 'react-native-sse';

describe('event-source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create an SSEConnection wrapping RNEventSource', () => {
    const connection = createEventSource('https://example.com/sse');

    expect(RNEventSource).toHaveBeenCalledWith('https://example.com/sse');
    expect(connection).toHaveProperty('addEventListener');
    expect(connection).toHaveProperty('close');
  });

  it('should forward addEventListener calls to underlying EventSource', () => {
    const connection = createEventSource('https://example.com/sse');

    const handler = vi.fn();
    connection.addEventListener('signal', handler);

    expect(mockAddEventListener).toHaveBeenCalled();
  });

  it('should handle error events specially', () => {
    const connection = createEventSource('https://example.com/sse');

    const handler = vi.fn();
    connection.addEventListener('error', handler);

    expect(mockAddEventListener).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should close the underlying EventSource', () => {
    const connection = createEventSource('https://example.com/sse');
    connection.close();

    expect(mockClose).toHaveBeenCalled();
  });
});
