// Renderer — Zubii Batch Preset Tool UI logic (with Auto Pick Preset).
'use strict';

const $ = (id) => document.getElementById(id);
// Photo model: { path, picked: {name,path,score}|null, reason, ranked: [{name,path,score,reasons}], override: {name,path}|null }
let photos = [];
let presets = [];         // {name, file, path, settings}
let selectedPreset = null; // global fallback preset (manual mode)
let selectedPhoto = null;  // photo object
let settings = {};
let running = false;
let batchStart = 0;
let autoMode = false;      // true after Auto Pick runs
let photoshopInfo = null;  // checkPhotoshop() ka result — version label ke liye

// Compatibility warning — batch se pehle, Roman Urdu me log me dikhao.
// Warning hoti hai, block nahi: user khud faisla karta hai.
async function checkCompatAndWarn(preset) {
  if (!preset || !window.zubii.checkPresetCompatibility) return null;
  try {
    const r = await window.zubii.checkPresetCompatibility({
      presetPath: preset.path,
      photoshopVersion: photoshopInfo && photoshopInfo.version ? photoshopInfo.version : null,
    });
    if (r && r.ok && r.warning) log('⚠ COMPATIBILITY: ' + r.warning);
    return r;
  } catch (_) { return null; }
}

function log(msg) {
  const el = $('log');
  el.textContent += (el.textContent ? '\n' : '') + msg;
  el.scrollTop = el.scrollHeight;
}
function fileName(p) { return p.split(/[\\/]/).pop(); }
function setStep(n) {
  for (let i = 1; i <= 4; i++) {
    const el = $('step-' + i);
    el.classList.toggle('done', i < n);
    el.classList.toggle('active', i === n);
  }
}
// Is photo ko kaun sa preset lagega: manual override > auto pick > global preset.
function effectivePreset(photo) {
  if (photo.override) return photo.override;
  if (photo.picked) return { name: photo.picked.name, path: photo.picked.path };
  if (selectedPreset) return { name: selectedPreset.name, path: selectedPreset.path };
  return null;
}

async function refreshPresets() {
  presets = await window.zubii.listPresets();
  renderPresets();
}
function renderPresets() {
  const q = ($('preset-search').value || '').toLowerCase();
  const list = $('preset-list');
  list.innerHTML = '';
  const shown = presets.filter((p) => p.name.toLowerCase().includes(q));
  if (!shown.length) { list.innerHTML = '<p class="muted">Koi preset nahi — neeche se import karo.</p>'; return; }
  for (const p of shown) {
    const b = document.createElement('button');
    b.className = 'preset-item' + (selectedPreset && selectedPreset.path === p.path ? ' selected' : '');
    b.textContent = '★ ' + p.name;
    b.onclick = () => selectPreset(p);
    list.appendChild(b);
  }
}
function selectPreset(p) {
  selectedPreset = p;
  settings.lastPreset = p.path;
  window.zubii.saveSettings(settings);
  renderPresets();
  const s = p.settings || {};
  const rows = Object.entries(s).map(([k, v]) => `${k}: ${v}`).join('  ·  ');
  $('preset-detail').innerHTML = rows
    ? `<b>${p.name}</b><br>${rows}`
    : `<b>${p.name}</b><br>Settings preview nahi mil saka — preset phir bhi kaam karega.`;
  // Preset is Photoshop version par poora lagega ya nahi — warning yahin dikhao.
  checkCompatAndWarn(p).then((r) => {
    if (r && r.ok && r.warning) {
      $('preset-detail').innerHTML += `<div class="compat-warning">⚠ ${r.warning}</div>`;
    }
  });
  setStep(photos.length ? 3 : 2);
}

