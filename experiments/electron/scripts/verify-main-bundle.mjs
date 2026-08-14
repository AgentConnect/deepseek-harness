import { builtinModules } from 'node:module'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const bundlePath = fileURLToPath(new URL('../lib/main.js', import.meta.url))
const source = await readFile(bundlePath, 'utf8')
const allowedBareSpecifiers = new Set(['electron', ...builtinModules])
const specifiers = new Set()

for (const match of source.matchAll(/\b(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/gu)) {
  specifiers.add(match[1])
}

const unexpected = [...specifiers].filter((specifier) => (
  !specifier.startsWith('.')
  && !specifier.startsWith('/')
  && !specifier.startsWith('#')
  && !specifier.startsWith('node:')
  && !allowedBareSpecifiers.has(specifier)
))

if (unexpected.length > 0) {
  throw new Error(`Electron main bundle contains unpackaged dependencies: ${unexpected.join(', ')}`)
}

console.log(`Electron main bundle verified: ${bundlePath}`)
