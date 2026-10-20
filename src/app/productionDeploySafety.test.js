import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const vercelBuildScript = readFileSync(
  new URL('../../scripts/vercel-production-build-v2.sh', import.meta.url),
  'utf8'
)

describe('production release migration safety', () => {
  it('builds the application without starting schema migrations', () => {
    expect(vercelBuildScript).toMatch(/npm run build/)
    expect(vercelBuildScript).not.toMatch(/^\s*(?:python(?:3)?|\$\{?[^\s]+).*run_schema_migrations\.py/m)
    expect(vercelBuildScript).not.toContain('DATABASE_URL')
    expect(vercelBuildScript).not.toContain('QUICKSDK_DATABASE_URL')
  })

  it('explicitly announces database migrations are skipped in production', () => {
    expect(vercelBuildScript).toContain('VERCEL_ENV')
    expect(vercelBuildScript).toContain('skipping database schema migrations')
  })
})
