import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const workflow = parse(readFileSync('.github/workflows/portable-windows.yml', 'utf8'))
const steps = workflow.jobs.build.steps
const stepNamed = (name) => steps.find((step) => step.name === name)

describe('Windows task delivery workflow', () => {
  it('builds and verifies installer and portable artifacts from one tagged checkout', () => {
    expect(workflow.on.push.tags).toContain('task-build-*')
    expect(workflow.permissions).toEqual({ contents: 'write' })
    expect(stepNamed('Verify portable boundaries')?.run).toContain(
      'config/scripts/windows-delivery-workflow.test.mjs'
    )

    expect(stepNamed('Build portable executable')?.run).toBe('pnpm run build:win:portable')
    expect(stepNamed('Build Windows installer from packaged app')?.run).toContain(
      '--prepackaged $prepackaged'
    )
    expect(stepNamed('Verify silent installer')?.run).toContain("-ArgumentList '/S'")

    const uploadPaths = stepNamed('Upload Windows delivery artifacts')?.with?.path
    for (const artifact of [
      'dist/orca-windows-setup.exe',
      'dist/orca-windows-setup.exe.sha256',
      'dist/orca-windows-portable.exe',
      'dist/orca-windows-portable.exe.sha256'
    ]) {
      expect(uploadPaths).toContain(artifact)
    }
  })

  it('publishes only a complete digest-verified non-draft prerelease', () => {
    const publish = stepNamed('Publish tagged GitHub prerelease')
    expect(publish?.if).toBe("startsWith(github.ref, 'refs/tags/')")
    expect(publish?.run).toContain("'^task-build-([0-9a-f]{12})$'")
    expect(publish?.run).toContain('gh release create $env:RELEASE_TAG')
    expect(publish?.run).toContain('gh release upload $env:RELEASE_TAG @assets --clobber')
    expect(publish?.run).toContain('$published[0].digest -ne $expectedDigest')
    expect(publish?.run).toContain('gh release edit $env:RELEASE_TAG')
    expect(publish?.run).toContain('--draft=false')
    expect(publish?.run).toContain('feature-branch prerelease is unsigned')
  })
})
