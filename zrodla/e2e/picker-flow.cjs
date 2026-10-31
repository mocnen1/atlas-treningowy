// Telefon: przeglądanie wszystkich ćwiczeń (partie, sprzęt), dodanie i zamiana ćwiczenia w trakcie treningu.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'); const fs = require('node:fs');
const OUT = process.env.OUT;
app.setPath('userData', process.env.USERDATA);
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 390, height: 844 });
  const errors = [], report = {};
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2 && !msg.includes('Security')) errors.push(msg); });
  await win.loadFile(process.env.PHONE_HTML);
  const wc = win.webContents, js = c => wc.executeJavaScript(c);
  const shot = async n => { await sleep(500); fs.writeFileSync(path.join(OUT, n + '.png'), (await wc.capturePage()).toPNG()); };
  const click = t => js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(t)})); if (!b) throw new Error('brak przycisku: ' + ${JSON.stringify(t)}); b.click(); })()`);
  const state = async () => JSON.parse(await js(`localStorage.getItem('atlas-phone-v1')`));
  try {
    await js(`localStorage.clear(); location.reload();`); await sleep(1000);
    await click('Pusty trening'); await sleep(400);
    await click('+ Dodaj ćwiczenie'); await sleep(300); await shot('k1-wybor-start');
    await click('Uda'); await sleep(300);
    report.thighs = await js(`document.querySelectorAll('.p-pick').length`);
    await click('maszyna'); await sleep(300);
    report.thighsMachine = await js(`document.querySelectorAll('.p-pick').length`);
    report.firstNames = await js(`[...document.querySelectorAll('.p-pick b')].slice(0, 4).map(b => b.textContent)`);
    await shot('k2-uda-maszyna');
    await js(`document.querySelector('.p-pick').click()`); await sleep(400);
    await js(`document.querySelector('.p-ex .p-exmenu .p-icon').click()`); await sleep(200); await shot('k3-menu');
    await click('Zamień ćwiczenie'); await sleep(300);
    await js(`(() => { const el = document.querySelector('.p-search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'wypychanie'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(300);
    await js(`document.querySelector('.p-pick').click()`); await sleep(400);
    let s = await state(); report.afterSwap = s.active.exercises.map(e => [e.exerciseId, e.sets.length]);
    // zamiana po zrobionej serii: zrobiona zostaje przy starym, reszta przechodzi na nowe
    await js(`document.querySelector('.p-check').click()`); await sleep(300);
    await js(`document.querySelector('.p-ex .p-exmenu .p-icon').click()`); await sleep(200);
    await click('Zamień ćwiczenie'); await sleep(300); await click('Plecy'); await sleep(200);
    await js(`document.querySelector('.p-pick').click()`); await sleep(400);
    s = await state(); report.afterSwap2 = s.active.exercises.map(e => [e.exerciseId, e.sets.length, e.sets.filter(x => x.doneAt).length]);
    await shot('k4-po-zamianie');
  } catch (e) { report.fatal = String(e); await shot('zz-blad'); }
  report.errors = errors;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  app.quit();
});
