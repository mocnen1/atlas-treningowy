// Telefon 390×844: trener per plan, „Wpisz cel”, historia serii, „Ostatnio” przy dodawaniu ćwiczenia.
// Użycie: OUT=… USERDATA=… PHONE_HTML=…/dist-phone/index.html electron trainer-flow.cjs
const { app, BrowserWindow } = require('electron');
const path = require('node:path'); const fs = require('node:fs');
const OUT = process.env.OUT;
app.setPath('userData', process.env.USERDATA);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const S = (d, c, n, sets) => ({ d, c, n, s: sets });
const press = 'Leverage_Chest_Press', pull = 'Wide-Grip_Lat_Pulldown';
const seed = {
  v: 1, profile: 'Bartek', receivedAt: '2026-10-25T10:00:00Z', custom: [], rated: {}, alt: {}, active: null, rest: null, history: [],
  settings: { kgStep: 2.5, defaultRest: 120, sound: false },
  last: { [press]: ['2026-10-24', 70, 10], [pull]: ['2026-10-22', 55, 10] },
  hist: {
    // w planie Klata wyciskanie po zmęczeniu klatki: ok. 60 kg; w planie Plecy: 70 kg
    [press]: [
      S('2026-10-24', 'P2', 'Plecy', [[40, 10, null, 1], [70, 10, 8, 0], [70, 9, 9, 0]]),
      S('2026-10-23', 'P1', 'Klata', [[60, 12, 8, 0], [60, 11, 9, 0]]),
      S('2026-10-17', 'P2', 'Plecy', [[70, 9, 8, 0], [70, 8, 9, 0]]),
      S('2026-10-16', 'P1', 'Klata', [[60, 11, 8, 0], [60, 10, 9, 0]]),
      S('2026-10-09', 'P1', 'Klata', [[57.5, 12, 8, 0], [57.5, 11, 9, 0]]),
      S('2026-10-10', 'P2', 'Plecy', [[67.5, 10, 8, 0]]),
    ],
    [pull]: [S('2026-10-22', 'P2', 'Plecy', [[55, 10, 8, 0]]), S('2026-10-15', 'P2', 'Plecy', [[52.5, 12, 8, 0]]), S('2026-10-08', 'P2', 'Plecy', [[52.5, 10, 8, 0]])],
  },
  plans: [
    { id: 'P1', name: 'Klata', exercises: [{ exerciseId: press, sets: 3, repsMin: 8, repsMax: 12, restSec: 120, notes: '' }] },
    { id: 'P2', name: 'Plecy', exercises: [{ exerciseId: pull, sets: 3, repsMin: 8, repsMax: 12, restSec: 120, notes: '' }, { exerciseId: press, sets: 3, repsMin: 8, repsMax: 10, restSec: 120, notes: '' }] },
  ],
};
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 390, height: 844, show: true, webPreferences: { sandbox: true } });
  const errors = [], report = {};
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2 && !msg.includes('Security')) errors.push(msg); });
  await win.loadFile(process.env.PHONE_HTML);
  const wc = win.webContents, js = c => wc.executeJavaScript(c);
  const shot = async n => { await sleep(500); fs.writeFileSync(path.join(OUT, n + '.png'), (await wc.capturePage()).toPNG()); };
  const click = t => js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(t)})); if (!b) throw new Error('brak przycisku: ' + ${JSON.stringify(t)}); b.click(); })()`);
  const state = async () => JSON.parse(await js(`localStorage.getItem('atlas-phone-v1')`));
  try {
    await js(`localStorage.setItem('atlas-phone-v1', ${JSON.stringify(JSON.stringify(seed))}); location.reload();`); await sleep(1200);
    await click('Klata'); await sleep(600);
    report.coachKlata = await js(`document.querySelector('.p-coach')?.innerText`);
    await click('Dlaczego?'); await sleep(200);
    await shot('t1-klata-trener');
    await click('Wpisz cel'); await sleep(300);
    let s = await state(); report.setsAfterApply = s.active.exercises[0].sets.map(x => [x.kg, x.reps]);
    await click('Historia'); await sleep(400); await shot('t2-historia');
    await click('Zamknij'); await sleep(300);
    // zamiennik: dodane ćwiczenie spoza planu – „Ostatnio” w wyborze i szacunek trenera z innego planu
    await click('+ Dodaj ćwiczenie'); await sleep(300);
    await js(`(() => { const el = document.querySelector('.p-search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'ściąganie drążka wyciągu do klatki szerokim'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(300);
    await shot('t3-wybor-ostatnio');
    await js(`document.querySelector('.p-pick').click()`); await sleep(500);
    await js(`document.querySelectorAll('.p-ex')[1].scrollIntoView()`);
    report.coachZamiennik = await js(`document.querySelectorAll('.p-ex')[1].querySelector('.p-coach')?.innerText ?? document.querySelectorAll('.p-ex')[1].querySelector('.p-trainer')?.innerText`);
    await shot('t4-zamiennik-szacunek');
    await click('Zakończ'); await sleep(200); await click('Odrzuć trening'); await sleep(400);
    await click('Plecy'); await sleep(600);
    report.coachPlecy = await js(`[...document.querySelectorAll('.p-ex')].map(e => e.querySelector('.p-coach')?.innerText ?? e.querySelector('.p-trainer')?.innerText)`);
    await js(`document.querySelectorAll('.p-ex')[1].scrollIntoView()`); await shot('t5-plecy-trener');
  } catch (e) { report.fatal = String(e); await shot('zz-blad'); }
  report.errors = errors;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  app.quit();
});
