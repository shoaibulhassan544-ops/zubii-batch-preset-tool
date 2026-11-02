// main.js — Zubii Batch Preset Tool (FREE, no licence system).
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const config = require('./config');
const ps = require('./photoshop');
const autoPick = require('./auto-pick');
const updater = require('./updater');

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const PRESETS_DIR = path.join(app.getPath('userData'), 'presets');
const WORK_DIR = path.join(os.tmpdir(), 'zubii-batch-preset');

let win = null;
let batchRunning = false;

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch (_) {
    return {
      quality: 85, resize: false, resizeWidth: 2048,
      namingPattern: '{preset}_{filename}_{seq}',
      outputDir: path.join(os.homedir(), 'Pictures', 'Zubii Exports'),
      lastPreset: null,
    };
  }
}
function saveSettings(s) {
  try { fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); } catch (_) {}
}
let settings = loadSettings();

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 1024, minHeight: 700,
    title: 'Zubii Batch Preset Tool — Free',
    backgroundColor: '#F7EFE3',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
  updater.init(win);
}

app.whenReady().then(() => {
  fs.mkdirSync(PRESETS_DIR, { recursive: true });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------------------------------------------------------------- IPC ----
ipcMain.handle('app:get-info', () => ({ version: config.version, settings, free: true }));
ipcMain.handle('app:save-settings', (_e, s) => { settings = { ...settings, ...s }; saveSettings(settings); return settings; });

ipcMain.handle('app:check-photoshop', (_e, force) => ps.checkPhotoshop(force));

ipcMain.handle('photos:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Photos chuno (JPG)', filters: [{ name: 'JPEG photos', extensions: ['jpg', 'jpeg'] }],
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('photos:pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Photos wala folder chuno', properties: ['openDirectory'] });
  if (r.canceled) return [];
  const dir = r.filePaths[0];
  return fs.readdirSync(dir).filter((f) => /\.(jpe?g)$/i.test(f)).map((f) => path.join(dir, f));
});

ipcMain.handle('presets:list', () => {
  return fs.readdirSync(PRESETS_DIR).filter((f) => /\.xmp$/i.test(f)).map((f) => {
    const p = path.join(PRESETS_DIR, f);
    let info = {};
    try { info = ps.parseXmpSettings(fs.readFileSync(p, 'utf8')); } catch (_) {}
    return { name: path.basename(f, '.xmp'), file: f, path: p, settings: info };
  });
});

ipcMain.handle('presets:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'XMP preset file chuno', filters: [{ name: 'XMP preset', extensions: ['xmp'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled) return [];
  const added = [];
  for (const src of r.filePaths) {
    const dest = path.join(PRESETS_DIR, path.basename(src));
    fs.copyFileSync(src, dest);
    added.push(path.basename(src, '.xmp'));
  }
  return added;
});

ipcMain.handle('presets:install-to-camera-raw', async (_e, presetPath) => {
  try { return { ok: true, dest: ps.installPresetToCameraRaw(presetPath) }; }
  catch (err) { return { ok: false, error: err.message }; }
});

// COMPATIBILITY: is preset ko is Photoshop version par poora lagega ya
// nayi ACR feature ki wajah se warning hai? Warning hoti hai, block nahi.
// photoshopVersion: renderer se mila hua version string ("24.7") — na ho
// to CACHED version istemal karo. Yahan dobara COM check KABHI NAHI
// chalana — warna har preset select par Photoshop khulta aur band hota.
// Cache khaali ho to version null rehta hai (warning nahi, block bhi nahi).
ipcMain.handle('presets:check-compatibility', async (_e, { presetPath, photoshopVersion }) => {
  try {
    const xmpText = fs.readFileSync(presetPath, 'utf8');
    let psInfo = null;
    if (photoshopVersion) psInfo = ps.parsePhotoshopVersion(photoshopVersion);
    else psInfo = ps.getCachedPhotoshop();
    return { ok: true, ...ps.checkPresetCompatibility(xmpText, psInfo) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// SUPPORT: user ke WhatsApp par le jao (business number).
ipcMain.handle('support:open-whatsapp', () => { shell.openExternal('https://wa.me/923060756225'); return true; });

// AUTO PICK: analyse each photo, rank all imported presets, return the
// best one per photo + why. Presets' XMP text is read here (main process).
ipcMain.handle('auto:pick', async (_e, { photos: photoPaths }) => {
  const presetList = fs.readdirSync(PRESETS_DIR).filter((f) => /\.xmp$/i.test(f)).map((f) => {
    const p = path.join(PRESETS_DIR, f);
    let xmpText = '';
    try { xmpText = fs.readFileSync(p, 'utf8'); } catch (_) {}
    return { name: path.basename(f, '.xmp'), path: p, xmpText };
  });
  if (!presetList.length) return { ok: false, error: 'Koi preset import nahi hua — pehle preset import karo.' };
  try {
    const results = autoPick.autoPickForPhotos(photoPaths, presetList);
    return { ok: true, results };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('output:pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Output folder chuno', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('output:open-folder', (_e, dir) => { shell.openPath(dir); });

// Single-photo preview: run the real Photoshop preset on ONE photo into
// the temp folder, then show it next to the original in the UI.
ipcMain.handle('preview:make', async (_e, { presetPath, photoPath }) => {
  const outDir = path.join(WORK_DIR, 'preview');
  fs.mkdirSync(outDir, { recursive: true });
  const args = ps.buildBatchArgs({
    presetPath, presetName: path.basename(presetPath, '.xmp'),
    files: [photoPath], outputDir: outDir, quality: 85,
    resize: false, resizeWidth: 2048, namingPattern: '{filename}_preview',
    workDir: path.join(WORK_DIR, 'preview-work'),
  });
  const result = await ps.runBatch(args, null);
  if (result.ok === 0) throw new Error(result.errors[0] ? result.errors[0].error : 'Preview failed in Photoshop.');
  const out = fs.readdirSync(outDir).map((f) => path.join(outDir, f))[0];
  return out || null;
});

ipcMain.handle('batch:start', async (_e, { presetPath, presetName, files, outputDir, quality, resize, resizeWidth, namingPattern }) => {
  if (batchRunning) return { ok: false, error: 'A batch is already running.' };
  if (!files || files.length === 0) return { ok: false, error: 'Pehle photos add karo.' };
  // files: array of paths (single preset for all) OR
  // [{src, presetPath, presetName}] (Auto Pick / manual override per photo).
  const hasAssignments = files.length && typeof files[0] === 'object';
  if (!hasAssignments && !presetPath) return { ok: false, error: 'Pehle aik preset chuno.' };
  batchRunning = true;
  const args = ps.buildBatchArgs({
    presetPath, presetName, files, outputDir, quality, resize, resizeWidth,
    namingPattern, workDir: path.join(WORK_DIR, 'batch'),
  });
  try {
    const result = await ps.runBatch(args, (state) => { if (win) win.webContents.send('batch:progress', state); });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally { batchRunning = false; }
});

ipcMain.handle('batch:cancel', () => { ps.cancelBatch(path.join(WORK_DIR, 'batch')); return true; });
ipcMain.handle('updates:check', () => { updater.checkNow(); return true; });
ipcMain.handle('updates:open-releases', () => { updater.openReleasesPage(); return true; });
