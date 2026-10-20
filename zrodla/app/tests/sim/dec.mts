import jsQR from 'jsqr'; import { PNG } from 'pngjs'; import fs from 'node:fs';
for (const f of fs.readdirSync(process.argv[2]).filter(x => x.startsWith('cam_')).sort()) {
  const p = PNG.sync.read(fs.readFileSync(`${process.argv[2]}/${f}`));
  const c = jsQR(new Uint8ClampedArray(p.data), p.width, p.height, { inversionAttempts: 'dontInvert' });
  console.log(f.padEnd(34), c ? 'OK' : '---');
}