function renderPhotos() {
  $('photo-count').textContent = `${photos.length} photos selected · Hover to compare · Grid view`;
  const grid = $('photo-grid');
  grid.innerHTML = '';
  if (!photos.length) { grid.innerHTML = '<p class="muted empty">Photos add karo — JPG files, 40–50 aik saath chal jayengi.</p>'; renderPhotoDetail(); return; }
  for (const photo of photos) {
    const eff = effectivePreset(photo);
    const d = document.createElement('div');
    d.className = 'thumb' + (selectedPhoto === photo ? ' selected' : '');
    const pickLabel = eff ? (photo.override ? '✎ ' + eff.name : (photo.picked ? '✦ ' + eff.name : eff.name)) : '—';
    d.innerHTML = `<span class="pick${photo.override ? ' manual' : ''}">${pickLabel}</span>` +
      `<img src="file://${photo.path.replace(/\\/g, '/')}" alt=""><span>${fileName(photo.path)}</span>`;
    d.onclick = () => { selectedPhoto = photo; renderPhotos(); };
    grid.appendChild(d);
  }
  renderPhotoDetail();
  setStep(selectedPreset || autoMode ? 3 : 1);
}

function renderPhotoDetail() {
  const el = $('photo-detail');
  if (!selectedPhoto) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const photo = selectedPhoto;
  const eff = effectivePreset(photo);
  const ranked = photo.ranked || [];
  el.classList.remove('hidden');
  el.innerHTML =
    `<h3>${fileName(photo.path)}</h3>` +
    (photo.picked
      ? `<div>Auto Pick: <b>${photo.picked.name}</b> (score ${photo.picked.score}/100)</div><div class="reason">Kyun: ${photo.reason || ''}</div>`
      : `<div class="reason">Auto Pick nahi hua — ${eff ? 'global preset "' + eff.name + '" lagega.' : 'koi preset nahi chuna.'}</div>`) +
    (ranked.length
      ? `<div class="ranked">Top choices: ${ranked.slice(0, 3).map((r) => `${r.name} (${r.score})`).join(' · ')}</div>`
      : '') +
    `<label class="muted small">Manual override — is photo ke liye preset badlo:</label>` +
    `<select id="override-select">
       <option value="">— Auto / Global preset rehne do —</option>
       ${presets.map((p) => `<option value="${p.path}"${photo.override && photo.override.path === p.path ? ' selected' : ''}>${p.name}</option>`).join('')}
     </select>`;
  $('override-select').onchange = (e) => {
    const p = presets.find((x) => x.path === e.target.value);
    photo.override = p ? { name: p.name, path: p.path } : null;
    log(`${fileName(photo.path)}: manual override → ${p ? p.name : 'auto/global'}`);
    renderPhotos();
  };
}

async function addPhotos(paths) {
  const fresh = paths.filter((p) => !photos.some((x) => x.path === p))
    .map((p) => ({ path: p, picked: null, reason: '', ranked: [], override: null }));
  photos = photos.concat(fresh);
  log(`+ ${fresh.length} photos add hui (kul ${photos.length}).`);
  renderPhotos();
}

async function runAutoPick() {
  if (!photos.length) { log('Pehle photos add karo.'); return; }
  if (presets.length < 1) { log('Pehle kam az kam aik preset import karo.'); return; }
  $('btn-auto-pick').disabled = true;
  $('auto-status').textContent = 'Photos ka analysis ho raha hai… (brightness, rang, warm/cool, skin tones)';
  log(`Auto Pick: ${photos.length} photos × ${presets.length} presets ka analysis…`);
  try {
    const res = await window.zubii.autoPick(photos.map((p) => p.path));
    if (!res.ok) { log('Auto Pick FAILED: ' + res.error); return; }
    const byPhoto = new Map(res.results.map((r) => [r.photo, r]));
    for (const photo of photos) {
      const r = byPhoto.get(photo.path);
      if (r) { photo.picked = r.picked; photo.reason = r.reason; photo.ranked = r.ranked; photo.override = null; }
    }
    autoMode = true;
    const counts = {};
    for (const photo of photos) if (photo.picked) counts[photo.picked.name] = (counts[photo.picked.name] || 0) + 1;
    $('auto-status').textContent = 'Auto Pick ho gaya: ' + Object.entries(counts).map(([n, c]) => `${n} (${c})`).join(' · ');
    log('Auto Pick ho gaya — ' + $('auto-status').textContent + '. Kisi photo par click karke override kar sakte ho.');
    if (photos[0]) selectedPhoto = photos[0];
    renderPhotos();
  } catch (err) {
    log('Auto Pick FAILED: ' + (err && err.message ? err.message : err));
  } finally { $('btn-auto-pick').disabled = false; }
}

