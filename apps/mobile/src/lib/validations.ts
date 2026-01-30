/**
 * Form validation schemas using Zod.
 */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const signupSchema = z
  .object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email('Please enter a valid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const joinSessionSchema = z.object({
  joinCode: z
    .string()
    .min(1, 'Join code is required')
    .max(10, 'Join code is too long')
    .regex(/^[A-Za-z0-9]+$/, 'Join code must be alphanumeric'),
  displayName: z.string().min(1, 'Display name is required').max(50, 'Display name is too long'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type JoinSessionInput = z.infer<typeof joinSessionSchema>;
