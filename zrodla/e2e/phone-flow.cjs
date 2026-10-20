// Aplikacja telefonu w oknie 390×844: trening → zakończenie → zapis klatek QR do plików.
// TRYB=train (domyślnie) albo receive (odbiór planów z fałszywej kamery).
const { app, BrowserWindow } = require('electron');
const path = require('node:path'); const fs = require('node:fs');
const OUT = process.env.OUT, MODE = process.env.MODE || 'train';
app.setPath('userData', process.env.USERDATA);
if (process.env.FAKE_VIDEO) { app.commandLine.appendSwitch('use-fake-device-for-media-stream'); app.commandLine.appendSwitch('use-file-for-fake-video-capture', process.env.FAKE_VIDEO); app.commandLine.appendSwitch('use-fake-ui-for-media-stream'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 390, height: 844, show: true, webPreferences: { sandbox: true } });
  win.webContents.session.setPermissionRequestHandler((_w, p, cb) => cb(true));
  const errors = [];
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errors.push(msg); });
  await win.loadFile(process.env.PHONE_HTML);
  const wc = win.webContents, js = c => wc.executeJavaScript(c);
  const shot = async n => { await sleep(500); fs.writeFileSync(path.join(OUT, n + '.png'), (await wc.capturePage()).toPNG()); };
  const click = t => js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(t)})); if (!b) throw new Error('brak przycisku: ' + ${JSON.stringify(t)}); b.click(); })()`);
  const type = (sel, v) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const report = {};
  try {
    if (process.env.SEED) await js(`localStorage.setItem('atlas-phone-v1', ${JSON.stringify(fs.readFileSync(process.env.SEED, 'utf8'))}); location.reload();`), await sleep(800);
    await sleep(800); await shot('p01-start');
    if (MODE === 'receive') {
      await click('Odbierz plany z komputera'); await sleep(1500); await shot('p10-skanowanie');
      for (let i = 0; i < 60; i++) { const ok = await js(`document.body.textContent.includes('Odebrano ·')`); if (ok) break; await sleep(500); }
      await shot('p11-odebrano');
      report.state = JSON.parse(await js(`localStorage.getItem('atlas-phone-v1')`));
      await click('Gotowe'); await sleep(400); await shot('p12-plany-na-ekranie');
      if (report.state.plans.length) { await click(report.state.plans[0].name); await sleep(600); await shot('p13-trening-z-planu'); }
    } else {
      await click('Pusty trening'); await sleep(500);
      await click('+ Dodaj ćwiczenie'); await sleep(300); await type('.p-search', 'przysiad ze sztang'); await sleep(300);
      await js(`document.querySelector('.p-pick').click()`); await sleep(400);
      await click('+ Dodaj ćwiczenie'); await sleep(300); await type('.p-search', 'wyciskanie sztangi na ławce płaskiej'); await sleep(300);
      await js(`document.querySelector('.p-pick').click()`); await sleep(400);
      await click('+ Dodaj ćwiczenie'); await sleep(300); await type('.p-search', 'Wiosłowanie Hammer'); await sleep(300); await shot('p02-wlasne-cwiczenie');
      await click('+ Dodaj własne'); await sleep(400);
      // ciężary: wpis przez stuknięcie w wartość, plus przyciski
      await js(`(() => { const s = document.querySelectorAll('.p-ex')[0].querySelector('.p-step span'); s.click(); })()`); await sleep(200);
      await js(`(() => { const i = document.querySelector('.p-step input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '102,5'); i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); })()`); await sleep(300);
      await js(`(() => { const s = document.querySelectorAll('.p-ex')[0].querySelectorAll('.p-step')[1].querySelector('span'); s.click(); })()`); await sleep(200);
      await js(`(() => { const i = document.querySelector('.p-step input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '6'); i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); })()`); await sleep(300);
      await js(`(() => { const s = document.querySelectorAll('.p-ex')[1].querySelector('.p-step span'); s.click(); })()`); await sleep(200);
      await js(`(() => { const i = document.querySelector('.p-step input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, '80'); i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); })()`); await sleep(200);
      await js(`(() => { const ex = document.querySelectorAll('.p-ex')[1]; const b = ex.querySelectorAll('.p-step')[1].querySelectorAll('button')[1]; for (let k = 0; k < 8; k++) b.click(); })()`); await sleep(300);
      const tickN = (ex, set) => js(`document.querySelectorAll('.p-ex')[${ex}].querySelectorAll('.p-check')[${set}].click()`);
      await tickN(0, 0); await sleep(600); await shot('p03-ocena-trudnosci'); await js(`document.querySelector('.p-effort-bar button:nth-child(4)').click()`); await sleep(1600); await shot('p03b-przerwa');
      await click('Zaczynam serię'); await sleep(1200); await tickN(0, 1); await sleep(1500); await tickN(0, 2); await sleep(400); await js(`document.querySelector('.p-effort-bar button:nth-child(5)').click()`); await sleep(500);
      await tickN(1, 0); await sleep(700); await tickN(1, 1); await sleep(500);
      await tickN(2, 0); await sleep(300);
      await js(`window.scrollTo(0, 0)`); await shot('p04-trening');
      await click('Zakończ'); await sleep(300); await shot('p05-potwierdzenie');
      await click('Zakończ i zapisz'); await sleep(1200); await shot('p06-wysylanie');
      // klatki QR: zatrzymaj przełączanie i zapisz każdą
      await click('Zatrzymaj').catch(() => {});
      const n = await js(`document.querySelectorAll('.qr-dots i').length || 1`);
      for (let i = 0; i < n; i++) {
        await sleep(300);
        const url = await js(`document.querySelector('.qr-sender canvas').toDataURL('image/png')`);
        fs.writeFileSync(path.join(OUT, `qr-phone-${i}.png`), Buffer.from(url.split(',')[1], 'base64'));
        if (n > 1) await click('Następny kod');
      }
      report.frames = n;
      report.state = JSON.parse(await js(`localStorage.getItem('atlas-phone-v1')`));
      await click('Komputer odebrał'); await sleep(500); await shot('p07-ekran-glowny');
    }
  } catch (e) { report.fatal = String(e); await shot('pzz-blad'); }
  report.errors = errors;
  fs.writeFileSync(path.join(OUT, `phone-${MODE}.json`), JSON.stringify(report, null, 1));
  app.quit();
});
