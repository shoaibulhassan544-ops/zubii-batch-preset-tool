// photoshop.js — talks to Adobe Photoshop (CC 2019 / 20.x se 2025 / 26.x
// tak — har version) on Windows via COM. COM ProgID version-independent
// hai: `Photoshop.Application` kisi bhi installed Photoshop se jud jata
// hai, is liye yahan koi version lock nahi hai.
// Runs the ExtendScript in scripts/apply-preset.jsx through PowerShell:
//   New-Object -ComObject Photoshop.Application  ->  DoJavaScriptFile(jsx)
//
// AHAM: check ke doran Photoshop ko KABHI band nahi karna — na COM se
// khula ho, na pehle se chal raha ho. Sirf Version parho aur COM object
// release kar do. Pehle check ke baad Photoshop band kar diya jata tha:
// har check par Photoshop khulta aur foran band ho jata tha (preset
// select karte hi). Ab aisa nahi hota.
// Version pehli kamyab check ke baad cache hoti hai — dobara check sirf
// "Dobara check karo" button se hota hai.
//
// PHOTOSHOP NA MILNE PAR FALLBACK — MAZBOOT AUTO-DETECT (v1.2.2):
// COM fail bhi sakta hai jabke Photoshop installed ho (maslan COM
// register nahi hua). Is liye COM fail ho to ye sab check hota hai:
//   1. Registry — 4 Photoshop keys (HKLM + HKCU, 64-bit + WOW6432Node)
//      ki ApplicationPath, PLUS App Paths\Photoshop.exe ka default value.
//   2. Adobe folders SCAN — C:\Program Files\Adobe AUR (x86)\Adobe,
//      har folder jo "Adobe Photoshop" se shuru ho, us me Photoshop.exe.
//      Sirf 8 fixed paths par bharosa nahi — koi bhi saal/version mile.
//   3. Aam install paths (purani list, extra safety).
// Mil jaye to exact version exe ki FileVersion se nikala jata hai
// (maslan CC 2019 ki poori version) — folder name se sirf backup andaza.
// Na mile to diagnostic detail milti hai: COM error + kya kya check
// kiya gaya, taake agla masla samajh aaye.
//
// HOW THE PRESET IS APPLIED (read this before changing it):
// Adobe provides NO official scripting call like "apply this .xmp preset".
// The script therefore uses the documented Camera Raw behaviour:
//   1. The selected .xmp preset is copied next to a TEMP COPY of each
//      photo as a Camera Raw settings sidecar (<name>.xmp). .xmp presets
//      and Camera Raw sidecars share the same `crs:` settings namespace,
//      so Camera Raw reads the preset as the photo's settings.
//   2. The temp copy is opened with CameraRawOpenOptions, settings =
//      CUSTOM, which makes Camera Raw apply the sidecar on open.
//   3. If that open path does not apply the settings (some Photoshop
//      builds ignore the option for JPEGs), the script falls back to the
//      Camera Raw Filter via ActionManager with the XMP packet attached.
//   4. The document is saved as JPG (quality from export settings),
//      closed without touching the original file. Temp copies + sidecars
//      are deleted afterwards.
// Originals are NEVER overwritten and NEVER get a sidecar written next
// to them. Standard settings (exposure, temperature, contrast, vibrance,
// clarity, tone curve, HSL, sharpness) har version par aik jaisi hain,
// is liye ye har version par chalti hain. Agar preset me nayi ACR
// feature ho (maslan AI masking, Lens Blur) to wo hissa sirf us
// Photoshop par poora lagega jis ka Camera Raw utna naya ho —
// checkPresetCompatibility() ye pehle se bata deta hai (warning, block nahi).
// Use "Test one photo" first and check the result.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const os = require('os');
const config = require('./config');

const SCRIPTS_DIR = path.join(process.resourcesPath || path.join(__dirname, '..', '..', '..'), 'scripts');
// In dev (npm start) resourcesPath is the Electron folder, so fall back:
const DEV_SCRIPTS_DIR = path.join(__dirname, '..', '..', '..', 'scripts');

function resolveScriptsDir() {
  if (fs.existsSync(path.join(SCRIPTS_DIR, 'apply-preset.jsx'))) return SCRIPTS_DIR;
  if (fs.existsSync(path.join(DEV_SCRIPTS_DIR, 'apply-preset.jsx'))) return DEV_SCRIPTS_DIR;
  return DEV_SCRIPTS_DIR;
}

function jsxPath() { return path.join(resolveScriptsDir(), 'apply-preset.jsx'); }
function ps1Path() { return path.join(resolveScriptsDir(), 'run-batch.ps1'); }

// ---------------------------------------------------------------------------
// Small pure helpers (unit-tested by scripts/self-test.js)
// ---------------------------------------------------------------------------

