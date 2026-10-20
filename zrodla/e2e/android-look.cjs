const { app, BrowserWindow } = require('electron'); const fs = require('node:fs');
app.setPath('userData', process.env.UD);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 393, height: 851 });
  win.webContents.setUserAgent('Mozilla/5.0 (Linux; Android 14; 23124RA7EO) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36');
  await win.loadFile(process.env.HTML); await new Promise(r => setTimeout(r, 1500));
  fs.writeFileSync(process.env.OUT + '/android-start.png', (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.p-icon').click()`); await new Promise(r => setTimeout(r, 600));
  fs.writeFileSync(process.env.OUT + '/android-ustawienia.png', (await win.webContents.capturePage()).toPNG());
  app.quit();
});
