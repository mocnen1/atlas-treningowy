// Skuteczność i czas odczytu klatek z nagrania y4m (to samo, co widzi kamerka).
import fs from 'node:fs';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm') as any } });
const buf = fs.readFileSync(process.argv[2]);
const head = buf.subarray(0, buf.indexOf(10)).toString();
const W = +head.match(/W(\d+)/)![1], H = +head.match(/H(\d+)/)![1];
const fsz = W * H * 3 / 2; let off = buf.indexOf(10) + 1;
const opts = JSON.parse(process.argv[3] ?? '{}');
let ok = 0, n = 0, ms = 0;
for (let k = 0; off < buf.length; k++) {
  off += 6; const y = buf.subarray(off, off + W * H); off += fsz;
  if (k % 7 !== 3) continue; // jedna klatka na każde pokazanie kodu
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = y[i]; rgba[i * 4 + 3] = 255; }
  const t = performance.now();
  const r = await readBarcodes({ data: rgba, width: W, height: H, colorSpace: 'srgb' } as ImageData, { formats: ['QRCode'], maxNumberOfSymbols: 1, ...opts });
  ms += performance.now() - t; n++; if (r[0]?.isValid) ok++;
}
console.log(JSON.stringify(opts), `odczytane ${ok}/${n}, średnio ${(ms / n).toFixed(0)} ms/klatkę`);
