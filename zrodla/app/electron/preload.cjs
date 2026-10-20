// Most między interfejsem a zapisem na dysku. Interfejs widzi tylko te funkcje.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('atlasApi', {
  load: () => ipcRenderer.invoke('db:load'),
  save: (json) => ipcRenderer.invoke('db:save', json),
  exportFile: (json, name) => ipcRenderer.invoke('db:export', json, name),
  importFile: () => ipcRenderer.invoke('db:import'),
  dataPath: () => ipcRenderer.invoke('db:path'),
  openDataFolder: () => ipcRenderer.invoke('db:openFolder'),
});
