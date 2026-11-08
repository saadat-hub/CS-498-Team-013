import { z } from 'zod';
// Request contracts can be imported by the future frontend. Server business validation remains authoritative.
export const promptSchema = z.string().min(1).max(20000);
export const submissionSchema = z.object({
  challengeSlug: z.string(),
  prompt: promptSchema,
  idempotencyKey: z.string().min(8).max(100),
});
export const draftSchema = z.object({
  prompt: z.string().max(20000),
  rev: z.number().int().nonnegative(),
  tokenEstimate: z.number().optional(),
  instantPassed: z.number().optional(),
  instantTotal: z.number().optional(),
});
export const profileSchema = z.object({
  displayName: z.string().min(1).max(40).optional(),
  handle: z
    .string()
    .regex(/^[a-z0-9_]{3,20}$/)
    .optional(),
  timezone: z.string().optional(),
  leaderboardOptIn: z.boolean().optional(),
  avatarUrl: z.url().nullable().optional(),
});
export const requestContracts: Record<string, z.ZodType> = {
  'POST /api/v1/auth/magic-link': z.object({ email: z.email().max(254) }),
  'PATCH /api/v1/me': profileSchema,
  'POST /api/v1/me/onboarding': z.object({
    displayName: z.string().min(1).max(40),
    handle: z.string().regex(/^[a-z0-9_]{3,20}$/),
    timezone: z.string(),
    experience: z.enum(['new', 'some', 'pro']),
  }),
  'POST /api/v1/tokens/count': z.object({ text: z.string().max(20000) }),
  'PUT /api/v1/drafts/:slug': draftSchema,
  'POST /api/v1/submissions': submissionSchema,
  'POST /api/v1/library': z.object({
    title: z.string().min(1).max(80),
    prompt: promptSchema,
    tags: z.array(z.string()).optional(),
    submissionId: z.uuid().optional(),
  }),
  'POST /api/v1/notifications/read': z.union([
    z.object({ all: z.literal(true) }),
    z.object({ ids: z.array(z.number().int().positive()) }),
  ]),
  'POST /api/v1/admin/challenges/:slug/dry-run': z.object({ prompt: promptSchema }),
  'POST /api/v1/admin/users/:id/xp': z.object({
    amount: z.number().int().min(-10000).max(10000),
    note: z.string().min(1),
  }),
};
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().optional(),
});
