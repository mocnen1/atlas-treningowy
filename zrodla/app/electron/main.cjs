// Proces główny Electron: okno aplikacji i zapis danych na dysku.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Polski format dat i godzin w polach formularzy niezależnie od języka systemu
app.commandLine.appendSwitch('lang', 'pl');

const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'atlas-data.json');
const backupDir = () => path.join(dataDir(), 'kopie-zapasowe');
const KEEP_BACKUPS = 30;

function dailyBackup() {
  // Raz dziennie kopia poprzedniego stanu pliku, trzymamy ostatnie 30 dni.
  const src = dataFile();
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(backupDir(), { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const dst = path.join(backupDir(), `atlas-data-${day}.json`);
  if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
  const all = fs.readdirSync(backupDir()).filter(f => f.startsWith('atlas-data-')).sort();
  for (const f of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(path.join(backupDir(), f));
}

ipcMain.handle('db:load', () => {
  const f = dataFile();
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
});

ipcMain.handle('db:save', (_e, json) => {
  if (typeof json !== 'string' || json.length < 2) throw new Error('Pusty zapis odrzucony');
  JSON.parse(json); // nie zapisuj uszkodzonych danych
  fs.mkdirSync(dataDir(), { recursive: true });
  dailyBackup();
  const tmp = dataFile() + '.tmp';
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, dataFile()); // podmiana atomowa: plik nigdy nie zostaje w połowie zapisany
});

ipcMain.handle('db:export', async (e, json, suggestedName) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showSaveDialog(win, {
    title: 'Eksport danych', defaultPath: path.join(app.getPath('documents'), suggestedName),
    filters: [{ name: 'Dane Atlasu Treningowego', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, json, 'utf8');
  return true;
});

ipcMain.handle('db:import', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, {
    title: 'Import danych', properties: ['openFile'], filters: [{ name: 'Pliki JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return fs.readFileSync(r.filePaths[0], 'utf8');
});

ipcMain.handle('db:path', () => dataFile());
ipcMain.handle('db:openFolder', () => shell.openPath(dataDir()));

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 660, show: false,
    backgroundColor: '#121614', autoHideMenuBar: true, title: 'Atlas Treningowy',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.removeMenu();
  // Kamerka do odczytu kodów QR z telefonu; inne uprawnienia zablokowane
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, perm, cb, details) => cb(perm === 'media' && (details.mediaTypes ?? []).every(t => t === 'video')));
  ses.setPermissionCheckHandler((_wc, perm) => perm === 'media');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (ev, url) => { if (!url.startsWith('file:')) { ev.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
