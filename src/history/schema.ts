import { z } from 'zod';

const ReviewFindingSchema = z.object({
  exactKey: z.string(),
  scopedKey: z.string(),
  category: z.string(),
  location: z.string(),
});

const ReviewRecordSchema = z.object({
  sha: z.string(),
  subject: z.string(),
  date: z.string(),
  findings: z.array(ReviewFindingSchema),
  findingCount: z.number().int().min(0),
  clean: z.boolean(),
});

export const HistoryFileSchema = z.object({
  version: z.literal(1),
  reviews: z.array(ReviewRecordSchema),
});
