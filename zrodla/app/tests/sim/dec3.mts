import jsQR from 'jsqr'; import { PNG } from 'pngjs'; import fs from 'node:fs';
import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';
import { BinaryBitmap, HybridBinarizer, RGBLuminanceSource, QRCodeReader, DecodeHintType } from '@zxing/library';
prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm') as any } });
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter(x => x.startsWith('cam_')).sort();
const res: Record<string, Record<string, string>> = {};
for (const f of files) {
  const [, cfg, scen] = f.replace('.png', '').match(/^cam_(\d+_[LM])__(.*)$/)!;
  const p = PNG.sync.read(fs.readFileSync(`${dir}/${f}`));
  const rgba = new Uint8ClampedArray(p.data);
  const a = jsQR(rgba, p.width, p.height, { inversionAttempts: 'dontInvert' }) ? 'J' : '.';
  let b = '.';
  try {
    const lum = new Uint8ClampedArray(p.width * p.height);
    for (let i = 0; i < lum.length; i++) lum[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
    const src = new RGBLuminanceSource(lum, p.width, p.height);
    const hints = new Map([[DecodeHintType.TRY_HARDER, true]]);
    new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(src)), hints); b = 'Z';
  } catch {}
  const r = await readBarcodes({ data: rgba, width: p.width, height: p.height, colorSpace: 'srgb' } as ImageData, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
  const c = r.length && r[0].isValid ? 'W' : '.';
  (res[cfg] ??= {})[scen] = a + b + c;
}
const scens = Object.keys(Object.values(res)[0]);
console.log('J=jsQR Z=@zxing/library W=zxing-wasm');
console.log('cfg     ', scens.map(s => s.slice(0, 8).padEnd(9)).join(''));
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(8), scens.map(s => v[s].padEnd(9)).join(''));
