// Telefon 390×844: plan z superserią (hack + łydki) i ćwiczeniem w dwóch wariantach powtórzeń, potem usunięcie planu.
// Użycie: OUT=… USERDATA=… PHONE_HTML=…/dist-phone/index.html electron ss-flow.cjs
const { app, BrowserWindow } = require('electron');
const path = require('node:path'); const fs = require('node:fs');
const OUT = process.env.OUT;
app.setPath('userData', process.env.USERDATA);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const seed = {
  v: 1, profile: 'Bartek', receivedAt: '2026-10-21T10:00:00Z', custom: [], rated: {}, alt: {}, active: null, rest: null, history: [],
  settings: { kgStep: 2.5, defaultRest: 120, sound: false },
  last: { Hack_Squat: ['2026-10-20', 100, 10], Standing_Calf_Raises: ['2026-10-20', 80, 15], Hanging_Leg_Raise: ['2026-10-20', null, 10] },
  plans: [
    { id: 'p1', name: 'Nogi', exercises: [
      { exerciseId: 'Hack_Squat', sets: 3, repsMin: 8, repsMax: 10, restSec: 150, notes: '', ss: 'g1' },
      { exerciseId: 'Standing_Calf_Raises', sets: 3, repsMin: 12, repsMax: 15, restSec: 60, notes: '', ss: 'g1' },
      { exerciseId: 'Hanging_Leg_Raise', sets: 3, repsMin: 10, repsMax: 10, restSec: 90, notes: '' },
    ] },
    { id: 'p2', name: 'Test – do usunięcia', exercises: [{ exerciseId: 'Hack_Squat', sets: 1, repsMin: 5, repsMax: 5, restSec: 60, notes: '' }] },
  ],
};
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 390, height: 844, show: true, webPreferences: { sandbox: true } });
  const errors = [], report = {};
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errors.push(msg); });
  await win.loadFile(process.env.PHONE_HTML);
  const wc = win.webContents, js = c => wc.executeJavaScript(c);
  const shot = async n => { await sleep(500); fs.writeFileSync(path.join(OUT, n + '.png'), (await wc.capturePage()).toPNG()); };
  const click = t => js(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(t)})); if (!b) throw new Error('brak przycisku: ' + ${JSON.stringify(t)}); b.click(); })()`);
  const state = async () => JSON.parse(await js(`localStorage.getItem('atlas-phone-v1')`));
  const tickSet = (exIdx, setIdx) => js(`document.querySelectorAll('.p-ex')[${exIdx}].querySelectorAll('.p-check')[${setIdx}].click()`);
  const typeIn = (sel, v) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  try {
    await js(`localStorage.setItem('atlas-phone-v1', ${JSON.stringify(JSON.stringify(seed))}); location.reload();`); await sleep(1200);
    await shot('s01-start');
    await click('Nogi'); await sleep(600); await shot('s02-trening-superseria');
    // runda 1: hack → od razu łydki (bez przerwy) → przerwa po rundzie
    await tickSet(0, 0); await sleep(300);
    let s = await state(); report.afterHack = s.rest;
    await shot('s03-po-hack-przejscie');
    await tickSet(1, 0); await sleep(300);
    s = await state(); report.afterCalf = s.rest;
    await shot('s04-po-lydkach-przerwa');
    // wznosy: włączenie dwóch wariantów
    await js(`document.querySelectorAll('.p-ex')[2].querySelector('.p-exmenu .p-icon').click()`); await sleep(200);
    await click('Powtórzenia w 2 wariantach'); await sleep(300);
    await typeIn('.p-alt-ed label:nth-of-type(1) input', 'pełne');
    await typeIn('.p-alt-ed label:nth-of-type(2) input', 'tylko nogi');
    await shot('s05-warianty-ustawienia');
    await click('Włącz'); await sleep(300);
    // 1 pełne + 9 nóg: główne pole 1 (stuknięcie w wartość i wpis), łatwiejsze 9
    await js(`document.querySelectorAll('.p-ex')[2].querySelector('.p-set .p-step:nth-of-type(2) span').click()`); await sleep(150);
    await js(`(() => { const el = document.activeElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '1'); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); })()`); await sleep(200);
    await js(`document.querySelectorAll('.p-ex')[2].querySelector('.p-set-alt .p-step span').click()`); await sleep(150);
    await js(`(() => { const el = document.activeElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '9'); el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); })()`); await sleep(200);
    await js(`document.querySelectorAll('.p-ex')[2].scrollIntoView()`);
    await shot('s06-warianty-seria');
    await tickSet(2, 0); await sleep(300);
    s = await state(); report.legSets = s.active.exercises[2].sets.map(x => [x.reps, x.repsAlt, !!x.doneAt]); report.altMem = s.alt;
    await click('Zakończ'); await sleep(200); await click('Zakończ i zapisz'); await sleep(800);
    s = await state(); report.history = s.history[0].exercises.map(e => ({ id: e.exerciseId, ss: e.ss, alt: e.alt, sets: e.sets.filter(x => x.doneAt).map(x => [x.kg, x.reps, x.repsAlt]) }));
    report.last = s.last.Hanging_Leg_Raise;
    await click('Komputer odebrał'); await sleep(500);
    // usuwanie planu
    await click('Usuń plany'); await sleep(300); await shot('s07-usuwanie-planow');
    await js(`[...document.querySelectorAll('.p-plan-del')].find(x => x.textContent.includes('Test')).querySelector('button').click()`); await sleep(200);
    await click('Na pewno usunąć'); await sleep(300); await click('Gotowe'); await sleep(300);
    s = await state(); report.plansLeft = s.plans.map(p => p.name);
    await shot('s08-po-usunieciu');
    // ponowny trening: warianty zapamiętane
    await click('Nogi'); await sleep(500);
    s = await state(); report.altRemembered = s.active.exercises[2].alt; report.legHint = [s.active.exercises[2].sets[0].reps, s.active.exercises[2].sets[0].repsAlt];
    await js(`document.querySelectorAll('.p-ex')[2].scrollIntoView()`); await shot('s09-nastepny-trening-podpowiedz');
  } catch (e) { report.fatal = String(e); await shot('zz-blad'); }
  report.errors = errors;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  app.quit();
});
