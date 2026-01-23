import { describe, it, expect, vi, beforeEach } from 'vitest';
import { successResponse, errorResponse, handleApiError } from './api';
import { z } from 'zod';

describe('api utilities', () => {
  describe('successResponse', () => {
    it('returns JSON response with data', async () => {
      const data = { message: 'Success' };
      const response = successResponse(data);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ data });
    });

    it('returns custom status code', async () => {
      const data = { id: '123' };
      const response = successResponse(data, 201);

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).toEqual({ data });
    });

    it('handles null data', async () => {
      const response = successResponse(null);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ data: null });
    });

    it('handles array data', async () => {
      const data = [{ id: 1 }, { id: 2 }];
      const response = successResponse(data);

      const body = await response.json();
      expect(body).toEqual({ data });
    });
  });

  describe('errorResponse', () => {
    it('returns JSON response with error message', async () => {
      const response = errorResponse('Something went wrong');

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({ error: 'Something went wrong' });
    });

    it('returns custom status code', async () => {
      const response = errorResponse('Not found', 404);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toEqual({ error: 'Not found' });
    });

    it('returns 401 for unauthorized', async () => {
      const response = errorResponse('Unauthorized', 401);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });
  });

  describe('handleApiError', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('handles ZodError with formatted message', async () => {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(8),
      });

      try {
        schema.parse({ email: 'invalid', password: 'short' });
      } catch (error) {
        const response = handleApiError(error);
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('Invalid email');
      }
    });

    it('handles generic Error in development', async () => {
      vi.stubEnv('NODE_ENV', 'development');

      const error = new Error('Database connection failed');
      const response = handleApiError(error);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Database connection failed');

      vi.unstubAllEnvs();
    });

    it('hides error details in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');

      const error = new Error('Sensitive database info');
      const response = handleApiError(error);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('An unexpected error occurred');

      vi.unstubAllEnvs();
    });

    it('handles non-Error objects', async () => {
      const response = handleApiError('string error');

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('An unexpected error occurred');
    });

    it('handles null/undefined errors', async () => {
      const response1 = handleApiError(null);
      const response2 = handleApiError(undefined);

      expect(response1.status).toBe(500);
      expect(response2.status).toBe(500);
    });

    it('logs error to console', () => {
      const error = new Error('Test error');
      handleApiError(error);

      expect(console.error).toHaveBeenCalledWith('API Error:', error);
    });
  });
});
