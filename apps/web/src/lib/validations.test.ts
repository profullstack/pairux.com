import { describe, it, expect } from 'vitest';
import {
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  joinSessionSchema,
  guestJoinSchema,
  createSessionSchema,
} from './validations';

describe('signupSchema', () => {
  it('validates a correct signup input', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'Password1',
      confirmPassword: 'Password1',
      displayName: 'Test User',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = signupSchema.safeParse({
      email: 'invalid-email',
      password: 'Password1',
      confirmPassword: 'Password1',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
  });

  it('rejects password without uppercase', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'password1',
      confirmPassword: 'password1',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('uppercase');
    }
  });

  it('rejects password without number', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'Password',
      confirmPassword: 'Password',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('number');
    }
  });

  it('rejects password shorter than 8 characters', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'Pass1',
      confirmPassword: 'Pass1',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('8 characters');
    }
  });

  it('rejects mismatched passwords', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'Password1',
      confirmPassword: 'Password2',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('Passwords do not match');
    }
  });

  it('rejects display name too short', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'Password1',
      confirmPassword: 'Password1',
      displayName: 'T',
    });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('validates a correct login input', () => {
    const result = loginSchema.safeParse({
      email: 'test@example.com',
      password: 'anypassword',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = loginSchema.safeParse({
      email: 'not-an-email',
      password: 'password',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = loginSchema.safeParse({
      email: 'test@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('forgotPasswordSchema', () => {
  it('validates a correct email', () => {
    const result = forgotPasswordSchema.safeParse({
      email: 'test@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = forgotPasswordSchema.safeParse({
      email: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('validates matching passwords', () => {
    const result = resetPasswordSchema.safeParse({
      password: 'NewPassword1',
      confirmPassword: 'NewPassword1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects mismatched passwords', () => {
    const result = resetPasswordSchema.safeParse({
      password: 'NewPassword1',
      confirmPassword: 'DifferentPassword1',
    });
    expect(result.success).toBe(false);
  });
});

describe('joinSessionSchema', () => {
  it('validates a correct join code and display name', () => {
    const result = joinSessionSchema.safeParse({
      joinCode: 'ABC123',
      displayName: 'Test User',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.joinCode).toBe('ABC123');
    }
  });

  it('transforms lowercase join code to uppercase', () => {
    const result = joinSessionSchema.safeParse({
      joinCode: 'abc123',
      displayName: 'Test User',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.joinCode).toBe('ABC123');
    }
  });

  it('rejects join code with wrong length', () => {
    const result = joinSessionSchema.safeParse({
      joinCode: 'ABC',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
  });

  it('rejects join code with invalid characters', () => {
    const result = joinSessionSchema.safeParse({
      joinCode: 'ABC-12',
      displayName: 'Test User',
    });
    expect(result.success).toBe(false);
  });
});

describe('guestJoinSchema', () => {
  it('validates a correct display name', () => {
    const result = guestJoinSchema.safeParse({
      displayName: 'Guest User',
    });
    expect(result.success).toBe(true);
  });

  it('rejects display name too short', () => {
    const result = guestJoinSchema.safeParse({
      displayName: 'G',
    });
    expect(result.success).toBe(false);
  });
});

describe('createSessionSchema', () => {
  it('validates with defaults', () => {
    const result = createSessionSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowGuestControl).toBe(false);
      expect(result.data.maxParticipants).toBe(5);
    }
  });

  it('validates with custom values', () => {
    const result = createSessionSchema.safeParse({
      name: 'My Session',
      allowGuestControl: true,
      maxParticipants: 3,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('My Session');
      expect(result.data.allowGuestControl).toBe(true);
      expect(result.data.maxParticipants).toBe(3);
    }
  });

  it('rejects maxParticipants outside range', () => {
    const result = createSessionSchema.safeParse({
      maxParticipants: 20,
    });
    expect(result.success).toBe(false);
  });
});
