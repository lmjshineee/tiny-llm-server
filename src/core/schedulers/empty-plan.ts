import type { StepPlan } from '../types'

/** A plan with no work. Each call returns fresh arrays so callers cannot share state. */
export function emptyPlan(): StepPlan {
  return { admit: [], prefill: [], decode: [] }
}
