import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import {
  storeAuth,
  getStoredAuth,
  clearStoredAuth,
  isAuthExpired,
  type StoredAuth,
} from './secure-storage';

const mockAuth: StoredAuth = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  expiresAt: Date.now() + 3600000, // 1 hour from now
  user: { id: 'user-1', email: 'test@example.com' },
};

describe('secure-storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('storeAuth', () => {
    it('should store auth data in secure store', async () => {
      await storeAuth(mockAuth);
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'pairux_auth',
        JSON.stringify(mockAuth)
      );
    });
  });

  describe('getStoredAuth', () => {
    it('should return stored auth data', async () => {
      vi.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify(mockAuth));

      const result = await getStoredAuth();
      expect(result).toEqual(mockAuth);
    });

    it('should return null when no data stored', async () => {
      vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);

      const result = await getStoredAuth();
      expect(result).toBeNull();
    });

    it('should return null for invalid JSON', async () => {
      vi.mocked(SecureStore.getItemAsync).mockResolvedValue('invalid-json');

      const result = await getStoredAuth();
      expect(result).toBeNull();
    });
  });

  describe('clearStoredAuth', () => {
    it('should delete auth data from secure store', async () => {
      await clearStoredAuth();
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('pairux_auth');
    });
  });

  describe('isAuthExpired', () => {
    it('should return false for non-expired token', () => {
      const auth: StoredAuth = {
        ...mockAuth,
        expiresAt: Date.now() + 3600000, // 1 hour from now
      };
      expect(isAuthExpired(auth)).toBe(false);
    });

    it('should return true for expired token', () => {
      const auth: StoredAuth = {
        ...mockAuth,
        expiresAt: Date.now() - 1000, // 1 second ago
      };
      expect(isAuthExpired(auth)).toBe(true);
    });

    it('should return true for token expiring within 5 minutes', () => {
      const auth: StoredAuth = {
        ...mockAuth,
        expiresAt: Date.now() + 2 * 60 * 1000, // 2 minutes from now (within 5 minute buffer)
      };
      expect(isAuthExpired(auth)).toBe(true);
    });

    it('should return false for token expiring after 5 minutes', () => {
      const auth: StoredAuth = {
        ...mockAuth,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes from now
      };
      expect(isAuthExpired(auth)).toBe(false);
    });
  });
});
