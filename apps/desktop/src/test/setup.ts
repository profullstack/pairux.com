import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock the electron API with the correct property name
const mockElectronAPI = {
  invoke: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

// Make electron API available globally using the correct property name
Object.defineProperty(window, 'electronAPI', {
  writable: true,
  configurable: true,
  value: mockElectronAPI,
});

// Export for test access
export { mockElectronAPI };
