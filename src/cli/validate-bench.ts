import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv from 'ajv'

const file = resolve(process.cwd(), process.argv[2] ?? 'bench-smoke.json')
const schemaFile = resolve(process.cwd(), 'schemas/benchmark-report.schema.json')

const schema = JSON.parse(readFileSync(schemaFile, 'utf8')) as object
const report = JSON.parse(readFileSync(file, 'utf8')) as unknown

const ajv = new Ajv({ allErrors: true, strict: true })
const validate = ajv.compile(schema)

if (!validate(report)) {
  console.error(`benchmark report failed schema validation: ${file}`)
  console.error(JSON.stringify(validate.errors, null, 2))
  process.exitCode = 1
} else {
  console.log(`benchmark report schema ok: ${file}`)
}
