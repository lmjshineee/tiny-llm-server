import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { BENCHMARK_SCHEMA_VERSION, runBenchmark } from '../src/core/index'

const schema = JSON.parse(
  readFileSync(resolve(process.cwd(), 'schemas/benchmark-report.schema.json'), 'utf8'),
) as object

function validate(report: unknown): { ok: boolean; errors: string } {
  const ajv = new Ajv({ allErrors: true, strict: true })
  const check = ajv.compile(schema)
  const ok = check(report) === true
  return { ok, errors: JSON.stringify(check.errors) }
}

describe('benchmark report JSON Schema', () => {
  it('validates a generated report and rejects schema violations', () => {
    const report = runBenchmark({ smoke: true, seed: 7 })

    expect(report.schemaVersion).toBe(BENCHMARK_SCHEMA_VERSION)
    const valid = validate(report)
    expect(valid.ok, valid.errors).toBe(true)

    expect(validate({ ...report, simulated: false }).ok).toBe(false)
    expect(validate({ ...report, schemaVersion: '2.0' }).ok).toBe(false)
    expect(validate({ ...report, scenarios: [] }).ok).toBe(false)
  })
})
