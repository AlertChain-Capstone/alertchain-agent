import { cp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
// Isolated copies under node_modules can resolve the installed dependencies.
// The working source tree is never renamed or removed.
for (const area of ['fa1', 'fa2', 'fa3']) {
  const destination = path.join(root, 'node_modules/.cache/optional-areas', `${area}-${Date.now()}`)
  await mkdir(destination, { recursive: true })
  await cp(path.join(root, 'src'), path.join(destination, 'src'), {
    recursive: true,
    filter: (source) => source !== path.join(root, 'src', area),
  })
  await cp(path.join(root, 'index.html'), path.join(destination, 'index.html'))
  await writeFile(path.join(destination, 'package.json'), '{"type":"module"}\n')
  await build({ root: destination, configFile: path.join(root, 'vite.config.js'), logLevel: 'error' })
  console.log(`PASS: production build with src/${area}/ missing`)
}