// {preset}_{filename}_{seq}  ->  wedding-classic_DSC0123_001.jpg
function buildOutputName(pattern, presetName, fileName, seq) {
  const base = path.basename(fileName, path.extname(fileName));
  const safe = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return (pattern || '{preset}_{filename}_{seq}')
    .replace(/\{preset\}/gi, safe(presetName || 'preset'))
    .replace(/\{filename\}/gi, safe(base))
    .replace(/\{seq\}/gi, String(seq).padStart(3, '0')) + '.jpg';
}

// Read the headline Camera Raw settings out of an .xmp preset so the UI
// can show the user what the preset actually does. Best-effort only.
function parseXmpSettings(xmpText) {
  const out = {};
  const keys = ['Exposure2012', 'Contrast2012', 'Highlights2012', 'Shadows2012',
    'Whites2012', 'Blacks2012', 'Clarity2012', 'Vibrance', 'Saturation',
    'Temperature', 'Tint', 'Sharpness', 'LuminanceSmoothing', 'ColorNoiseReduction'];
  for (const k of keys) {
    const m = xmpText.match(new RegExp('crs:' + k + '="(-?[0-9.]+)"'));
    if (m) out[k] = parseFloat(m[1]);
  }
  const profile = xmpText.match(/crs:CameraProfile="([^"]+)"/);
  if (profile) out.CameraProfile = profile[1];
  return out;
}

// ---------------------------------------------------------------------------
// Photoshop version — har version (20.x CC 2019 se 26.x 2025 tak).
// COM se $ps.Version aisi string hoti hai: "20.0", "24.7", "25.3", "26.0".
// Mapping: ACR = major - 9 (20 -> ACR 11, 24 -> ACR 15, 26 -> ACR 17).
// Pure functions — self-test me test hote hain, Photoshop ki zaroorat nahi.
// ---------------------------------------------------------------------------

function photoshopMajorToAcr(major) {
  return major - 9;
}
function acrToPhotoshopMajor(acr) {
  return acr + 9;
}
function photoshopYearLabel(major) {
  const known = config.photoshopVersions && config.photoshopVersions[major];
  if (known) return known.label;
  if (major < 20) return 'CC 2018 ya purana';
  // 26 se naya (27.x = 2026, ...) — mapping se andaza.
  return String(1999 + major);
}
function photoshopYearName(major) {
  const known = config.photoshopVersions && config.photoshopVersions[major];
  if (known) return known.year;
  if (major < 20) return 'CC 2018 ya purana';
  return photoshopYearLabel(major);
}

// "24.7" / "20.0" / " 25.3.1 " -> { ok, version, major, minor,
// year, yearLabel, acr, label } — label maslan "2023 (24.7)".
// Ghalat / khaali string -> { ok: false, version: <as given> }.
function parsePhotoshopVersion(versionString) {
  const version = String(versionString || '').trim();
  const m = version.match(/^(\d+)(?:\.(\d+))?/);
  if (!m) return { ok: false, version, major: null, minor: null, year: null, yearLabel: null, acr: null, label: version };
  const major = parseInt(m[1], 10);
  const minor = m[2] !== undefined ? parseInt(m[2], 10) : null;
  const yearLabel = photoshopYearLabel(major);
  return {
    ok: true,
    version,
    major,
    minor,
    year: photoshopYearName(major),
    yearLabel,
    acr: photoshopMajorToAcr(major),
    // UI me dikhane ke liye: "2023 (24.7)".
    label: yearLabel + ' (' + version + ')',
  };
}

// ---------------------------------------------------------------------------
// Preset compatibility — preset ko naya Camera Raw chahiye ya nahi?
// Best-effort detection: XMP text me naye ACR features ke nishan dhoondo.
// Jo mile, us ko list karo aur us se kam az kam ACR / Photoshop nikalo.
// Koi feature na mile to minAcr = crs:Version se (agar likha ho), warna 11
// (sab se purana supported ACR — standard settings har version par chalti hain).
// ---------------------------------------------------------------------------