async function testOnePhoto() {
  const photo = selectedPhoto || photos[0];
  if (!photo) { log('Pehle photos add karo.'); return; }
  const eff = effectivePreset(photo);
  if (!eff) { log('Pehle aik preset chuno ya Auto Pick chalao.'); return; }
  await checkCompatAndWarn(eff);
  log(`Test: ${fileName(photo.path)} par "${eff.name}" lagaya ja raha hai… (Photoshop khul sakta hai)`);
  $('btn-test-one').disabled = true;
  try {
    const out = await window.zubii.makePreview({ presetPath: eff.path, photoPath: photo.path });
    $('compare').classList.remove('hidden');
    $('img-before').src = 'file://' + photo.path.replace(/\\/g, '/');
    $('img-after').src = 'file://' + out.replace(/\\/g, '/') + '?t=' + Date.now();
    log('Test preview tayyar — BEFORE / AFTER dekho. Agar rang theek lage to Start Batch dabao.');
  } catch (err) {
    log('Test FAILED: ' + (err && err.message ? err.message : err));
  } finally { $('btn-test-one').disabled = false; }
}

async function startBatch() {
  if (running) return;
  if (!photos.length) { log('Pehle photos add karo.'); return; }
  // Per-photo assignments: override > auto pick > global preset.
  const assignments = [];
  for (const photo of photos) {
    const eff = effectivePreset(photo);
    if (!eff) { log(`"${fileName(photo.path)}" ke liye koi preset nahi — preset chuno ya Auto Pick chalao.`); return; }
    assignments.push({ src: photo.path, presetPath: eff.path, presetName: eff.name });
  }
  running = true; batchStart = Date.now();
  lastBatchNote = ''; // naya batch — purani note dobara dikhaye.
  $('btn-start').disabled = true;
  $('btn-cancel').classList.remove('hidden');
  $('btn-open-output').classList.add('hidden');
  setStep(4);
  const mode = autoMode ? 'Auto Pick' : 'single preset';
  // Batch se pehle har alag preset ki compatibility warning dikhao — block nahi.
  const seenPresets = [];
  for (const a of assignments) {
    if (!seenPresets.some((x) => x.path === a.presetPath)) seenPresets.push({ name: a.presetName, path: a.presetPath });
  }
  for (const p of seenPresets) await checkCompatAndWarn(p);
  log(`Batch shuru (${mode}): ${photos.length} photos · quality ${settings.quality}%`);
  const res = await window.zubii.startBatch({
    presetPath: selectedPreset ? selectedPreset.path : null,
    presetName: selectedPreset ? selectedPreset.name : null,
    files: assignments, outputDir: settings.outputDir,
    quality: settings.quality, resize: settings.resize,
    resizeWidth: settings.resizeWidth, namingPattern: settings.namingPattern,
  });
  running = false;
  $('btn-start').disabled = false;
  $('btn-cancel').classList.add('hidden');
  if (res.ok) {
    const r = res.result;
    log(`HO GAYA: ${r.ok} theek, ${r.failed} fail. Output: ${settings.outputDir}`);
    if (r.failed) r.errors.forEach((e) => log('FAIL ' + fileName(e.file) + ': ' + e.error));
    $('btn-open-output').classList.remove('hidden');
  } else {
    log('Batch FAILED: ' + res.error);
  }
}

// Batch progress — fatal/note bhi dikhao taake 0% par atka na rahe.
let lastBatchNote = '';
function bindProgress() {
  window.zubii.onProgress((s) => {
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    $('progress-bar').style.width = pct + '%';
    $('progress-text').textContent = `Processing: ${s.done} of ${s.total} photos completed · ${pct}%`;
    // Fallback ki wajah (maslan COM adhoora hai) — aik dafa log me.
    if (s.note && s.note !== lastBatchNote) {
      lastBatchNote = s.note;
      log('NOTE: ' + s.note);
    }
    // Fatal error aaye to 0% par atka na rahe — log me asal wajah likho.
    if (s.fatal) {
      $('progress-text').textContent = `Batch ruk gaya — ${s.fatal}`;
      log('Batch ERROR: ' + s.fatal);
    }
    if (s.done > 0 && s.done < s.total) {
      const elapsed = (Date.now() - batchStart) / 1000;
      const per = elapsed / s.done;
      const left = Math.round(per * (s.total - s.done));
      $('eta').textContent = `Estimated time remaining: ~${Math.floor(left / 60)}m ${left % 60}s · ${s.total - s.done} photos remaining`;
    } else if (s.done >= s.total && s.total) { $('eta').textContent = 'Done.'; }
  });
}

