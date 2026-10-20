// Zrzuty: profil z modelem damskim i poprawiony model męski.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'); const fs = require('node:fs');
const OUT = process.env.SHOTS_OUT, APP = process.env.APP_DIR;
app.setPath('userData', process.env.USERDATA);
require(path.join(APP, 'electron', 'main.cjs'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  await sleep(1500);
  const win = BrowserWindow.getAllWindows()[0]; win.setSize(1440, 900);
  const wc = win.webContents; const errors = [];
  wc.on('console-message', (_e, level, msg) => { if (level >= 2) errors.push(msg); });
  const js = code => wc.executeJavaScript(code);
  const shot = async name => { await sleep(900); fs.writeFileSync(path.join(OUT, name + '.png'), (await wc.capturePage()).toPNG()); };
  const setInput = (sel, val) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const click = text => js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) throw new Error('brak przycisku: ' + ${JSON.stringify(text)}); b.click(); })()`);
  const pickMuscle = id => js(`(() => { if (!document.querySelector('#atlas-m')) { [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Treningi').click(); setTimeout(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Atlas mięśni').click(), 100); } })()`).then(() => sleep(7000)).then(() => js(`(() => { const s = document.querySelector('#atlas-m'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '${id}'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`));
  try {
    await sleep(1500);
    await setInput('#np-name', 'Ula'); await js(`document.querySelector('#np-model button:nth-child(2)').click()`);
    await shot('f1-pierwszy-profil');
    await click('Utwórz profil'); await sleep(500);
    await click('Atlas mięśni'); await sleep(4000); await pickMuscle('chest_clav'); await shot('f2-atlas-klatka');
    await js(`[...document.querySelectorAll('.viewer-tools button')].find(b => b.textContent === 'Tył').click()`); await pickMuscle('traps_mid'); await shot('f3-atlas-czworoboczny');
    await click('Profile i dane'); await sleep(300); await click('Dodaj profil przykładowy'); await sleep(800);
    await js(`[...document.querySelectorAll('[id^=pmod-]')].at(-1).querySelector('button:nth-child(2)').click()`); await sleep(300);
    await shot('f4-ustawienia');
    await click('Mapa obciążenia'); await sleep(4000); await shot('f5-mapa-damska');
    await click('Profile i dane'); await sleep(300);
    await js(`[...document.querySelectorAll('[id^=pmod-]')].at(-1).querySelector('button:nth-child(1)').click()`); await sleep(300);
    await click('Atlas mięśni'); await sleep(4000); await pickMuscle('abs'); await shot('f6-atlas-meski-brzuch');
    await js(`[...document.querySelectorAll('.viewer-tools button')].find(b => b.textContent === 'Tył').click()`); await pickMuscle('traps_upper'); await shot('f7-atlas-meski-czworoboczny-gorny');
    const db = JSON.parse(fs.readFileSync(path.join(process.env.USERDATA, 'atlas-data.json'), 'utf8'));
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ errors, profiles: db.profiles.map(p => [p.name, p.bodyModel]) }, null, 1));
  } catch (e) { fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ fatal: String(e), errors }, null, 1)); await shot('zz-blad'); }
  app.quit();
});