// Har entry: naye feature ka nishan -> us ke liye kam az kam ACR.
const NEW_ACR_FEATURES = [
  { pattern: /LensBlur/i, label: 'Lens Blur', minAcr: 16 },
  { pattern: /MaskGroup|MaskGroupBasedCorrections|HasMask\s*=\s*"True"|crs:Mask/i, label: 'AI masking / mask corrections', minAcr: 15 },
  { pattern: /Adaptive/i, label: 'Adaptive profile', minAcr: 15 },
  { pattern: /PointColor/i, label: 'Point Color', minAcr: 15 },
  { pattern: /EnhanceDetails|Denoise/i, label: 'Enhance / Denoise', minAcr: 15 },
  { pattern: /crs:Version\s*=\s*"(1[2-9]|2\d)/, label: 'Naya Camera Raw preset (Version)', minAcr: null }, // minAcr Version se niklega
];

function detectPresetRequirements(xmpText) {
  const text = String(xmpText || '');
  const features = [];
  let minAcr = 11; // standard settings — sab se purana supported ACR
  // 1. crs:Version="15.2" jaisa likha ho to wahi kam az kam ACR hai.
  const ver = text.match(/crs:Version\s*=\s*"(\d+)(?:\.\d+)?"/);
  if (ver) minAcr = Math.max(minAcr, parseInt(ver[1], 10));
  // 2. Naye features ke nishan.
  for (const f of NEW_ACR_FEATURES) {
    if (!f.pattern.test(text)) continue;
    if (f.minAcr === null) continue; // Version wala — upar se aa gaya
    if (!features.some((x) => x.label === f.label)) features.push({ label: f.label, minAcr: f.minAcr });
    if (f.minAcr > minAcr) minAcr = f.minAcr;
  }
  return { features, minAcr, minPhotoshopMajor: acrToPhotoshopMajor(minAcr) };
}

// Photoshop info (parsePhotoshopVersion / checkPhotoshop ka result) aur
// preset ke XMP text se faisla: compatible hai ya warning deni hai?
// Warning Roman Urdu me hoti hai, batch ko BLOCK nahi karti — user khud
// faisla karta hai (Test one photo se check karke).
// Returns { compatible, needsNewer, warning, requiredAcr, requiredPhotoshop,
//   requiredYear, features, installedAcr, installedYear }.
function checkPresetCompatibility(xmpText, photoshopInfo) {
  const req = detectPresetRequirements(xmpText);
  const base = {
    compatible: true, needsNewer: false, warning: null,
    requiredAcr: req.minAcr, requiredPhotoshop: req.minPhotoshopMajor,
    requiredYear: photoshopYearLabel(req.minPhotoshopMajor),
    features: req.features, installedAcr: null, installedYear: null,
  };
  if (!photoshopInfo || !photoshopInfo.ok || photoshopInfo.major == null) {
    // Photoshop ka version pata nahi — warning nahi, block bhi nahi.
    return base;
  }
  const installedAcr = photoshopMajorToAcr(photoshopInfo.major);
  base.installedAcr = installedAcr;
  base.installedYear = photoshopInfo.yearLabel;
  if (photoshopInfo.major < config.minSupportedMajor) {
    base.compatible = false;
    base.needsNewer = true;
    base.warning = 'Tumhara Photoshop bohat purana hai (' + photoshopInfo.label + ') — ye tool CC 2019 (20.x) se 2025 (26.x) tak ke liye hai. Is version par Camera Raw Filter wala fallback shayad na chale. Pehle Test one photo se check kar lo.';
    return base;
  }
  if (photoshopInfo.major > config.maxTestedMajor) {
    // Naya version (27.x+) — standard settings chalni chahiye, test nahi hua.
    base.warning = 'Tumhara Photoshop naya hai (' + photoshopInfo.label + ') — is version par tool ka test nahi hua, lekin aam settings chalni chahiye. Pehle Test one photo se check kar lo.';
    return base;
  }
  if (req.minAcr > installedAcr) {
    base.compatible = false;
    base.needsNewer = true;
    const what = req.features.length
      ? req.features.map((f) => f.label).join(', ')
      : 'nayi Camera Raw setting';
    base.warning = 'Ye preset "' + what + '" istemal karta hai — is ke liye Camera Raw ' + req.minAcr + ' / Photoshop ' + base.requiredYear + ' (' + req.minPhotoshopMajor + '.x) chahiye, tumhare paas Photoshop ' + photoshopInfo.yearLabel + ' (' + photoshopInfo.version + ', Camera Raw ' + installedAcr + ') hai. Aam rang / roshni wali setting lag jayegi, sirf nayi wali poori nahi lagegi. Test one photo se pehle check kar lo — batch ruke ga nahi, tum khud faisla karo.';
    return base;
  }
  return base;
}

// files: array of paths OR [{src, presetPath}] for per-photo presets
// (Auto Pick / manual override). presetPath = fallback for all files.
function buildBatchArgs({ presetPath, files, outputDir, quality, resize, resizeWidth, namingPattern, presetName, workDir }) {
  return {
    presetPath,
    presetName,
    files: files.map((f, i) => {
      if (typeof f === 'string') return { src: f, index: i, presetPath: presetPath || null, presetName: presetName || null };
      return { src: f.src, index: i, presetPath: f.presetPath || presetPath || null, presetName: f.presetName || presetName || null };
    }),
    outputDir,
    quality: Math.max(1, Math.min(100, quality || 85)),
    resize: !!resize,
    resizeWidth: resizeWidth || 2048,
    namingPattern: namingPattern || '{preset}_{filename}_{seq}',
    workDir,
    progressFile: path.join(workDir, 'progress.json'),
    cancelFile: path.join(workDir, 'cancel.flag'),
  };
}

// ---------------------------------------------------------------------------
// Photoshop dhoondna — COM fail ho to registry / Adobe folder scan /
// aam install paths fallback. Pure helpers — self-test me test hote hain,
// Photoshop ki zaroorat nahi.
// ---------------------------------------------------------------------------

// Adobe install roots — DONO scan hote hain (64-bit + 32-bit).
const ADOBE_INSTALL_DIRS = [
  'C:\\Program Files\\Adobe',
  'C:\\Program Files (x86)\\Adobe',
];

// Registry keys jin me Photoshop ki ApplicationPath hoti hai —
// HKLM + HKCU, 64-bit + WOW6432Node (32-bit Photoshop / 32-bit view).
const PHOTOSHOP_REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\Adobe\\Photoshop',
  'HKCU\\SOFTWARE\\Adobe\\Photoshop',
  'HKLM\\SOFTWARE\\WOW6432Node\\Adobe\\Photoshop',
  'HKCU\\SOFTWARE\\WOW6432Node\\Adobe\\Photoshop',
];
// Windows ka App Paths key — is ka default value seedha exe path hota hai.
const PHOTOSHOP_APP_PATHS_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Photoshop.exe';

