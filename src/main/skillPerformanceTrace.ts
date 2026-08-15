import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export interface SkillPerformanceSample {
  operation: string;
  subject?: string;
  durationMs: number;
  outcome: "completed" | "failed";
  phases: Record<string, number>;
}

export type SkillPerformanceRecorder = (
  sample: SkillPerformanceSample
) => void | Promise<void>;

interface SkillPerformanceTrace {
  phases: Map<string, number>;
}

const traceStorage = new AsyncLocalStorage<SkillPerformanceTrace>();

const rounded = (value: number) => Math.max(0, Math.round(value * 10) / 10);

export const measureSkillPerformancePhase = async <T>(
  phase: string,
  operation: () => Promise<T>
): Promise<T> => {
  const trace = traceStorage.getStore();
  if (!trace) return operation();
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    trace.phases.set(
      phase,
      (trace.phases.get(phase) ?? 0) + performance.now() - startedAt
    );
  }
};

export const runSkillPerformanceTrace = async <T>(
  operationName: string,
  subject: string | undefined,
  recorder: SkillPerformanceRecorder | undefined,
  operation: () => Promise<T>
): Promise<T> => {
  if (!recorder || traceStorage.getStore()) return operation();
  const trace: SkillPerformanceTrace = { phases: new Map() };
  const startedAt = performance.now();
  let outcome: SkillPerformanceSample["outcome"] = "completed";
  try {
    return await traceStorage.run(trace, operation);
  } catch (error) {
    outcome = "failed";
    throw error;
  } finally {
    const sample: SkillPerformanceSample = {
      operation: operationName,
      subject,
      durationMs: rounded(performance.now() - startedAt),
      outcome,
      phases: Object.fromEntries(
        [...trace.phases].map(([phase, durationMs]) => [phase, rounded(durationMs)])
      )
    };
    await Promise.resolve(recorder(sample)).catch(() => undefined);
  }
};