// Photoshop status — aik dafa check karo, phir result yaad rakho.
// force=true sirf "Dobara check karo" button se aata hai. Check ke doran
// Photoshop khulta ya band nahi hota (main process me kabhi Quit nahi).
// lastPsDiagnostics: na milne par poori detail (COM error + kya check
// kiya gaya) — "Detail copy karo" button isay clipboard me deta hai.
let lastPsDiagnostics = '';
async function refreshPhotoshopStatus(force) {
  const el = $('ps-status');
  const btn = $('btn-ps-recheck');
  const copyBtn = $('btn-ps-copy');
  el.textContent = 'Photoshop check ho raha hai…';
  el.className = 'ps-status checking';
  el.title = '';
  btn.disabled = true;
  btn.classList.remove('attention');
  copyBtn.classList.add('hidden');
  let ps;
  try {
    ps = await window.zubii.checkPhotoshop(force);
  } catch (err) {
    // IPC khud fail ho jaye to badge kabhi "check ho raha hai" par
    // atka na rahe — failure dikhao, detail ke saath.
    ps = { ok: false, reason: 'ipc-error', version: null, major: null,
      detail: 'Photoshop check chala hi nahi (app ka andaruni masla): ' + (err && err.message ? err.message : err),
      diagnostics: 'IPC error — main process se jawab nahi aaya.' };
  }
  photoshopInfo = ps;
  btn.disabled = false;
  const pathEl = $('ps-path');
  if (ps.ok) {
    // Version + path DONO dikhao: "✓ Photoshop CC 2019 (poori version)"
    // badge me, poora exe path us ke saath chhote span me (hover = poora path).
    const verLabel = (ps.year && ps.version) ? ps.year + ' (' + ps.version + ')' : (ps.label || '');
    el.textContent = '✓ Photoshop' + (verLabel ? ' ' + verLabel : '');
    el.className = 'ps-status ok';
    el.title = ps.exe ? ps.exe : '';
    if (ps.exe) { pathEl.textContent = ps.exe; pathEl.title = ps.exe + (ps.source ? ' — ' + ps.source : ''); }
    else { pathEl.textContent = ''; pathEl.title = ''; }
    log((force ? 'Photoshop dobara check: mil gaya — ' : 'Photoshop mil gaya: ') + ps.detail + (ps.label ? ' (' + ps.label + ')' : '') + (ps.exe ? ' Path: ' + ps.exe : ''));
  } else {
    el.textContent = '✕ Photoshop nahi mila';
    el.className = 'ps-status bad';
    lastPsDiagnostics = (ps.detail || ps.reason || 'Photoshop nahi mila') +
      (ps.diagnostics ? '\nChecked: ' + ps.diagnostics : '');
    el.title = ps.diagnostics || ps.detail || '';
    pathEl.textContent = '';
    pathEl.title = '';
    btn.classList.add('attention');
    copyBtn.classList.remove('hidden');
    log('Photoshop check: ' + lastPsDiagnostics + ' — Photoshop CC 2019 (20.x) ya us se naya install karo, phir "Dobara check karo" dabao, ya "Photoshop.exe chuno" se khud path do.');
  }
  return ps;
}

