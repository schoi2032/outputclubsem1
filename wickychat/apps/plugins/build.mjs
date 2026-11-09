// Bundles the official plugin service (including @quid/shared) into dist/main.js.
import { build } from 'esbuild'
import pkg from './package.json' with { type: 'json' }

await build({
  entryPoints: { main: 'src/main.ts' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outdir: 'dist',
  sourcemap: true,
  external: Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@quid/')),
})
console.log('Built dist/main.js')
