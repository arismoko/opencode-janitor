import { z } from 'zod';

export const Severity = z.enum(['P0', 'P1', 'P2', 'P3']);
export type Severity = z.infer<typeof Severity>;

export const BaseFinding = z.object({
  location: z.string().describe('file:line'),
  severity: Severity,
  evidence: z.string().describe('Concrete proof of the issue'),
  prescription: z.string().describe('Exact action to fix'),
});
