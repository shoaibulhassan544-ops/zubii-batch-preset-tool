// updater.js — GitHub Releases update check. FREE tool: no licence,
// no server, no key. electron-updater with the GitHub provider reads
// releases from the repo in config.js / electron-builder.yml `publish`.
//
// UPDATE FLOW — MetaBox jaisa bottom-right popup (in-app toast, Roman
// Urdu), native system popup NAHI: update milne, download progress, tayyar
// hone aur "latest version" ki khabar renderer me neeche right corner
// wale popup se milti hai. Main process sirf events bhejta hai:
//   'update:event' { type: 'available'|'progress'|'downloaded'|'none'|'error', ... }
// Renderer (app.js bindUpdateToast) popup dikhata hai; Download / Restart
// ke button wapas main ko 'updates:download' / 'updates:restart' bhejte hain.
'use strict';

const { autoUpdater } = require('electron-updater');
const { shell } = require('electron');
const config = require('./config');

let win = null;
let manual = false;

function send(payload) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send('update:event', payload);
  } catch (_) { /* window band — kuch nahi */ }
}

function init(mainWindow) {
  win = mainWindow;
  autoUpdater.autoDownload = false; // user chooses when to download
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    send({ type: 'available', version: info.version, currentVersion: config.version });
  });

  autoUpdater.on('download-progress', (p) => {
    send({
      type: 'progress',
      percent: Math.round(p.percent || 0),
      transferred: p.transferred || 0,
      total: p.total || 0,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    send({ type: 'downloaded', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    if (manual) {
      send({ type: 'none', version: config.version });
      manual = false;
    }
  });

  autoUpdater.on('error', (err) => {
    // Manual check ya download ke doran error — popup se batayo.
    if (manual) {
      send({ type: 'error', message: String(err && err.message ? err.message : err) });
      manual = false;
    }
  });

  // Silent check shortly after launch (only notifies if an update exists).
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 8000);
}

function checkNow() {
  manual = true;
  autoUpdater.checkForUpdates().catch(() => {});
}

function downloadUpdate() {
  autoUpdater.downloadUpdate();
}

function restartToInstall() {
  autoUpdater.quitAndInstall();
}

function openReleasesPage() {
  shell.openExternal(`https://github.com/${config.githubOwner}/${config.githubRepo}/releases`);
}

module.exports = { init, checkNow, downloadUpdate, restartToInstall, openReleasesPage };
