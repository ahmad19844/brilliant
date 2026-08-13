import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { startLocalServer } from '../server/app.mjs';
let local;
app.whenReady().then(async () => { local = await startLocalServer({ dbPath: join(app.getPath('userData'), 'bfia-cbt.db') }); const win = new BrowserWindow({ width: 1280, height: 820, webPreferences: { preload: join(import.meta.dirname, 'preload.mjs'), contextIsolation: true, nodeIntegration: false } }); await win.loadURL(`${local.baseUrl}/admin`); });
app.on('window-all-closed', () => app.quit()); app.on('before-quit', () => local?.close());
