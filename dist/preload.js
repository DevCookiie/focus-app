"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    minimize: () => electron_1.ipcRenderer.send('window-minimize'),
    maximize: () => electron_1.ipcRenderer.send('window-maximize'),
    close: () => electron_1.ipcRenderer.send('window-close'),
    // Auto-updater
    onUpdateAvailable: (cb) => electron_1.ipcRenderer.on('update-available', (_e, info) => cb(info)),
    onUpdateProgress: (cb) => electron_1.ipcRenderer.on('update-download-progress', (_e, p) => cb(p)),
    onUpdateDownloaded: (cb) => electron_1.ipcRenderer.on('update-downloaded', (_e, info) => cb(info)),
    startDownloadUpdate: () => electron_1.ipcRenderer.send('start-download-update'),
    installUpdate: () => electron_1.ipcRenderer.send('install-update'),
    checkForUpdates: () => electron_1.ipcRenderer.invoke('check-for-updates'),
    onUpdateError: (cb) => electron_1.ipcRenderer.on('update-error', (_e, msg) => cb(msg)),
    onUpdateNotAvailable: (cb) => electron_1.ipcRenderer.on('update-not-available', () => cb()),
});
