import jsQR from 'jsqr'; import { PNG } from 'pngjs'; import fs from 'node:fs';
const rows: Record<string, Record<string, string>> = {};
for (const f of fs.readdirSync(process.argv[2]).filter(x => x.startsWith('cam_')).sort()) {
  const [, cfg, scen] = f.replace('.png', '').match(/^cam_(\d+_[LM])__(.*)$/)!;
  const p = PNG.sync.read(fs.readFileSync(`${process.argv[2]}/${f}`));
  const c = jsQR(new Uint8ClampedArray(p.data), p.width, p.height, { inversionAttempts: 'dontInvert' });
  (rows[cfg] ??= {})[scen] = c ? 'OK ' : '-- ';
}
const scens = Object.keys(Object.values(rows)[0]);
console.log('cfg     ', scens.map(s => s.slice(0, 9).padEnd(10)).join(''));
for (const [k, v] of Object.entries(rows)) console.log(k.padEnd(8), scens.map(s => v[s].padEnd(10)).join(''));
