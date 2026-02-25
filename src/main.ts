import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { autoUpdater } from 'electron-updater';

autoUpdater.logger = null;
autoUpdater.autoDownload = false; // vi viser UI først, brugeren beslutter

function setupAutoUpdater(win: BrowserWindow): void {
  autoUpdater.on('update-available', (info) => {
    win.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes ?? info.releaseName ?? '',
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    win.webContents.send('update-download-progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    win.webContents.send('update-downloaded', {
      version: info.version,
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater error]', err.message);
    win.webContents.send('update-error', err.message);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] No update available (current version is latest)');
    win.webContents.send('update-not-available');
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
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
  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  // Sæt updater-listeners op én gang
  setupAutoUpdater(win);

  // Opdateringstjek startes fra renderer (sikrer listeners er klar)
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

ipcMain.on('window-minimize', () => {
  BrowserWindow.getFocusedWindow()?.minimize();
});

ipcMain.on('window-maximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win?.isMaximized()) win.unmaximize();
  else win?.maximize();
});

ipcMain.on('window-close', () => {
  BrowserWindow.getFocusedWindow()?.close();
});

ipcMain.on('start-download-update', () => {
  autoUpdater.downloadUpdate().catch(() => {});
});

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('check-for-updates', async () => {
  return autoUpdater.checkForUpdates().catch((e: any) => {
    console.error('[Updater check failed]', e.message);
    return null;
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
