import { z } from 'zod';

const SuppressionSchema = z.object({
  exactKey: z.string(),
  scopedKey: z.string(),
  tier: z.enum(['exact', 'scoped']),
  reason: z.string().optional(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  ttlDays: z.number().int().min(1),
  original: z.object({
    category: z.enum(['DRY', 'DEAD', 'STRUCTURAL']),
    location: z.string(),
    evidence: z.string(),
    prescription: z.string(),
    sha: z.string(),
  }),
});

export const SuppressionsFileSchema = z.object({
  version: z.literal(1),
  suppressions: z.array(SuppressionSchema),
});
