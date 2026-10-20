const { app, BrowserWindow } = require('electron'); const path = require('node:path'); const fs = require('node:fs');
app.setPath('userData', process.env.UD);
require(path.join(process.env.ASAR, 'electron', 'main.cjs'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  await sleep(2000); const w = BrowserWindow.getAllWindows()[0]; const js = c => w.webContents.executeJavaScript(c);
  await js(`(() => { const i = document.querySelector('#np-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Test'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Utwórz profil')).click()`); await sleep(500);
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Ćwiczenia').click()`); await sleep(1500);
  await js(`document.querySelector('.ex').click()`); await sleep(1500);
  const r = await js(`[...document.images].filter(i => i.src.includes('/img/')).map(i => ({ ok: i.complete && i.naturalWidth > 0, src: i.src.split('/img/')[1] }))`);
  fs.writeFileSync(process.env.OUT, JSON.stringify({ zaladowane: r.filter(x => x.ok).length, wszystkie: r.length, przyklad: r[0] }));
  app.quit();
});
