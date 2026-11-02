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
// PHOTOSHOP NA MILNE PAR FALLBACK: COM fail bhi sakta hai jabke Photoshop
// installed ho (maslan COM register nahi hua). Is liye COM fail ho to
// registry (HKLM\SOFTWARE\Adobe\Photoshop ki ApplicationPath) aur aam
// install paths check kiye jate hain — exe mil jaye to Photoshop "mila"
// mana jata hai, version exe ke folder name se nikala jata hai.
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
// Photoshop dhoondna — COM fail ho to registry / install paths fallback.
// Pure helpers — self-test me test hote hain, Photoshop ki zaroorat nahi.
// ---------------------------------------------------------------------------

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
// Photoshop availability check. Resolves true/false, never throws.
// COM pehle; fail ho to registry + aam install paths fallback.
// Photoshop ko KABHI band nahi karta — na check ke doran, na baad me.
// force=true sirf "Dobara check karo" button se aata hai.
// ---------------------------------------------------------------------------
function checkPhotoshop(force) {
  return new Promise((resolve) => {
    if (cachedCheck && !force) { resolve(cachedCheck); return; }
    if (process.platform !== 'win32') {
      cachedCheck = { ok: false, reason: 'not-windows', version: null, major: null, detail: 'Photoshop automation needs Windows (COM).' };
      resolve(cachedCheck);
      return;
    }
    // 1. COM — sirf Version parho, COM object release kar do, band mat karo.
    execFile('powershell', ['-NoProfile', '-Command',
      "try { $ps = New-Object -ComObject Photoshop.Application; $v = $ps.Version; " +
      "[System.Runtime.InteropServices.Marshal]::ReleaseComObject($ps) | Out-Null; " +
      "Write-Output ('OK ' + $v) } catch { Write-Output ('FAIL ' + $_.Exception.Message); exit 1 }"],
    { timeout: 60000 }, (err, stdout) => {
      const out = (stdout || '').trim();
      if (!err && out.startsWith('OK')) {
        // "OK 24.7" -> version string "24.7" parse karo.
        const parsed = parsePhotoshopVersion(out.slice(2).trim());
        cachedCheck = { ok: true, method: 'com', detail: out, ...parsed };
        resolve(cachedCheck);
        return;
      }
      const comDetail = out || (err && err.message) || 'Photoshop COM object could not be created.';
      // 2. Fallback — registry + aam install paths. COM fail bhi sakta hai
      //    jabke Photoshop installed ho (maslan COM register nahi hua).
      findPhotoshopOnDisk(comDetail).then((found) => { cachedCheck = found; resolve(found); });
    });
  });
}

// Disk par Photoshop dhoondo: pehle registry, phir aam install paths.
// Mil jaye to ok:true + exe path + folder name se version; na mile to ok:false.
function findPhotoshopOnDisk(comDetail) {
  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command',
      "Get-ChildItem 'HKLM:\\SOFTWARE\\Adobe\\Photoshop' -ErrorAction SilentlyContinue | ForEach-Object { $p = $_.GetValue('ApplicationPath'); if ($p) { $p } }"],
    { timeout: 30000 }, (regErr, regOut) => {
      const candidates = [];
      if (!regErr) for (const line of parsePhotoshopRegistryOutput(regOut)) candidates.push(line);
      for (const k of PHOTOSHOP_KNOWN_PATHS) candidates.push(k.exe);
      for (const cand of candidates) {
        const exe = candidateToExe(cand);
        if (!exe) continue;
        try {
          if (fs.existsSync(exe)) {
            const v = photoshopExePathToVersion(exe);
            const parsed = v ? parsePhotoshopVersion(v.version)
              : { ok: false, version: null, major: null, minor: null, year: null, yearLabel: null, acr: null, label: null };
            resolve({
              ok: true, method: 'fallback', exe,
              detail: 'Photoshop mila (exe): ' + exe + ' — COM se nahi mila (' + comDetail + ')',
              ...parsed,
            });
            return;
          }
        } catch (_) { /* agla candidate */ }
      }
      resolve({ ok: false, reason: 'photoshop-not-found', version: null, major: null, detail: comDetail + ' Registry aur aam install paths me bhi Photoshop.exe nahi mila. Photoshop CC 2019 (20.x) ya us se naya install karo.' });
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
//   { total, done, current, ok, failed, errors: [{file, error}] }
// Returns a promise resolving to the final progress state.
// ---------------------------------------------------------------------------
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

    const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', ps1Path(), '-Jsx', runJsx, '-Args', argsFile], { windowsHide: true });

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
      if (code === 0 || final.done >= final.total) resolve(final);
      else reject(new Error('Photoshop batch failed (exit ' + code + '). ' + (stderr.trim() || final.errors.map((e) => e.error).join(' | ') || 'See the log.')));
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
  buildRunJsxPath, getCachedPhotoshop, PHOTOSHOP_KNOWN_PATHS,
  detectPresetRequirements, checkPresetCompatibility,
  checkPhotoshop, installPresetToCameraRaw, runBatch, cancelBatch,
  jsxPath, ps1Path, config,
};
