import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const githubWorkflow = readFileSync(new URL('../.github/workflows/production-deploy.yml', import.meta.url), 'utf8')

describe('single production deployment policy', () => {
  it('disables direct Vercel Git auto deploys on main only', () => {
    expect(config.git.deploymentEnabled).toEqual({ main: false })
    // Branches not matched by the rule keep Git preview deployments.
    expect(config.git.deploymentEnabled['feat/*']).toBeUndefined()
  })

  it('retains the gated GitHub Actions production deployment', () => {
    expect(githubWorkflow).toContain('Single Vercel production deployment')
    expect(githubWorkflow).toContain('Deploy latest main to Vercel Production')
    expect(githubWorkflow).toContain("if: github.event_name != 'pull_request'")
    expect(githubWorkflow).toContain('needs:')
    expect(githubWorkflow).toContain('      - frontend')
    expect(githubWorkflow).toContain('      - backend')
    expect(githubWorkflow).toContain("check_url 'https://cf.hnchpower.cn/health/db'")
  })
})