// Manual rasta — user khud Photoshop.exe chune.
async function pickPhotoshopExe() {
  const btn = $('btn-ps-pick');
  btn.disabled = true;
  try {
    const r = await window.zubii.choosePhotoshopExe();
    if (r && r.canceled) { log('Photoshop.exe chunna cancel kar diya.'); return; }
    if (!r || !r.ok) { log('Photoshop.exe nahi chuna ja saka: ' + (r && r.error ? r.error : 'namaloom masla')); return; }
    log('Manual Photoshop path save ho gaya: ' + r.exe);
    await refreshPhotoshopStatus(true);
  } catch (err) {
    log('Photoshop.exe chunne me masla: ' + (err && err.message ? err.message : err));
  } finally {
    btn.disabled = false;
  }
}

// Diagnostic detail clipboard me — user mujhe bhej sake.
async function copyPsDiagnostics() {
  const btn = $('btn-ps-copy');
  const text = lastPsDiagnostics || 'Koi diagnostic detail nahi.';
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copy ho gaya ✓';
    log('Photoshop check ki detail copy ho gayi — mujhe bhej do.');
    setTimeout(() => { btn.textContent = 'Detail copy karo'; }, 2000);
  } catch (err) {
    log('Copy nahi ho saka — detail neeche log me hai, wahan se copy kar lo.');
  }
}

// Update popup (toast) — MetaBox jaisa bottom-right popup, Roman Urdu
// me. Native dialog nahi: update available / download progress / tayyar /
// latest version / error sab isi popup se. Buttons: Download karo,
// Restart karo, Baad me.
let toastTimer = null;
function showUpdateToast({ title, msg, progress, primary, secondary, onPrimary, onSecondary, autoHideMs }) {
  const toast = $('update-toast');
  $('update-toast-title').textContent = title || '';
  $('update-toast-msg').textContent = msg || '';
  const prog = $('update-toast-progress');
  if (progress === null || progress === undefined) prog.classList.add('hidden');
  else { prog.classList.remove('hidden'); $('update-toast-bar').style.width = progress + '%'; }
  const pBtn = $('update-toast-primary');
  const sBtn = $('update-toast-secondary');
  if (primary) { pBtn.textContent = primary; pBtn.classList.remove('hidden'); pBtn.onclick = onPrimary || null; }
  else pBtn.classList.add('hidden');
  if (secondary) { sBtn.textContent = secondary; sBtn.classList.remove('hidden'); sBtn.onclick = onSecondary || null; }
  else sBtn.classList.add('hidden');
  toast.classList.remove('hidden');
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  if (autoHideMs) toastTimer = setTimeout(hideUpdateToast, autoHideMs);
}
function hideUpdateToast() {
  $('update-toast').classList.add('hidden');
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
}
function bindUpdateToast() {
  $('update-toast-close').onclick = hideUpdateToast;
  window.zubii.onUpdate((p) => {
    if (!p) return;
    if (p.type === 'available') {
      showUpdateToast({
        title: 'Nayi version aa gayi hai',
        msg: `Zubii Batch Preset Tool v${p.version} available hai (tumhare paas v${p.currentVersion}).`,
        primary: 'Download karo',
        secondary: 'Baad me',
        onPrimary: () => {
          window.zubii.downloadUpdate();
          showUpdateToast({
            title: 'Download ho raha hai…',
            msg: `v${p.version} download ho raha hai — thoda intezar karo.`,
            progress: 0,
            secondary: 'Baad me',
            onSecondary: hideUpdateToast,
          });
        },
        onSecondary: hideUpdateToast,
      });
    } else if (p.type === 'progress') {
      showUpdateToast({
        title: 'Download ho raha hai…',
        msg: `Update download ho raha hai — ${p.percent}%`,
        progress: p.percent,
        secondary: 'Baad me',
        onSecondary: hideUpdateToast,
      });
    } else if (p.type === 'downloaded') {
      showUpdateToast({
        title: 'Update tayyar hai',
        msg: `v${p.version} download ho gaya — restart karte hi install ho jayega.`,
        primary: 'Restart karo',
        secondary: 'Baad me',
        onPrimary: () => window.zubii.restartToInstall(),
        onSecondary: hideUpdateToast,
      });
    } else if (p.type === 'none') {
      showUpdateToast({
        title: 'Tum latest version par ho',
        msg: `v${p.version} hi nayi version hai — kuch download nahi karna.`,
        secondary: 'Theek hai',
        onSecondary: hideUpdateToast,
        autoHideMs: 5000,
      });
    } else if (p.type === 'error') {
      showUpdateToast({
        title: 'Update check nahi ho saka',
        msg: 'GitHub Releases se rabta nahi ho saka — internet check karo, ya Releases page kholo.' + (p.message ? ' (' + p.message + ')' : ''),
        secondary: 'Theek hai',
        onSecondary: hideUpdateToast,
      });
    }
  });
}

