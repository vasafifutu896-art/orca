import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const buildScript = 'config/scripts/build-windows-foreground-permission.mjs'
const itCrossHost = process.platform === 'win32' ? it.skip : it

function itWindows(name, test) {
  const runner = process.platform === 'win32' ? it : it.skip
  runner(name, { timeout: 120_000 }, test)
}

describe('Windows foreground permission addon', () => {
  itCrossHost('fails closed when invoked away from Windows', () => {
    const result = spawnSync(process.execPath, [buildScript], {
      cwd: projectRoot,
      encoding: 'utf8'
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Windows foreground permission addon')
    expect(result.stderr).toContain('Windows host')
  })

  it('keeps the native call order and build entry wired to build:native', () => {
    const source = readFileSync(
      join(projectRoot, 'native', 'windows-foreground-permission', 'foreground-permission.cc'),
      'utf8'
    )
    const nativeBuild = readFileSync(
      join(projectRoot, 'config', 'scripts', 'build-native-for-platform.mjs'),
      'utf8'
    )
    const sendInputIndex = source.indexOf('::SendInput(2, inputs, sizeof(INPUT))')
    const allowForegroundIndex = source.indexOf('::AllowSetForegroundWindow')

    expect(sendInputIndex).toBeGreaterThan(0)
    expect(allowForegroundIndex).toBeGreaterThan(sendInputIndex)
    expect(source).not.toContain('VK_MENU')
    expect(source).toContain('chrome/notification_helper/notification_activator.cc')
    expect(source).toContain('"granted"')
    expect(source).toContain('"inputsSent"')
    expect(source).toContain('"errorCode"')
    expect(nativeBuild).toContain('config/scripts/build-windows-foreground-permission.mjs')
  })

  itWindows('compiles a loadable N-API addon with the repository toolchain', () => {
    const outputRoot = mkdtempSync(join(tmpdir(), 'orca foreground permission '))
    const outputPath = join(outputRoot, 'windows-foreground-permission.node')
    try {
      const build = spawnSync(
        process.execPath,
        [buildScript, '--output', outputPath, '--arch', process.arch],
        { cwd: projectRoot, encoding: 'utf8', timeout: 110_000 }
      )
      expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)
      expect(existsSync(outputPath)).toBe(true)

      const probe = spawnSync(
        process.execPath,
        [
          '-e',
          'const addon=require(process.argv[1]); process.stdout.write(JSON.stringify(addon.grantWindowsForegroundPermission(0)))',
          outputPath
        ],
        { cwd: projectRoot, encoding: 'utf8' }
      )
      expect(probe.status, `${probe.stdout}\n${probe.stderr}`).toBe(0)
      expect(JSON.parse(probe.stdout)).toEqual({
        granted: false,
        inputsSent: 0,
        errorCode: 87
      })

      const electronProbe = spawnSync(
        require('electron'),
        [
          '-e',
          'const addon=require(process.argv[1]); process.stdout.write(JSON.stringify(addon.grantWindowsForegroundPermission(0)))',
          outputPath
        ],
        {
          cwd: projectRoot,
          encoding: 'utf8',
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
        }
      )
      expect(electronProbe.status, `${electronProbe.stdout}\n${electronProbe.stderr}`).toBe(0)
      expect(JSON.parse(electronProbe.stdout)).toEqual({
        granted: false,
        inputsSent: 0,
        errorCode: 87
      })
    } finally {
      rmSync(outputRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})