// Aam install locations — COM na chale to inhen check karo.
const PHOTOSHOP_KNOWN_PATHS = [
  { exe: 'C:\\Program Files\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe', major: 26 },
  { exe: 'C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\Photoshop.exe', major: 25 },
  { exe: 'C:\\Program Files\\Adobe\\Adobe Photoshop 2023\\Photoshop.exe', major: 24 },
  { exe: 'C:\\Program Files\\Adobe\\Adobe Photoshop 2022\\Photoshop.exe', major: 23 },
  { exe: 'C:\\Program Files\\Adobe\\Adobe Photoshop 2021\\Photoshop.exe', major: 22 },
  { exe: 'C:\\Program Files\\Adobe\\Adobe Photoshop 2020\\Photoshop.exe', major: 21 },
  { exe: 'C:\\Program Files\\Adobe\\Adobe Photoshop 2019\\Photoshop.exe', major: 20 },
  { exe: 'C:\\Program Files\\Adobe\\Adobe Photoshop CC 2019\\Photoshop.exe', major: 20 },
];

// Adobe dir ki entries (folder names) me se Photoshop wale folders
// chuno — "Adobe Photoshop CC 2019", "Adobe Photoshop 2024", ...
// Bridge / Acrobat / CameraRaw jaise ghair-Photoshop folders chhodo.
// Returns [{ folder, exe }].
function scanAdobeDirEntries(adobeDir, entries) {
  const out = [];
  for (const name of entries || []) {
    const folder = String(name || '').trim();
    if (!/^Adobe Photoshop/i.test(folder)) continue;
    out.push({ folder, exe: path.join(adobeDir, folder, 'Photoshop.exe') });
  }
  return out;
}

// reg query "App Paths\Photoshop.exe" ki output se exe path nikalo.
// Line hoti hai: "    (Default)    REG_SZ    C:\...\Photoshop.exe"
function parseAppPathsOutput(output) {
  for (const line of String(output || '').split(/\r?\n/)) {
    const m = line.match(/REG_SZ\s+(.+Photoshop\.exe)\s*$/i);
    if (m) return m[1].trim();
  }
  return null;
}

// (Get-Item exe).VersionInfo.FileVersion ki output — "20.0" jaisi
// poori version ya "24.7.1.0" jaisi — se version nikalo.
function parseExeFileVersion(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return { ok: false, version: s, major: null, minor: null, year: null, yearLabel: null, acr: null, label: s };
  return parsePhotoshopVersion(m[1] + '.' + m[2] + '.' + m[3]);
}

// Exe path se Photoshop major nikalo — "Adobe Photoshop 2023" -> 24,
// "Adobe Photoshop CC 2019" -> 20. Saal na mile to null.
function photoshopExePathToVersion(exePath) {
  const p = String(exePath || '');
  const m = p.match(/Adobe Photoshop (?:CC )?(\d{4})/i);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  if (year < 2019 || year > 2035) return null;
  const major = year - 1999;
  return { major, version: String(major) + '.0' };
}

// Registry output (ApplicationPath values, aik line me aik path) se
// candidate paths nikalo. Khali lines aur ghair-Photoshop lines chhodo.
function parsePhotoshopRegistryOutput(output) {
  const out = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/photoshop/i.test(t)) out.push(t);
  }
  return out;
}

