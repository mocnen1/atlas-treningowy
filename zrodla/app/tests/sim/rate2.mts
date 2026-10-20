import fs from 'node:fs';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm') as any } });
const buf = fs.readFileSync(process.argv[2]);
const head = buf.subarray(0, buf.indexOf(10)).toString();
const W = +head.match(/W(\d+)/)![1], H = +head.match(/H(\d+)/)![1];
const fsz = W * H * 3 / 2; let off = buf.indexOf(10) + 1;
const res: Record<number, string> = {};
for (let k = 0; off < buf.length; k++) {
  off += 6; const y = buf.subarray(off, off + W * H); const u = buf.subarray(off + W * H, off + W * H * 5 / 4); const v = buf.subarray(off + W * H * 5 / 4, off + fsz); off += fsz;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    const i = yy * W + xx, c = (yy >> 1) * (W >> 1) + (xx >> 1);
    const Y = y[i], U = u[c] - 128, V = v[c] - 128;
    rgba[i * 4] = Y + 1.402 * V; rgba[i * 4 + 1] = Y - 0.344 * U - 0.714 * V; rgba[i * 4 + 2] = Y + 1.772 * U; rgba[i * 4 + 3] = 255;
  }
  const r = await readBarcodes({ data: rgba, width: W, height: H, colorSpace: 'srgb' } as ImageData, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
  const code = Math.floor(k / 7) % (+process.argv[3]);
  res[code] = (res[code] ?? '') + (r[0]?.isValid ? `${r[0].bytes[8]}` : '.');
}
for (const [c, s] of Object.entries(res)) console.log('kod', c, s);
