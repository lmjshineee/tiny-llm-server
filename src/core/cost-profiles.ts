import { DEFAULT_ENGINE_CONFIG } from './config'
import { ConfigError } from './errors'
import type { CostModel } from './types'

/**
 * Provenance for a cost profile that was fitted to real measurements. Every
 * field is required so a report cannot silently lose the "where did this come
 * from" answer.
 */
export interface CostProfileProvenance {
  readonly device: string
  readonly model: string
  readonly runtime: string
  readonly measuredOn: string
  /** Repo-relative path to the report that documents the fit. */
  readonly source: string
}

/**
 * A named cost model. Profiles are *alternatives*, never replacements: the
 * synthetic default stays the default, and every report names the profile it
 * used so two reports can never be compared by accident.
 */
export interface CostProfile {
  readonly id: string
  readonly label: string
  readonly cost: CostModel
  /** `null` when the profile was not derived from hardware measurements. */
  readonly provenance: CostProfileProvenance | null
  /** Known gaps between this profile and the machine it tries to describe. */
  readonly limitations: readonly string[]
}

/** The profile every command uses unless it is passed `--profile`. */
export const DEFAULT_COST_PROFILE_ID = 'synthetic-v1'

/**
 * `measured-m5-q4-0.5b` is a five-point linear fit to `calibration-01.md`:
 * single-stream decode at three quantizations, prefill at six prompt lengths,
 * and a depth sweep. It describes one machine, one model, one quantization,
 * one stream — see `limitations` for everything it cannot express.
 */
export const COST_PROFILES: readonly CostProfile[] = [
  {
    id: DEFAULT_COST_PROFILE_ID,
    label: 'Illustrative 7B-class 4-bit (not measured)',
    cost: DEFAULT_ENGINE_CONFIG.cost,
    provenance: null,
    limitations: [
      'Chosen to be roughly plausible for a 7B model in 4-bit on Apple silicon; not a measurement.',
      'Decode cost is independent of context length, which flatters short prompts and misses KV growth.',
    ],
  },
  {
    id: 'measured-m5-q4-0.5b',
    label: 'Qwen2.5-0.5B Q4_K_M on Apple M5 (single stream, short context)',
    cost: {
      stepOverheadMs: 1.83,
      prefillBaseMs: 4.6,
      prefillMsPerToken: 0.126,
      decodeBaseMs: 2.67,
      decodeMsPerRequest: 0.086,
      // 2 FLOPs per parameter per token for the 0.5B layer stack; the measured
      // saturating throughput implies ~1 TFLOPS of decode-shaped compute.
      decodeFlopsPerRequest: 716_000_000,
      decodeFlopsPerSecond: 1_000_000_000_000,
    },
    provenance: {
      device: 'Apple M5, MacBook Air Mac17,3, 8-core GPU, 16 GiB',
      model: 'Qwen2.5-0.5B-Instruct, Q4_K_M GGUF',
      runtime: 'llama.cpp 0.9.0 build 12110, Metal',
      measuredOn: '2026-11-14',
      source: 'docs/learning/notes/calibration-01.md',
    },
    limitations: [
      'Fitted at ~1k context. Decode cost grows with context; this model has no context term.',
      'Prefill is linear here, but the 8192-token point shows a quadratic attention term (~47% low if extrapolated).',
      'The roofline cap saturates batching at ~1.3k tok/s (measured batch 8/16/32 within 10%), but the measured decline past batch 16 is not modelled.',
      'Single machine, single model, single quantization, short runs; not a hardware ranking.',
    ],
  },
]

export function listCostProfileIds(): readonly string[] {
  return COST_PROFILES.map((profile) => profile.id)
}

export function isCostProfileId(id: string): boolean {
  return COST_PROFILES.some((profile) => profile.id === id)
}

/** Resolve a profile id or throw a `ConfigError` that names the valid ids. */
export function getCostProfile(id: string): CostProfile {
  const profile = COST_PROFILES.find((candidate) => candidate.id === id)
  if (profile === undefined) {
    throw new ConfigError(
      `unknown cost profile "${id}"; expected one of ${listCostProfileIds().join(', ')}`,
    )
  }
  return profile
}
