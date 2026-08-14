#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

if (process.platform !== 'win32') {
  throw new Error(
    'Windows foreground permission addon compilation requires a Windows host; refusing to package without it.'
  )
}

const require = createRequire(import.meta.url)
const repoRoot = resolve(import.meta.dirname, '../..')
const nativeDirectory = join(repoRoot, 'native', 'windows-foreground-permission')
const builtAddonPath = join(
  nativeDirectory,
  'build',
  'Release',
  'windows_foreground_permission.node'
)
const outputPath =
  readArg('--output') ?? join(nativeDirectory, '.build', 'windows-foreground-permission.node')
const architecture = readArg('--arch') ?? process.arch

if (!['x64', 'arm64'].includes(architecture)) {
  throw new Error(`Unsupported Windows foreground permission architecture: ${architecture}`)
}

const nodeGypPath = require.resolve('node-gyp/bin/node-gyp.js')
const result = spawnSync(
  process.execPath,
  [nodeGypPath, 'rebuild', '--directory', nativeDirectory, `--arch=${architecture}`],
  { cwd: repoRoot, stdio: 'inherit' }
)

if (result.signal) {
  process.kill(process.pid, result.signal)
}
if (result.error) {
  throw result.error
}
if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
if (!existsSync(builtAddonPath)) {
  throw new Error(`Windows foreground permission addon was not produced at ${builtAddonPath}`)
}

mkdirSync(dirname(outputPath), { recursive: true })
copyFileSync(builtAddonPath, outputPath)

function readArg(name) {
  const exactIndex = process.argv.indexOf(name)
  if (exactIndex !== -1) {
    return process.argv[exactIndex + 1]
  }
  return process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1)
}
