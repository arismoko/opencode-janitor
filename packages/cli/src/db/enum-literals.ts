import { AGENT_NAMES, Severity } from '@opencode-janitor/shared';

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function toSqlInList(values: readonly string[]): string {
  return values.map((value) => quoteSqlLiteral(value)).join(',');
}

export const AGENT_SQL_LIST = toSqlInList(AGENT_NAMES);
export const SEVERITY_SQL_LIST = toSqlInList(Severity.options);
