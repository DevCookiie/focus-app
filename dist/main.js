"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const electron_updater_1 = require("electron-updater");
electron_updater_1.autoUpdater.logger = null;
electron_updater_1.autoUpdater.autoDownload = false; // vi viser UI først, brugeren beslutter
function setupAutoUpdater(win) {
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        win.webContents.send('update-available', {
            version: info.version,
            releaseNotes: info.releaseNotes ?? info.releaseName ?? '',
            releaseDate: info.releaseDate,
        });
    });
    electron_updater_1.autoUpdater.on('download-progress', (progress) => {
        win.webContents.send('update-download-progress', {
            percent: Math.round(progress.percent),
            transferred: progress.transferred,
            total: progress.total,
        });
    });
    electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
        win.webContents.send('update-downloaded', {
            version: info.version,
        });
    });
    electron_updater_1.autoUpdater.on('error', (err) => {
        console.error('[Updater error]', err.message);
        win.webContents.send('update-error', err.message);
    });
    electron_updater_1.autoUpdater.on('update-not-available', () => {
        console.log('[Updater] No update available (current version is latest)');
        win.webContents.send('update-not-available');
    });
}
function createWindow() {
    const win = new electron_1.BrowserWindow({
        width: 900,
        height: 650,
        minWidth: 750,
        minHeight: 550,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: '#0f0f13',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
    if (!electron_1.app.isPackaged) {
        win.webContents.openDevTools({ mode: 'detach' });
    }
    // Sæt updater-listeners op én gang
    setupAutoUpdater(win);
    // Opdateringstjek startes fra renderer (sikrer listeners er klar)
}
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.ipcMain.on('window-minimize', () => {
    electron_1.BrowserWindow.getFocusedWindow()?.minimize();
});
electron_1.ipcMain.on('window-maximize', () => {
    const win = electron_1.BrowserWindow.getFocusedWindow();
    if (win?.isMaximized())
        win.unmaximize();
    else
        win?.maximize();
});
electron_1.ipcMain.on('window-close', () => {
    electron_1.BrowserWindow.getFocusedWindow()?.close();
});
electron_1.ipcMain.on('start-download-update', () => {
    electron_updater_1.autoUpdater.downloadUpdate().catch(() => { });
});
electron_1.ipcMain.on('install-update', () => {
    electron_updater_1.autoUpdater.quitAndInstall(false, true);
});
electron_1.ipcMain.handle('check-for-updates', async () => {
    return electron_updater_1.autoUpdater.checkForUpdates().catch((e) => {
        console.error('[Updater check failed]', e.message);
        return null;
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