// Candidate (exe path ya folder) se asal exe path banao.
function candidateToExe(candidate) {
  const c = String(candidate || '').trim().replace(/^"+|"+$/g, '');
  if (!c) return null;
  if (/\.exe$/i.test(c)) return c;
  return path.join(c, 'Photoshop.exe');
}

// Har run ke liye JSX ki TEMP copy ka path — install folder (Program
// Files) standard user ke liye read-only hai, is liye wahan rewrite
// karne par UnauthorizedAccessException aata tha. Copy workDir (temp)
// me hoti hai, wahan likhna hamesha allowed hai.
function buildRunJsxPath(workDir) { return path.join(workDir, 'apply-preset.jsx'); }

// Pehli kamyab check ka result — dobara COM chalane ke bajaye yehi
// istemal hota hai (maslan preset compatibility check me).
let cachedCheck = null;
function getCachedPhotoshop() { return cachedCheck; }

// ---------------------------------------------------------------------------
// Manual Photoshop.exe rasta (escape hatch) — user khud path de.
// Agar auto-detect kisi bhi wajah se na kare to user "Photoshop.exe
// chuno" button se exe chunta hai; path settings me save hota hai aur
// agli dafa check sab se pehle wahi istemal karta hai.
// ---------------------------------------------------------------------------
let manualPhotoshopPath = null;
function setManualPhotoshopPath(exePath) {
  manualPhotoshopPath = (typeof exePath === 'string' && exePath.trim()) ? exePath.trim() : null;
  cachedCheck = null; // manual path badla — dobara check hoga.
}
function getManualPhotoshopPath() { return manualPhotoshopPath; }

// Pure sync validation: naam Photoshop.exe ho aur file maujood ho.
function validateManualExe(exePath) {
  const p = String(exePath || '').trim();
  if (!p) return { valid: false, error: 'Koi path nahi diya gaya.' };
  if (path.basename(p).toLowerCase() !== 'photoshop.exe') {
    return { valid: false, error: 'File ka naam Photoshop.exe hona chahiye — tum ne chuna: ' + path.basename(p) };
  }
  try {
    if (!fs.existsSync(p)) return { valid: false, error: 'File nahi mili: ' + p };
  } catch (e) { return { valid: false, error: 'Path check nahi ho saka: ' + e.message }; }
  return { valid: true, exe: p };
}

// Exe ki exact FileVersion (PowerShell) — na mile to null (caller
// folder name se andaza lagata hai). Windows ke bahar hamesha null.
function getExeFileVersion(exe) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(null); return; }
    const esc = String(exe).replace(/'/g, "''");
    execFile('powershell', ['-NoProfile', '-Command', "(Get-Item '" + esc + "').VersionInfo.FileVersion"],
      { timeout: 30000 }, (err, out) => {
        if (err) { resolve(null); return; }
        const pv = parseExeFileVersion(out);
        resolve(pv.ok ? pv : null);
      });
  });
}

// Manual exe se check result banao — FileVersion se exact version,
// na mile to folder name se.
function checkManualPhotoshop(exePath) {
  return getExeFileVersion(exePath).then((pv) => {
    let parsed = pv;
    if (!parsed) {
      const v = photoshopExePathToVersion(exePath);
      parsed = v ? parsePhotoshopVersion(v.version)
        : { ok: false, version: null, major: null, minor: null, year: null, yearLabel: null, acr: null, label: null };
    }
    return {
      ok: true, method: 'manual', exe: exePath, source: 'manual (user ne chuna)',
      exactVersion: pv ? pv.version : null,
      detail: 'Photoshop ' + (parsed.label || '') + ' mila (manual): ' + exePath,
      ...parsed,
    };
  });
}

