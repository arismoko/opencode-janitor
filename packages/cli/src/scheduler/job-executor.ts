import type { CliConfig } from '../config/schema';
import type { QueuedJobRow } from '../db/models';
import type { buildTriggerContext } from '../reviews/context';
import type {
  AgentExecutionPipeline,
  AgentRunResult,
} from './agent-execution-pipeline';
import type { SchedulerDeps } from './worker';

export interface JobExecutionSummary {
  totalFindings: number;
  agentRuns: Array<{
    agent: string;
    outcome: AgentRunResult['outcome'];
    findingsCount: number;
    retryable: boolean;
    errorCode?: string;
    durationMs: number;
  }>;
  failedRuns: Array<{
    agent: string;
    result: AgentRunResult;
  }>;
}

export type AgentResultMap = Map<string, AgentRunResult>;

export function selectAgents(
  deps: SchedulerDeps,
  job: QueuedJobRow,
  requestedAgent: string | null,
) {
  const { config, registry } = deps;
  return registry.agents().filter((spec) => {
    if (requestedAgent) {
      const agentConfig = config.agents[spec.agent];
      return spec.agent === requestedAgent && agentConfig.enabled;
    }
    return spec.supportsTrigger(config, job.kind);
  });
}

export async function executeAgentsInChunks(
  pipeline: AgentExecutionPipeline,
  job: QueuedJobRow,
  selectedSpecs: ReturnType<SchedulerDeps['registry']['agents']>,
  parallelism: number,
  trigger: ReturnType<typeof buildTriggerContext>,
): Promise<AgentResultMap> {
  const resultByAgent: AgentResultMap = new Map();
  for (let i = 0; i < selectedSpecs.length; i += parallelism) {
    const chunk = selectedSpecs.slice(i, i + parallelism);
    const chunkResults = await Promise.all(
      chunk.map((spec) => pipeline.execute(job, spec, trigger)),
    );
    chunk.forEach((spec, index) => {
      const result = chunkResults[index];
      if (result) {
        resultByAgent.set(spec.agent, result);
      }
    });
  }
  return resultByAgent;
}

export function summarizeExecution(
  selectedSpecs: ReturnType<SchedulerDeps['registry']['agents']>,
  resultByAgent: AgentResultMap,
): JobExecutionSummary {
  const totalFindings = [...resultByAgent.values()].reduce(
    (sum, result) => sum + result.findingsCount,
    0,
  );

  const agentRuns = selectedSpecs.map((spec) => {
    const result = resultByAgent.get(spec.agent);
    return {
      agent: spec.agent,
      outcome: result?.outcome ?? 'failed_terminal',
      findingsCount: result?.findingsCount ?? 0,
      retryable: result?.retryable ?? false,
      errorCode: result?.errorCode,
      durationMs: result?.summary.durationMs ?? 0,
    };
  });

  const failedRuns = selectedSpecs.flatMap((spec) => {
    const result = resultByAgent.get(spec.agent);
    if (!result || result.success) {
      return [];
    }
    return [{ agent: spec.agent, result }];
  });

  return { totalFindings, agentRuns, failedRuns };
}