async function init() {
  const info = await window.zubii.getInfo();
  settings = info.settings || settings;
  $('app-version').textContent = 'v' + info.version + ' · Free';
  $('quality').value = settings.quality || 85;
  $('quality-val').textContent = (settings.quality || 85) + '%';
  $('output-dir').value = settings.outputDir || '';
  $('resize-toggle').checked = !!settings.resize;
  $('resize-width').value = settings.resizeWidth || 2048;
  $('naming').value = settings.namingPattern || '{preset}_{filename}_{seq}';

  await refreshPhotoshopStatus(false);

  await refreshPresets();
  if (settings.lastPreset) {
    const p = presets.find((x) => x.path === settings.lastPreset);
    if (p) selectPreset(p);
  }
  renderPhotos();
  bindProgress();
  bindUpdateToast();

  $('preset-search').addEventListener('input', renderPresets);
  $('btn-import-preset').onclick = async () => {
    const added = await window.zubii.importPresets();
    if (added.length) { log('Preset import: ' + added.join(', ')); await refreshPresets(); }
  };
  $('btn-install-cr').onclick = async () => {
    if (!selectedPreset) { log('Pehle aik preset chuno.'); return; }
    const r = await window.zubii.installToCameraRaw(selectedPreset.path);
    log(r.ok ? 'Camera Raw me install ho gaya: ' + r.dest : 'Install fail: ' + r.error);
  };
  $('btn-add-photos').onclick = async () => addPhotos(await window.zubii.pickPhotos());
  $('btn-add-folder').onclick = async () => addPhotos(await window.zubii.pickPhotoFolder());
  $('btn-clear-photos').onclick = () => { photos = []; selectedPhoto = null; autoMode = false; $('auto-status').textContent = ''; renderPhotos(); };
  $('btn-test-one').onclick = testOnePhoto;
  $('btn-auto-pick').onclick = runAutoPick;
  $('btn-start').onclick = startBatch;
  $('btn-cancel').onclick = async () => { await window.zubii.cancelBatch(); log('Cancel kar diya — maujooda photo ke baad ruk jayega.'); };
  $('btn-open-output').onclick = () => window.zubii.openOutputFolder(settings.outputDir);
  $('btn-output-dir').onclick = async () => {
    const d = await window.zubii.pickOutputFolder();
    if (d) { settings.outputDir = d; $('output-dir').value = d; window.zubii.saveSettings(settings); }
  };
  $('quality').oninput = (e) => {
    settings.quality = +e.target.value; $('quality-val').textContent = settings.quality + '%';
    window.zubii.saveSettings(settings);
  };
  $('resize-toggle').onchange = (e) => { settings.resize = e.target.checked; window.zubii.saveSettings(settings); };
  $('resize-width').onchange = (e) => { settings.resizeWidth = +e.target.value || 2048; window.zubii.saveSettings(settings); };
  $('naming').onchange = (e) => { settings.namingPattern = e.target.value.trim() || '{preset}_{filename}_{seq}'; window.zubii.saveSettings(settings); };
  $('btn-updates').onclick = () => {
    window.zubii.checkUpdates();
    showUpdateToast({
      title: 'Update check ho raha hai…',
      msg: 'GitHub Releases se nayi version check kar raha hun.',
      secondary: 'Baad me',
      onSecondary: hideUpdateToast,
    });
  };
  $('btn-ps-recheck').onclick = () => refreshPhotoshopStatus(true);
  $('btn-ps-pick').onclick = () => pickPhotoshopExe();
  $('btn-ps-copy').onclick = () => copyPsDiagnostics();
  $('btn-support').onclick = () => window.zubii.openSupport();
}

init();