// ---------------------------------------------------------------------------
// Photoshop availability check. Resolves true/false, never throws, aur
// KABHI hang nahi hota — 90 second ka watchdog hai: COM ya registry
// jawab na de to bhi promise resolve hota hai (not-found + diagnostics).
// Wajah: COM activate karte waqt Photoshop launch hota hai aur wo
// PowerShell ke stdio pipe handles inherit kar leta hai — Node ka
// execFile callback pipe band hone ka wait kar sakta hai, is liye sirf
// execFile timeout par bharosa kaafi nahi.
// Photoshop ko KABHI band nahi karta — na check ke doran, na baad me.
// force=true sirf "Dobara check karo" button se aata hai.
// Tartib: 0. manual path (agar user ne chuna ho)  1. COM
//          2. disk scan + registry fallback.
// ---------------------------------------------------------------------------
const CHECK_TIMEOUT_MS = 90000;
function checkPhotoshop(force) {
  return new Promise((resolve) => {
    if (cachedCheck && !force) { resolve(cachedCheck); return; }
    if (process.platform !== 'win32') {
      cachedCheck = { ok: false, reason: 'not-windows', version: null, major: null, detail: 'Photoshop automation needs Windows (COM).' };
      resolve(cachedCheck);
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return; // watchdog ya pehli settlement ke baad late result ignore
      settled = true;
      clearTimeout(timer);
      cachedCheck = result;
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        ok: false, reason: 'check-timeout', version: null, major: null,
        diagnostics: 'check 90 second me poora nahi hua (COM ya registry hang) — timeout par roka gaya.',
        detail: 'Photoshop check timeout (90s) — COM ya registry jawab nahi de raha. "Photoshop.exe chuno" se khud path de do, ya "Dobara check karo" dabao.',
      });
    }, CHECK_TIMEOUT_MS);
    if (timer.unref) timer.unref();

    // 0. Manual path — user ne khud chuna ho to sab se pehle wahi.
    if (manualPhotoshopPath) {
      const v = validateManualExe(manualPhotoshopPath);
      if (v.valid) { checkManualPhotoshop(v.exe).then(finish); return; }
      var manualNote = 'Manual path nahi mila (' + v.error + ') — auto-detect chala raha hoon. ';
    }

    // 1. COM — sirf Version parho, COM object release kar do, band mat karo.
    execFile('powershell', ['-NoProfile', '-Command',
      "try { $ps = New-Object -ComObject Photoshop.Application; $v = $ps.Version; " +
      "[System.Runtime.InteropServices.Marshal]::ReleaseComObject($ps) | Out-Null; " +
      "Write-Output ('OK ' + $v) } catch { Write-Output ('FAIL ' + $_.Exception.Message); exit 1 }"],
    { timeout: 60000 }, (err, stdout) => {
      if (settled) return;
      const out = (stdout || '').trim();
      if (!err && out.startsWith('OK')) {
        // "OK 24.7" -> version string "24.7" parse karo.
        const parsed = parsePhotoshopVersion(out.slice(2).trim());
        finish({ ok: true, method: 'com', detail: out, ...parsed });
        return;
      }
      const comDetail = (manualNote || '') + (out || (err && err.message) || 'Photoshop COM object could not be created.');
      // 2. Fallback — disk scan + registry. COM fail bhi sakta hai
      //    jabke Photoshop installed ho (maslan COM register nahi hua).
      findPhotoshopOnDisk(comDetail).then(finish);
    });
  });
}

