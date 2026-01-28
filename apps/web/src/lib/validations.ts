import { z } from 'zod';

// Password must be at least 8 characters with at least one uppercase letter and one number
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const signupSchema = z
  .object({
    email: z.string().email('Please enter a valid email address'),
    password: passwordSchema,
    confirmPassword: z.string(),
    firstName: z
      .string()
      .min(1, 'First name is required')
      .max(50, 'First name must be less than 50 characters'),
    lastName: z
      .string()
      .min(1, 'Last name is required')
      .max(50, 'Last name must be less than 50 characters'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

// Join code is 6 alphanumeric characters (case-insensitive, stored uppercase)
export const joinSessionSchema = z.object({
  joinCode: z
    .string()
    .length(6, 'Join code must be 6 characters')
    .regex(/^[A-Za-z0-9]+$/, 'Join code must be letters and numbers only')
    .transform((val) => val.toUpperCase()),
  displayName: z
    .string()
    .min(2, 'Display name must be at least 2 characters')
    .max(50, 'Display name must be less than 50 characters'),
});

// For joining via link (display name only, code comes from URL)
export const guestJoinSchema = z.object({
  displayName: z
    .string()
    .min(2, 'Display name must be at least 2 characters')
    .max(50, 'Display name must be less than 50 characters'),
});

// Session creation settings
export const createSessionSchema = z.object({
  name: z
    .string()
    .min(1, 'Session name is required')
    .max(100, 'Session name must be less than 100 characters')
    .optional(),
  allowGuestControl: z.boolean().default(false),
  maxParticipants: z.number().min(1).max(10).default(5),
  mode: z.enum(['p2p', 'sfu']).default('p2p'),
});

// Chat message schema
export const sendChatMessageSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  content: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(500, 'Message must be less than 500 characters'),
  participantId: z.string().uuid('Invalid participant ID').optional(),
  recipientId: z.string().uuid('Invalid recipient ID').optional(), // For DMs
});

// Chat history query schema
export const chatHistorySchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  limit: z.coerce.number().min(1).max(100).default(100),
  before: z.string().datetime().optional(), // For pagination - get messages before this timestamp
});

// Push subscription schema
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url('Invalid endpoint URL'),
  keys: z.object({
    p256dh: z.string().min(1, 'p256dh key is required'),
    auth: z.string().min(1, 'Auth key is required'),
  }),
  participantId: z.string().uuid('Invalid participant ID').optional(),
});

// Notification preferences schema
export const notificationPreferencesSchema = z.object({
  pushEnabled: z.boolean().default(true),
  controlRequest: z.boolean().default(true),
  chatMessage: z.boolean().default(true),
  participantJoined: z.boolean().default(true),
  participantLeft: z.boolean().default(true),
  hostDisconnected: z.boolean().default(true),
});

// Type exports
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type JoinSessionInput = z.infer<typeof joinSessionSchema>;
export type GuestJoinInput = z.infer<typeof guestJoinSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
export type ChatHistoryInput = z.infer<typeof chatHistorySchema>;
