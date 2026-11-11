// Telefon: lista dostępnych hantli – cel trenera i przyciski − / + tylko po dostępnych ciężarach.
const { app, BrowserWindow } = require('electron');
const path = require('node:path'); const fs = require('node:fs');
const OUT = process.env.OUT;
app.setPath('userData', process.env.USERDATA);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const S = d => ({ d, c: 'P1', n: 'Klata', s: [[37.5, 12, 8, 0], [37.5, 10, 9, 0]] });
const seed = {
  v: 1, profile: 'Bartek', receivedAt: '2026-11-10T10:00:00Z', custom: [], rated: {}, alt: {}, active: null, rest: null, history: [],
  settings: { kgStep: 2.5, defaultRest: 120, sound: false }, last: { Dumbbell_Bench_Press: ['2026-11-09', 37.5, 12] },
  hist: { Dumbbell_Bench_Press: [S('2026-11-09'), S('2026-11-02'), S('2026-10-26')] },
  plans: [{ id: 'P1', name: 'Klata', exercises: [{ exerciseId: 'Dumbbell_Bench_Press', sets: 2, repsMin: 8, repsMax: 12, restSec: 120, notes: '' }] }],
};
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
    await js(`localStorage.setItem('atlas-phone-v1', ${JSON.stringify(JSON.stringify(seed))}); location.reload();`); await sleep(1000);
    await click('Klata'); await sleep(500);
    let s = await state(); report.start = s.active.exercises[0].sets.map(x => [x.kg, x.reps]);
    await shot('h1-trening');
    await js(`document.querySelector('[aria-label="Ciężar więcej"]').click()`); await sleep(200);
    await js(`document.querySelectorAll('[aria-label="Ciężar mniej"]')[1].click()`); await sleep(200);
    s = await state(); report.afterButtons = s.active.exercises[0].sets.map(x => x.kg);
    await click('Zakończ'); await sleep(200); await click('Odrzuć trening'); await sleep(300);
    await js(`document.querySelector('[aria-label="Ustawienia"]').click()`); await sleep(400);
    await shot('h2-ustawienia');
  } catch (e) { report.fatal = String(e); await shot('zz-blad'); }
  report.errors = errors;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  app.quit();
});
