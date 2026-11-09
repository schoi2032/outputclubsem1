// Bundles the API (including workspace packages) into dist/main.js.
// Native and heavyweight dependencies stay external and are installed in the image.
import { build } from 'esbuild'
import pkg from './package.json' with { type: 'json' }

const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@quid/'))

await build({
  // main: the API server. migrate: applies database migrations (run as a one-off job).
  entryPoints: { main: 'src/main.ts', migrate: '../../packages/db/src/migrate.ts' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outdir: 'dist',
  sourcemap: true,
  external,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
})
console.log('Built dist/main.js and dist/migrate.js')