// Disk par Photoshop dhoondo — is tartib me:
//   1. Disk scan (SYNC, PowerShell ka wait nahi) — Adobe folders scan
//      (Program Files + x86, har "Adobe Photoshop*") + aam install paths.
//      Aam case yahin mil jata hai, registry ka wait nahi karna parta.
//   2. Registry — sirf tab jab disk scan se na mile: 4 Photoshop keys
//      ki ApplicationPath + App Paths.
// Mil jaye to ok:true + exe path + exact version (exe FileVersion se,
// na mile to folder name se) + diagnostic detail. Na mile to ok:false
// + diagnostic detail (kya kya check kiya gaya).
function findPhotoshopOnDisk(comDetail) {
  return new Promise((resolve) => {
    const diagnostics = [];
    const candidates = []; // { exe, source }
    const addCandidate = (raw, source) => {
      const exe = candidateToExe(raw);
      if (!exe) return;
      if (candidates.some((c) => c.exe.toLowerCase() === exe.toLowerCase())) return;
      candidates.push({ exe, source });
    };
    const existsOnDisk = (c) => { try { return fs.existsSync(c.exe); } catch (_) { return false; } };

    // Milne wale exe ki exact version nikal kar resolve karo.
    const resolveFound = (found) => {
      getExeFileVersion(found.exe).then((pv) => {
        let parsed = pv;
        let exactVersion = pv ? pv.version : null;
        if (!parsed) {
          // FileVersion na mile to folder name se andaza.
          const v = photoshopExePathToVersion(found.exe);
          parsed = v ? parsePhotoshopVersion(v.version)
            : { ok: false, version: null, major: null, minor: null, year: null, yearLabel: null, acr: null, label: null };
        }
        resolve({
          ok: true, method: 'fallback', exe: found.exe, source: found.source,
          exactVersion, diagnostics: diagnostics.join(' · '),
          detail: 'Photoshop ' + (parsed.label || '') + ' mila: ' + found.exe + ' (' + found.source + ') — COM se nahi mila (' + comDetail + ')',
          ...parsed,
        });
      });
    };

    // 1. Disk scan (sync) — Adobe folders + aam install paths.
    let scanned = 0, matched = 0;
    for (const dir of ADOBE_INSTALL_DIRS) {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory()).map((e) => e.name);
        scanned++;
      } catch (_) { /* folder maujood nahi — aage */ }
      const found = scanAdobeDirEntries(dir, entries);
      matched += found.length;
      for (const f of found) addCandidate(f.exe, 'Adobe folder scan (' + f.folder + ')');
    }
    for (const k of PHOTOSHOP_KNOWN_PATHS) addCandidate(k.exe, 'known path');
    diagnostics.push('Adobe folders: ' + scanned + ' dir scan, ' + matched + ' Photoshop folder mile');
    diagnostics.push('candidates kul (disk): ' + candidates.length);
    const foundSync = candidates.find(existsOnDisk);
    if (foundSync) { resolveFound(foundSync); return; }

    // 2. Registry — aik hi PowerShell call: 4 keys + App Paths.
    const psReg = [
      "$keys = @('HKLM:\\SOFTWARE\\Adobe\\Photoshop','HKCU:\\SOFTWARE\\Adobe\\Photoshop','HKLM:\\SOFTWARE\\WOW6432Node\\Adobe\\Photoshop','HKCU:\\SOFTWARE\\WOW6432Node\\Adobe\\Photoshop');",
      "foreach ($k in $keys) { Get-ChildItem $k -ErrorAction SilentlyContinue | ForEach-Object { $p = $_.GetValue('ApplicationPath'); if ($p) { Write-Output ('REG|' + $p) } } }",
      "$ap = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Photoshop.exe' -ErrorAction SilentlyContinue).'(default)'; if ($ap) { Write-Output ('APPPATH|' + $ap) }",
    ].join(' ');
    execFile('powershell', ['-NoProfile', '-Command', psReg], { timeout: 30000 }, (regErr, regOut) => {
      let regCount = 0;
      if (!regErr) {
        for (const line of String(regOut || '').split(/\r?\n/)) {
          const t = line.trim();
          if (t.startsWith('REG|')) { addCandidate(t.slice(4), 'registry'); regCount++; }
          else if (t.startsWith('APPPATH|')) { addCandidate(t.slice(8), 'App Paths'); regCount++; }
        }
      }
      diagnostics.push('registry: ' + regCount + ' candidate' + (regCount === 1 ? '' : 's'));
      diagnostics.push('candidates kul: ' + candidates.length);
      const found = candidates.find(existsOnDisk);
      if (!found) {
        resolve({
          ok: false, reason: 'photoshop-not-found', version: null, major: null,
          diagnostics: diagnostics.join(' · '),
          detail: comDetail + ' | ' + diagnostics.join(' · ') + ' — kahin Photoshop.exe nahi mila. Photoshop CC 2019 (20.x) ya us se naya install karo.',
        });
        return;
      }
      resolveFound(found);
    });
  });
}

// Install an .xmp preset into Camera Raw's Settings folder so it also
// appears inside Photoshop's own Presets panel.
// %AppData%\Adobe\CameraRaw\Settings\<file>.xmp
function installPresetToCameraRaw(presetPath) {
  const destDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Adobe', 'CameraRaw', 'Settings');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(presetPath));
  fs.copyFileSync(presetPath, dest);
  return dest;
}

// ---------------------------------------------------------------------------
// Batch runner. onProgress(state) is called with the parsed progress.json:
//   { total, done, current, ok, failed, errors: [{file, error}], fatal }
// Returns a promise resolving to the final progress state.
// run-batch.ps1 ke andar fallback chain hai (COM -> Photoshop.exe launch
// + COM retry -> JSX seedha Photoshop.exe ko argument de kar) — user ke
// PC par COM kharab hai (is liye v1.2.0/v1.2.1/v1.2.2 me batch 0% par
// WriteErrorException se marta tha), is liye runner ko detected exe ka
// path diya jata hai. Fatal error progress.json ke `fatal` field me bhi
// aati hai taake UI 0% par atka na rahe, asal wajah dikhaye.
// ---------------------------------------------------------------------------

// Batch ke liye Photoshop.exe ka path — tartib: cached check ka exe,
// phir manual path, phir null (ps1 khud App Paths/known paths dhoondega).
// Pure function — self-test me test hoti hai.
function resolveBatchExePath(cached, manual) {
  if (cached && cached.exe) return cached.exe;
  if (typeof manual === 'string' && manual.trim()) return manual.trim();
  return null;
}

