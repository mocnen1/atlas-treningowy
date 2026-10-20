// Uruchamia aplikację w Electronie na wirtualnym ekranie, przeklikuje ekrany i zapisuje zrzuty.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const OUT = process.env.SHOTS_OUT;
const APP = process.env.APP_DIR;
app.setPath('userData', process.env.USERDATA);
require(path.join(APP, 'electron', 'main.cjs')); // rejestruje IPC i otwiera okno
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  await sleep(1500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1440, 900);
  const wc = win.webContents;
  const errors = [];
  wc.on('console-message', (_e, level, msg) => { if (level >= 2) errors.push(msg); });
  const js = code => wc.executeJavaScript(code);
  const shot = async name => { await sleep(900); const img = await wc.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); };
  const setInput = (sel, val) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const click = text => js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) throw new Error('brak przycisku: ' + ${JSON.stringify(text)}); b.click(); })()`);
  try {
    await sleep(1500);
    await shot('01-pierwszy-profil');
    await setInput('#np-name', 'Bartek'); await click('Utwórz profil'); await sleep(500);
    await shot('02-pusta-lista');
    await click('Profile i dane'); await sleep(300); await click('Dodaj profil przykładowy'); await sleep(800);
    await click('Treningi'); await shot('03-lista-treningow');
    await js(`document.querySelector('.wcard').click()`); await sleep(2500); await shot('04-edytor-treningu');
    await click('+ Dodaj ćwiczenie'); await sleep(600); await setInput('#ex-q', 'przysiad'); await sleep(300);
    await js(`document.querySelector('.dialog .ex').click()`); await shot('05-wybor-cwiczenia');
    await js(`document.querySelector('.dialog .x').click()`); await sleep(300);
    await click('Mapa obciążenia'); await sleep(3000); await shot('06-mapa-obciazenia');
    await click('Częstotliwość'); await sleep(800); await shot('07-mapa-czestotliwosc');
    await click('Atlas mięśni'); await sleep(3000);
    await js(`(() => { const s = document.querySelector('#atlas-m'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'delt_side'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(500); await shot('08-atlas-miesien');
    await js(`document.querySelector('.side .ex').click()`); await shot('09-atlas-cwiczenie');
    await click('Ćwiczenia'); await sleep(500); await setInput('#ex-q', 'wyciskanie sztangi na ławce płaskiej'); await sleep(300);
    await js(`document.querySelector('.ex').click()`); await shot('10-cwiczenia-historia');
    await click('Nowe własne ćwiczenie'); await sleep(2500); await setInput('#ce-name', 'Wiosłowanie na maszynie Hammer'); await shot('11-edytor-cwiczenia');
    await js(`document.querySelector('.dialog .x').click()`);
    await click('Profile i dane'); await shot('12-ustawienia');
    const saved = fs.readFileSync(path.join(process.env.USERDATA, 'atlas-data.json'), 'utf8');
    const db = JSON.parse(saved);
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ errors, profiles: db.profiles.map(p => p.name), workouts: db.workouts.length }, null, 1));
  } catch (e) {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ fatal: String(e), errors }, null, 1));
    await shot('zz-blad');
  }
  app.quit();
});
