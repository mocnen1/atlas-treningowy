import fs from 'node:fs'; import { PNG } from 'pngjs';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm') as any } });
for (const f of process.argv.slice(2)) {
  const p = PNG.sync.read(fs.readFileSync(f));
  const r = await readBarcodes({ data: new Uint8ClampedArray(p.data), width: p.width, height: p.height, colorSpace: 'srgb' } as ImageData, { formats: ['QRCode'] });
  const b = r[0].bytes; console.log(f.split('/').pop(), 'id', Array.from(b.slice(4, 8)).map(x => x.toString(16).padStart(2, '0')).join(''), 'część', b[8], 'z', b[9], 'bajtów', b.length);
}
