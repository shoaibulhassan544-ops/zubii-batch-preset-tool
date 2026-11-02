// updater.js — GitHub Releases update check. FREE tool: no licence,
// no server, no key. electron-updater with the GitHub provider reads
// releases from the repo in config.js / electron-builder.yml `publish`.
'use strict';

const { autoUpdater } = require('electron-updater');
const { dialog, shell } = require('electron');
const config = require('./config');

let win = null;
let manual = false;

function init(mainWindow) {
  win = mainWindow;
  autoUpdater.autoDownload = false; // user chooses when to download
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    const res = dialog.showMessageBoxSync(win, {
      type: 'info',
      title: 'Update available',
      message: `Zubii Batch Preset Tool v${info.version} available (you have v${config.version}).`,
      detail: 'Download from GitHub Releases? The app will install it when you quit.',
      buttons: ['Download update', 'Later'],
      defaultId: 0,
    });
    if (res === 0) autoUpdater.downloadUpdate();
  });

  autoUpdater.on('update-downloaded', () => {
    const res = dialog.showMessageBoxSync(win, {
      type: 'info',
      title: 'Update ready',
      message: 'Update downloaded. Restart now to install it?',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
    });
    if (res === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.on('update-not-available', () => {
    if (manual) {
      dialog.showMessageBoxSync(win, { type: 'info', title: 'No update', message: `You are on the latest version (v${config.version}).` });
      manual = false;
    }
  });

  autoUpdater.on('error', (err) => {
    if (manual) {
      dialog.showMessageBoxSync(win, {
        type: 'warning', title: 'Update check failed',
        message: 'Could not reach GitHub Releases. Check your internet, or open the releases page manually.',
        detail: String(err && err.message ? err.message : err),
      });
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

function openReleasesPage() {
  shell.openExternal(`https://github.com/${config.githubOwner}/${config.githubRepo}/releases`);
}

module.exports = { init, checkNow, openReleasesPage };
