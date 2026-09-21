export type TimingStep = {
  name: string;
  ms: number;
  detail?: Record<string, any>;
};

export function elapsed_ms(started: number): number {
  return Date.now() - started;
}

export function push_timing(
  meta: Record<string, any>,
  name: string,
  ms: number,
  detail?: Record<string, any>,
): void {
  const timings = meta.timings && typeof meta.timings === "object" ? meta.timings : { steps: [] };
  const steps: TimingStep[] = Array.isArray(timings.steps) ? timings.steps : [];
  const step: TimingStep = { name, ms: Math.max(0, Math.round(ms)) };
  if (detail && Object.keys(detail).length) step.detail = detail;
  steps.push(step);
  timings.steps = steps;
  timings.stepSumMs = steps.reduce((sum, s) => sum + (Number(s.ms) || 0), 0);
  if (timings.totalMs == null) timings.totalMs = timings.stepSumMs;
  meta.timings = timings;
}

/** Wall-clock of the command. Nested steps can sum to more than this. */
export function set_wall_ms(meta: Record<string, any>, started: number): void {
  const timings = meta.timings && typeof meta.timings === "object" ? meta.timings : { steps: [] };
  timings.totalMs = elapsed_ms(started);
  meta.timings = timings;
}
