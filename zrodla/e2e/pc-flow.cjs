// Aplikacja na Windows: odbiór treningu z fałszywej kamerki (nagranie y4m) i/lub wysłanie planów (zapis klatek QR).
const { app, BrowserWindow } = require('electron');
const path = require('node:path'); const fs = require('node:fs');
const OUT = process.env.OUT, MODE = process.env.MODE;
app.setPath('userData', process.env.USERDATA);
if (process.env.FAKE_VIDEO) { app.commandLine.appendSwitch('use-fake-device-for-media-stream'); app.commandLine.appendSwitch('use-file-for-fake-video-capture', process.env.FAKE_VIDEO); }
require(path.join(process.env.APP_DIR, 'electron', 'main.cjs'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  await sleep(1500);
  const win = BrowserWindow.getAllWindows()[0]; win.setSize(1440, 900);
  const wc = win.webContents, js = c => wc.executeJavaScript(c);
  const errors = []; wc.on('console-message', (_e, l, m) => { if (l >= 2 && !/GPU stall/.test(m)) errors.push(m); });
  const shot = async n => { await sleep(700); fs.writeFileSync(path.join(OUT, n + '.png'), (await wc.capturePage()).toPNG()); };
  const click = t => js(`(() => { const b = [...document.querySelectorAll('button, label.btn')].find(x => x.textContent.trim().startsWith(${JSON.stringify(t)})); if (!b) throw new Error('brak przycisku: ' + ${JSON.stringify(t)}); b.click(); })()`);
  const type = (sel, v) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const report = {};
  try {
    await sleep(1000);
    if (await js(`!!document.querySelector('#np-name')`)) { await type('#np-name', 'Bartek'); await click('Utwórz profil'); await sleep(600); }
    if (MODE === 'receive') {
      await click('Telefon'); await sleep(400); await click('Włącz kamerkę i skanuj'); await sleep(2500); await shot('c01-skanowanie');
      const t0 = Date.now();
      for (let i = 0; i < 80; i++) { if (await js(`document.body.textContent.includes('Odebrano z telefonu')`)) break; await sleep(250); }
      report.scanSeconds = (Date.now() - t0) / 1000;
      await shot('c02-podglad-importu');
      await click('Importuj'); await sleep(800); await shot('c03-zaimportowano');
      await click('Gotowe'); await sleep(300);
      await click('Treningi'); await sleep(500); await shot('c04-lista-treningow');
      await js(`document.querySelector('.wcard').click()`); await sleep(2500); await shot('c05-trening-z-telefonu');
    }
    if (MODE === 'plans') {
      // plan z treningu z telefonu + drugi plan ręcznie
      await click('Treningi'); await sleep(400); await js(`document.querySelector('.wcard').click()`); await sleep(1500);
      await type('#w-name', 'Nogi i klatka'); await sleep(300); await click('Zapisz jako plan'); await sleep(400);
      await click('Plany'); await sleep(400); await click('Nowy plan'); await sleep(400); await type('#plan-name', 'Pull A'); await sleep(200);
      await click('+ Dodaj ćwiczenia'); await sleep(600);
      for (const q of ['podciąganie nachwytem', 'wiosłowanie sztangą w opadzie', 'face pull']) { await type('#ex-q', q); await sleep(300); await js(`document.querySelector('.dialog .ex').click()`); await sleep(200); }
      await click('Dodaj do treningu'); await sleep(500); await shot('c10-plany');
      await click('Wyślij na telefon'); await sleep(400); await click('Pokaż kody QR'); await sleep(1200); await shot('c11-kody-dla-telefonu');
      await click('Zatrzymaj').catch(() => {});
      const n = await js(`document.querySelectorAll('.qr-dots i').length || 1`);
      for (let i = 0; i < n; i++) { await sleep(300); const url = await js(`document.querySelector('.qr-sender canvas').toDataURL('image/png')`); fs.writeFileSync(path.join(OUT, `qr-pc-${i}.png`), Buffer.from(url.split(',')[1], 'base64')); if (n > 1) await click('Następny kod'); }
      report.frames = n;
    }
    report.db = JSON.parse(fs.readFileSync(path.join(process.env.USERDATA, 'atlas-data.json'), 'utf8'));
  } catch (e) { report.fatal = String(e); await shot('czz-blad'); }
  report.errors = errors;
  fs.writeFileSync(path.join(OUT, `pc-${MODE}.json`), JSON.stringify(report, null, 1));
  app.quit();
});
