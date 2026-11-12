/** Base class for all errors raised by LLM Serving Lab. */
export class LlmServingLabError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class ConfigError extends LlmServingLabError {}
export class WorkloadConfigError extends LlmServingLabError {}

export class CapacityExceededError extends LlmServingLabError {}

export class UnknownRequestError extends LlmServingLabError {}

export class ReservationError extends LlmServingLabError {}

export class RequestValidationError extends LlmServingLabError {}

export class RequestTooLargeError extends LlmServingLabError {}

/** The scheduler returned a plan that violates the documented invariants. */
export class PlanValidationError extends LlmServingLabError {}

/** There is work to do, but the scheduler produced no forward progress. */
export class SimulationStalledError extends LlmServingLabError {}

/** A safety guard (`maxSteps` / `maxSimTimeMs`) was hit. */
export class SimulationLimitError extends LlmServingLabError {}
