import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Auto-updater
  onUpdateAvailable:    (cb: (info: any) => void) => ipcRenderer.on('update-available',        (_e, info) => cb(info)),
  onUpdateProgress:     (cb: (p: any)    => void) => ipcRenderer.on('update-download-progress', (_e, p)    => cb(p)),
  onUpdateDownloaded:   (cb: (info: any) => void) => ipcRenderer.on('update-downloaded',        (_e, info) => cb(info)),
  startDownloadUpdate:  () => ipcRenderer.send('start-download-update'),
  installUpdate:        () => ipcRenderer.send('install-update'),
  checkForUpdates:      () => ipcRenderer.invoke('check-for-updates'),
  onUpdateError:        (cb: (msg: string) => void) => ipcRenderer.on('update-error', (_e, msg) => cb(msg)),
  onUpdateNotAvailable: (cb: () => void) => ipcRenderer.on('update-not-available', () => cb()),
});
