import type { z } from 'zod';

export type ScopeCliOption = {
  flag: string;
  key: string;
  description: string;
  required?: boolean;
};

export type ScopeDefinition<
  TScopeId extends string = string,
  TInput = unknown,
> = {
  id: TScopeId;
  label: string;
  description: string;
  inputSchema?: z.ZodType<TInput>;
  cliOptions?: readonly ScopeCliOption[];
};
