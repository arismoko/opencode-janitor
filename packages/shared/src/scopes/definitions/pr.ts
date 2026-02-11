import { z } from 'zod';
import type { ScopeDefinition } from '../types';

const PrScopeInputSchema = z.object({
  prNumber: z.number().int().positive(),
});

export const PR_SCOPE_DEFINITION: ScopeDefinition<
  'pr',
  z.infer<typeof PrScopeInputSchema>
> = {
  id: 'pr',
  label: 'Pull Request',
  description: 'Pull request review context tied to PR metadata and diff.',
  inputSchema: PrScopeInputSchema,
  cliOptions: [
    {
      flag: '--pr <number>',
      key: 'prNumber',
      description: 'PR number to review',
      required: true,
    },
  ],
};