// Batch fail ki wajah Roman Urdu me — tartib: progress.json ka `fatal`,
// phir pehli error, phir PowerShell stderr ki aakhri saaf lines, phir
// exit code. WriteErrorException jaisi tail lines saaf kar di jati hain
// (asal message wali line un ke upar hoti hai, user ko tail nahi dikhani).
// Pure function — self-test me test hoti hai.
function batchFatalMessage({ code, stderr, progress }) {
  if (progress && progress.fatal) return String(progress.fatal);
  if (progress && progress.errors && progress.errors.length) {
    const first = progress.errors.find((e) => e && e.error) || progress.errors[0];
    if (first && first.error) return String(first.error);
  }
  const raw = String(stderr || '');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l
    && !/CategoryInfo/i.test(l) && !/FullyQualifiedErrorId/i.test(l)
    && !/WriteErrorException/i.test(l) && !/^\s*\+/.test(l));
  if (lines.length) return lines.slice(-2).join(' — ');
  if (code !== undefined && code !== null) {
    return 'Photoshop batch fail ho gaya (exit ' + code + ') — Photoshop COM se nahi khula. "Photoshop.exe chuno" se khud path do ya "Detail copy karo" se detail bhejo.';
  }
  return 'Photoshop batch fail ho gaya — wajah maloom nahi. "Detail copy karo" se detail bhejo.';
}

function runBatch(args, onProgress) {
  return new Promise((resolve, reject) => {
    const workDir = args.workDir;
    fs.mkdirSync(workDir, { recursive: true });
    const argsFile = path.join(workDir, 'batch-args.json');
    fs.writeFileSync(argsFile, JSON.stringify(args, null, 2), 'utf8');
    // Fresh progress file so the poller never reads a stale one.
    fs.writeFileSync(args.progressFile, JSON.stringify({ total: args.files.length, done: 0, ok: 0, failed: 0, current: '', errors: [] }), 'utf8');
    if (fs.existsSync(args.cancelFile)) fs.unlinkSync(args.cancelFile);

    // JSX ki TEMP copy — install folder (Program Files) read-only hai,
    // is liye asal apply-preset.jsx ko rewrite karne par
    // UnauthorizedAccessException aata tha. run-batch.ps1 ko COPY ka
    // path do; wo ARGS_PATH line usi copy me rewrite karta hai.
    const runJsx = buildRunJsxPath(workDir);
    try { fs.copyFileSync(jsxPath(), runJsx); }
    catch (err) { reject(new Error('Could not copy apply-preset.jsx to temp folder: ' + err.message)); return; }

    // Detected Photoshop.exe ka path runner ko do — COM fail ho to wo
    // exe se Photoshop khole ya script seedha exe se chalaye.
    const batchExe = resolveBatchExePath(cachedCheck, manualPhotoshopPath);
    const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', ps1Path(), '-Jsx', runJsx, '-Args', argsFile];
    if (batchExe) psArgs.push('-PhotoshopExe', batchExe);
    const ps = spawn('powershell', psArgs, { windowsHide: true });

    let stderr = '';
    ps.stderr.on('data', (d) => { stderr += d.toString(); });
    ps.on('error', (err) => reject(new Error('Could not start PowerShell: ' + err.message)));

    const poll = setInterval(() => {
      try {
        const raw = fs.readFileSync(args.progressFile, 'utf8');
        const state = JSON.parse(raw);
        if (onProgress) onProgress(state);
      } catch (_) { /* progress file mid-write; try next tick */ }
    }, 500);

    ps.on('close', (code) => {
      clearInterval(poll);
      let final = { total: args.files.length, done: 0, ok: 0, failed: 0, current: '', errors: [] };
      try { final = JSON.parse(fs.readFileSync(args.progressFile, 'utf8')); } catch (_) {}
      if (onProgress) onProgress(final);
      if (code === 0 && final.done >= final.total) resolve(final);
      else reject(new Error(batchFatalMessage({ code, stderr, progress: final })));
    });
  });
}

function cancelBatch(workDir) {
  try { fs.writeFileSync(path.join(workDir, 'cancel.flag'), 'cancel', 'utf8'); } catch (_) {}
}

module.exports = {
  buildOutputName, parseXmpSettings, buildBatchArgs,
  parsePhotoshopVersion, photoshopYearLabel, photoshopYearName,
  photoshopMajorToAcr, acrToPhotoshopMajor,
  photoshopExePathToVersion, parsePhotoshopRegistryOutput, candidateToExe,
  scanAdobeDirEntries, parseAppPathsOutput, parseExeFileVersion,
  ADOBE_INSTALL_DIRS, PHOTOSHOP_REGISTRY_KEYS, PHOTOSHOP_APP_PATHS_KEY,
  setManualPhotoshopPath, getManualPhotoshopPath, validateManualExe,
  checkManualPhotoshop, getExeFileVersion, findPhotoshopOnDisk,
  CHECK_TIMEOUT_MS,
  buildRunJsxPath, getCachedPhotoshop, PHOTOSHOP_KNOWN_PATHS,
  resolveBatchExePath, batchFatalMessage,
  detectPresetRequirements, checkPresetCompatibility,
  checkPhotoshop, installPresetToCameraRaw, runBatch, cancelBatch,
  jsxPath, ps1Path, config,
};
