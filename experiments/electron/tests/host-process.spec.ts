import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseWebHostReadyUrl, WebHostProcess } from '../src/host-process.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Electron Web Host lifecycle', () => {
  it('accepts only the canonical loopback readiness authority', () => {
    expect(parseWebHostReadyUrl('dsh web: http://127.0.0.1:3080')).toBe('http://127.0.0.1:3080/')
    expect(parseWebHostReadyUrl('dsh web: http://127.0.0.1:3080 (LAN: http://10.0.0.2:3080)')).toBe('http://127.0.0.1:3080/')
    expect(parseWebHostReadyUrl('dsh web: http://localhost:3080')).toBeUndefined()
    expect(parseWebHostReadyUrl('dsh web: https://127.0.0.1:3080')).toBeUndefined()
    expect(parseWebHostReadyUrl('dsh web: http://127.0.0.1:3080/api')).toBeUndefined()
  })

  it('waits for readiness and graceful child cleanup before stop resolves', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-electron-host-'))
    temporaryDirectories.push(directory)
    const marker = join(directory, 'stopped.txt')
    const script = [
      "const fs = require('node:fs')",
      "process.stdout.write('booting\\n')",
      "setTimeout(() => process.stdout.write('dsh web: http://127.0.0.1:43123\\n'), 20)",
      `process.on('SIGTERM', () => setTimeout(() => { fs.writeFileSync(${JSON.stringify(marker)}, 'stopped'); process.exit(0) }, 30))`,
      'setInterval(() => {}, 1000)',
    ].join(';')
    const host = WebHostProcess.launch({ command: process.execPath, args: ['-e', script], cwd: directory, env: process.env })
    await expect(host.ready).resolves.toBe('http://127.0.0.1:43123/')
    await host.stop()
    await expect(readFile(marker, 'utf8')).resolves.toBe('stopped')
    await expect(host.exited).resolves.toEqual({ code: 0, signal: null })
  })

  it('reports bounded child diagnostics when the Host exits before readiness', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-electron-host-'))
    temporaryDirectories.push(directory)
    const host = WebHostProcess.launch({
      command: process.execPath,
      args: ['-e', "process.stderr.write('profile composition failed\\n'); process.exit(23)"],
      cwd: directory,
      env: process.env,
    })
    await expect(host.ready).rejects.toThrow('Web Host exited before readiness (code=23, signal=null)\nprofile composition failed')
    await host.stop()
  })
})
