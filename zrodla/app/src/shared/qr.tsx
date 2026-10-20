// Komponenty QR wspólne dla telefonu i komputera: wyświetlanie serii kodów i skaner z kamery.
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { Assembler, encodeFrames, type Bundle, type Kind } from './transfer';

// Dekoder ZXing (WebAssembly) wbudowany w aplikację – działa bez internetu.
let zxingReady: Promise<unknown> | null = null;
function initZXing() {
  if (!zxingReady) {
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path) }, fireImmediately: false });
    zxingReady = readBarcodes(new ImageData(8, 8), { formats: ['QRCode'] });
  }
  return zxingReady;
}

/** Pokazuje kody QR; przy kilku częściach przełącza je automatycznie w pętli. */
export function QrSender({ bundle, interval = 700, size = 320 }: { bundle: Bundle; interval?: number; size?: number }) {
  const frames = useMemo(() => encodeFrames(bundle), [bundle]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => { setI(0); }, [frames]);
  useEffect(() => {
    if (frames.length < 2 || paused) return;
    const t = setInterval(() => setI(x => (x + 1) % frames.length), interval);
    return () => clearInterval(t);
  }, [frames, interval, paused]);
  useEffect(() => {
    if (!canvas.current) return;
    QRCode.toCanvas(canvas.current, [{ data: new Uint8ClampedArray(frames[i]), mode: 'byte' }] as any,
      { errorCorrectionLevel: 'M', margin: 3, width: size, color: { dark: '#000000', light: '#ffffff' } })
      .catch(() => { /* rysowanie nie powinno zawieść dla poprawnych danych */ });
  }, [frames, i, size]);

  return (
    <div className="qr-sender">
      <canvas ref={canvas} width={size} height={size} aria-label={`Kod QR ${i + 1} z ${frames.length}`} />
      <div className="qr-meta">
        {frames.length > 1 ? <>
          <span>Kod <b>{i + 1}</b> z <b>{frames.length}</b></span>
          <span className="qr-dots">{frames.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</span>
          <button className="btn small" onClick={() => setPaused(p => !p)}>{paused ? 'Wznów przełączanie' : 'Zatrzymaj'}</button>
          {paused && <button className="btn small" onClick={() => setI(x => (x + 1) % frames.length)}>Następny kod</button>}
        </> : <span>Jeden kod</span>}
      </div>
    </div>
  );
}

export type ScanState = { phase: 'starting' } | { phase: 'scanning'; have: number; total: number; hint: string | null } | { phase: 'error'; message: string };

/** Skaner: kamera → jsQR → składanie części. Wywołuje onDone z kompletną paczką danych. */
export function QrScanner({ expect, onDone, facing = 'environment' }: { expect: Kind; onDone: (b: Bundle) => void; facing?: 'environment' | 'user' }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<ScanState>({ phase: 'starting' });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const done = useRef(onDone); done.current = onDone;

  useEffect(() => {
    let stream: MediaStream | null = null, timer = 0, stopped = false;
    const asm = new Assembler(expect);
    const cnv = document.createElement('canvas');
    const ctx = cnv.getContext('2d', { willReadFrequently: true })!;
    let progress = { have: 0, total: 0 };
    let hint: string | null = null;

    const tick = async () => {
      if (stopped) return;
      const v = video.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        // Pełna rozdzielczość do 1280 px: drobniejszy obraz obniża skuteczność odczytu.
        const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
        cnv.width = Math.round(v.videoWidth * scale); cnv.height = Math.round(v.videoHeight * scale);
        ctx.drawImage(v, 0, 0, cnv.width, cnv.height);
        const img = ctx.getImageData(0, 0, cnv.width, cnv.height);
        try {
          const found = await readBarcodes(img, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
          const code = found.find(c => c.isValid && c.bytes?.length);
          if (code && !stopped) {
            const r = asm.feed(code.bytes);
            if (r.status === 'done') { stopped = true; done.current(r.bundle); return; }
            if (r.status === 'progress') { progress = { have: r.have, total: r.total }; hint = null; }
            if (r.status === 'ignored') hint = r.reason;
            setState({ phase: 'scanning', ...progress, hint });
          }
        } catch { /* pojedyncza nieudana klatka – próbujemy dalej */ }
      }
      if (!stopped) timer = window.setTimeout(tick, 60);
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('To urządzenie nie udostępnia kamery tej aplikacji.');
        await initZXing();
        const video_: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: facing };
        stream = await navigator.mediaDevices.getUserMedia({ video: { ...video_, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        const v = video.current!;
        v.srcObject = stream; v.setAttribute('playsinline', ''); v.muted = true;
        await v.play();
        navigator.mediaDevices.enumerateDevices().then(d => setDevices(d.filter(x => x.kind === 'videoinput'))).catch(() => {});
        setState({ phase: 'scanning', have: 0, total: 0, hint: null });
        tick();
      } catch (e: any) {
        const name = e?.name;
        const message = name === 'NotAllowedError' ? 'Brak zgody na użycie kamery. Zezwól na dostęp do kamery i spróbuj ponownie.'
          : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'Nie znaleziono kamery.'
          : name === 'NotReadableError' ? 'Kamera jest zajęta przez inny program (np. Teams). Zamknij go i spróbuj ponownie.'
          : String(e?.message ?? e);
        setState({ phase: 'error', message });
      }
    })();

    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
  }, [expect, deviceId, facing]);

  return (
    <div className="qr-scanner">
      <div className="qr-video">
        <video ref={video} playsInline muted className={facing === 'user' ? 'mirror' : ''} />
        <div className="qr-frame" aria-hidden="true" />
        {state.phase === 'starting' && <div className="qr-overlay">Uruchamianie kamery…</div>}
        {state.phase === 'error' && <div className="qr-overlay err">{state.message}</div>}
      </div>
      {state.phase === 'scanning' && (
        <div className="qr-progress">
          {state.total ? <>
            <span>Odebrano <b>{state.have}</b> z <b>{state.total}</b> kodów</span>
            <i className="meter" style={{ ['--w' as any]: `${(state.have / state.total) * 100}%` }} />
          </> : <span>Skieruj kamerę na kod QR</span>}
          {state.hint && <span className="qr-hint">{state.hint}</span>}
        </div>
      )}
      {devices.length > 1 && (
        <select className="input" value={deviceId} onChange={e => setDeviceId(e.target.value)} aria-label="Kamera">
          <option value="">kamera domyślna</option>
          {devices.map((d, k) => <option key={d.deviceId || k} value={d.deviceId}>{d.label || `Kamera ${k + 1}`}</option>)}
        </select>
      )}
    </div>
  );
}
