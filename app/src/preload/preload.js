// Preload — safe bridge between renderer and main (contextIsolated).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zubii', {
  getInfo: () => ipcRenderer.invoke('app:get-info'),
  saveSettings: (s) => ipcRenderer.invoke('app:save-settings', s),
  checkPhotoshop: (force) => ipcRenderer.invoke('app:check-photoshop', force),
  pickPhotos: () => ipcRenderer.invoke('photos:pick'),
  pickPhotoFolder: () => ipcRenderer.invoke('photos:pick-folder'),
  listPresets: () => ipcRenderer.invoke('presets:list'),
  importPresets: () => ipcRenderer.invoke('presets:import'),
  installToCameraRaw: (p) => ipcRenderer.invoke('presets:install-to-camera-raw', p),
  checkPresetCompatibility: (o) => ipcRenderer.invoke('presets:check-compatibility', o),
  autoPick: (photos) => ipcRenderer.invoke('auto:pick', { photos }),
  pickOutputFolder: () => ipcRenderer.invoke('output:pick-folder'),
  openOutputFolder: (d) => ipcRenderer.invoke('output:open-folder', d),
  makePreview: (o) => ipcRenderer.invoke('preview:make', o),
  startBatch: (o) => ipcRenderer.invoke('batch:start', o),
  cancelBatch: () => ipcRenderer.invoke('batch:cancel'),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  openReleases: () => ipcRenderer.invoke('updates:open-releases'),
  openSupport: () => ipcRenderer.invoke('support:open-whatsapp'),
  onProgress: (cb) => ipcRenderer.on('batch:progress', (_e, s) => cb(s)),
});
