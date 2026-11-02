// Self-test — runs on any OS, no Photoshop needed.
// Tests the pure logic in photoshop.js: naming, XMP parsing, args build.
// Run:  npm test        (from the app/ folder)
//       node scripts/self-test.js
'use strict';
const assert = require('assert');
const path = require('path');
const ps = require(path.join(__dirname, '..', 'app', 'src', 'main', 'photoshop.js'));

// 1. Output naming
assert.strictEqual(
  ps.buildOutputName('{preset}_{filename}_{seq}', 'Wedding Classic', 'DSC0123.jpg', 1),
  'Wedding-Classic_DSC0123_001.jpg');
assert.strictEqual(
  ps.buildOutputName('{filename}_{seq}', 'Anything', 'my photo (1).JPG', 42),
  'my-photo-1_042.jpg');
console.log('PASS: buildOutputName');

// 2. XMP settings parsing (sample Camera Raw preset packet)
const sampleXmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6">' +
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" ' +
  'crs:Version="11.2" crs:Exposure2012="0.35" crs:Contrast2012="12" crs:Temperature="5600" ' +
  'crs:Tint="+8" crs:Vibrance="25" crs:CameraProfile="Adobe Color" />' +
  '</rdf:RDF></x:xmpmeta>';
const s = ps.parseXmpSettings(sampleXmp);
assert.strictEqual(s.Exposure2012, 0.35);
assert.strictEqual(s.Contrast2012, 12);
assert.strictEqual(s.Temperature, 5600);
assert.strictEqual(s.Vibrance, 25);
assert.strictEqual(s.CameraProfile, 'Adobe Color');
console.log('PASS: parseXmpSettings ->', JSON.stringify(s));

// 3. Batch args build
const args = ps.buildBatchArgs({
  presetPath: 'C:\\Presets\\Wedding Classic.xmp', presetName: 'Wedding Classic',
  files: ['C:\\Photos\\a.jpg', 'C:\\Photos\\b.jpg'],
  outputDir: 'C:\\Exports', quality: 85, resize: true, resizeWidth: 2048,
  namingPattern: '{preset}_{filename}_{seq}', workDir: 'C:\\Temp\\zubii',
});
assert.strictEqual(args.files.length, 2);
assert.strictEqual(args.quality, 85);
assert.strictEqual(args.resizeWidth, 2048);
assert.strictEqual(args.progressFile, path.join('C:\\Temp\\zubii', 'progress.json'));
console.log('PASS: buildBatchArgs');

// 4. JSX template sanity — placeholders and key calls present.
const fs = require('fs');
const jsx = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'apply-preset.jsx'), 'utf8');
for (const needle of ['CameraRawOpenOptions', 'CameraRawSettingsType.CUSTOM',
  'Adobe Camera Raw Filter', 'JPEGSaveOptions', 'DONOTSAVE', 'cancelFile']) {
  assert.ok(jsx.includes(needle), 'JSX missing: ' + needle);
}
console.log('PASS: apply-preset.jsx contains all required calls');

// 5. PowerShell runner sanity.
const ps1 = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-batch.ps1'), 'utf8');
assert.ok(ps1.includes('Photoshop.Application'));
assert.ok(ps1.includes('DoJavaScriptFile'));
console.log('PASS: run-batch.ps1 COM runner');

// 7. AUTO PICK — synthetic pixels, no Electron/Photoshop needed.
//    Dark warm photo + brightening warm preset should outscore a
//    darkening cool preset; bright photo should reject brightening.
const ap = require(path.join(__dirname, '..', 'app', 'src', 'main', 'auto-pick.js'));
function synthPixels(r, g, b, n) {
  const buf = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) { buf[i * 4] = b; buf[i * 4 + 1] = g; buf[i * 4 + 2] = r; buf[i * 4 + 3] = 255; }
  return buf;
}
const darkWarmStats = ap.computeStatsFromPixels(synthPixels(70, 55, 45, 64), 8, 8);
assert.ok(darkWarmStats.meanLum < 95, 'dark photo should be dark, got ' + darkWarmStats.meanLum);
assert.ok(darkWarmStats.warmCool > 15, 'dark photo should read warm, got ' + darkWarmStats.warmCool);
const brightStats = ap.computeStatsFromPixels(synthPixels(230, 225, 220, 64), 8, 8);
assert.ok(brightStats.meanLum > 175, 'bright photo should be bright');
const warmBrightXmp = '<rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Exposure2012="0.6" crs:Temperature="7000" crs:Tint="10" crs:Shadows2012="30" crs:Vibrance="20" />';
const coolDarkXmp = '<rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:Exposure2012="-0.5" crs:Temperature="5000" crs:Tint="-10" />';
const presetsForTest = [
  { name: 'Warm Bright', path: 'C:\\P\\warm.xmp', xmpText: warmBrightXmp },
  { name: 'Cool Dark', path: 'C:\\P\\cool.xmp', xmpText: coolDarkXmp },
];
const rankedDark = ap.rankPresetsForPhoto(darkWarmStats, presetsForTest);
assert.strictEqual(rankedDark[0].name, 'Warm Bright', 'dark warm photo should pick Warm Bright, got ' + rankedDark[0].name);
assert.ok(rankedDark[0].score > rankedDark[1].score, 'scores should differ');
assert.ok(rankedDark[0].reasons.length > 0, 'a reason must be given');
const rankedBright = ap.rankPresetsForPhoto(brightStats, presetsForTest);
assert.strictEqual(rankedBright[0].name, 'Cool Dark', 'bright photo should avoid the brightening preset, got ' + rankedBright[0].name);
console.log('PASS: auto-pick scoring (dark→Warm Bright, bright→Cool Dark, reasons present)');

// 8. Batch args accept per-photo presets (Auto Pick assignments).
const args2 = ps.buildBatchArgs({
  presetPath: 'C:\\P\\fallback.xmp', presetName: 'Fallback',
  files: [{ src: 'C:\\Photos\\a.jpg', presetPath: 'C:\\P\\warm.xmp', presetName: 'Warm Bright' }, 'C:\\Photos\\b.jpg'],
  outputDir: 'C:\\Exports', quality: 85, resize: false, resizeWidth: 2048,
  namingPattern: '{preset}_{filename}_{seq}', workDir: 'C:\\Temp\\zubii',
});
assert.strictEqual(args2.files[0].presetPath, 'C:\\P\\warm.xmp');
assert.strictEqual(args2.files[0].presetName, 'Warm Bright');
assert.strictEqual(args2.files[1].presetPath, 'C:\\P\\fallback.xmp', 'plain path falls back to batch preset');
console.log('PASS: buildBatchArgs per-photo presets');

// 9. JSX uses the per-photo preset + per-photo name.
for (const needle of ['xmpFor(item.presetPath)', 'item.presetName || args.presetName']) {
  assert.ok(jsx.includes(needle), 'JSX missing: ' + needle);
}
console.log('PASS: apply-preset.jsx per-photo preset support');

// 11. Photoshop version parsing — har version (20.x se 26.x).
const v1 = ps.parsePhotoshopVersion('20.0.7');
assert.strictEqual(v1.major, 20);
assert.strictEqual(v1.yearLabel, '2019');
assert.strictEqual(v1.acr, 11);
assert.strictEqual(v1.label, '2019 (20.0.7)');
const v2 = ps.parsePhotoshopVersion('24.7');
assert.strictEqual(v2.major, 24);
assert.strictEqual(v2.yearLabel, '2023');
assert.strictEqual(v2.acr, 15);
assert.strictEqual(v2.label, '2023 (24.7)');
const v3 = ps.parsePhotoshopVersion('25.3');
assert.strictEqual(v3.major, 25);
assert.strictEqual(v3.yearLabel, '2024');
assert.strictEqual(v3.acr, 16);
const v4 = ps.parsePhotoshopVersion('26.0');
assert.strictEqual(v4.major, 26);
assert.strictEqual(v4.yearLabel, '2025');
assert.strictEqual(v4.acr, 17);
assert.strictEqual(ps.parsePhotoshopVersion('').ok, false);
assert.strictEqual(ps.parsePhotoshopVersion('abc').ok, false);
assert.strictEqual(ps.photoshopMajorToAcr(20), 11);
assert.strictEqual(ps.photoshopMajorToAcr(24), 15);
assert.strictEqual(ps.acrToPhotoshopMajor(15), 24);
assert.strictEqual(ps.acrToPhotoshopMajor(11), 20);
console.log('PASS: parsePhotoshopVersion (20.0.7, 24.7, 25.3, 26.0)');

// 12. Compatibility — naya preset + purana Photoshop = warning (Roman Urdu);
//     purana preset + naya Photoshop = no warning; block kabhi nahi.
const newPresetXmp = '<rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" ' +
  'crs:Version="15.0" crs:Exposure2012="0.3"><crs:MaskGroup>AI mask</crs:MaskGroup></rdf:Description>';
const oldPs = ps.parsePhotoshopVersion('20.0.7'); // ACR 11
const newPs = ps.parsePhotoshopVersion('24.7');   // ACR 15
const w1 = ps.checkPresetCompatibility(newPresetXmp, oldPs);
assert.strictEqual(w1.needsNewer, true, 'naya preset + purana Photoshop = warning');
assert.strictEqual(w1.requiredAcr, 15);
assert.ok(w1.warning && w1.warning.length > 10, 'warning Roman Urdu me honi chahiye');
assert.ok(w1.features.length > 0, 'nayi feature list honi chahiye');
const w2 = ps.checkPresetCompatibility(sampleXmp, newPs);
assert.strictEqual(w2.needsNewer, false, 'purana preset + naya Photoshop = no warning');
assert.strictEqual(w2.warning, null);
const w3 = ps.checkPresetCompatibility(newPresetXmp, newPs);
assert.strictEqual(w3.needsNewer, false, 'naya preset naye Photoshop par warning nahi dena chahiye');
const w4 = ps.checkPresetCompatibility(sampleXmp, ps.parsePhotoshopVersion('19.0'));
assert.strictEqual(w4.needsNewer, true, '19.x purana hai — warning honi chahiye');
const reqOld = ps.detectPresetRequirements(sampleXmp);
assert.strictEqual(reqOld.minAcr, 11, 'standard preset ko sirf ACR 11 chahiye');
console.log('PASS: checkPresetCompatibility (new preset + old PS = warning, old preset + new PS = ok)');

// 13. Koi hard 20.0.7 lock baqi nahi — "20.0.7" string source files me
//     nahi honi chahiye (self-test.js khud test data ki wajah se excluded).
const { execSync: execSyncLock } = require('child_process');
const lockHits = execSyncLock('grep -rIn --exclude-dir=node_modules --exclude-dir=dist --exclude=package-lock.json --exclude=self-test.js -F "20.0.7" . || true',
  { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
assert.strictEqual(lockHits, '', 'Hard 20.0.7 lock baqi hai:\n' + lockHits);
console.log('PASS: no hard 20.0.7 lock left in source');

// 14. GitHub Actions workflow maujood hai aur sahi hai.
const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'build-windows.yml'), 'utf8');
for (const needle of ['runs-on: windows-latest', "node-version: '20'", 'npm install', 'npm run dist:win', 'upload-artifact', 'action-gh-release', 'tags:', "'v*'"]) {
  assert.ok(wf.includes(needle), 'workflow missing: ' + needle);
}
assert.ok(!wf.includes('cache:'), 'workflow me npm cache nahi hona chahiye (lockfile issue)');
console.log('PASS: .github/workflows/build-windows.yml (windows-latest, Node 20, dist:win, artifact + Release, no npm cache)');

// 15. Naam Zubii hai (productName, package name, config repo, header).
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'package.json'), 'utf8'));
assert.strictEqual(pkg.productName, 'Zubii Batch Preset Tool');
assert.strictEqual(pkg.name, 'zubii-batch-preset-tool');
assert.strictEqual(pkg.version, '1.2.0');
const cfg = require(path.join(__dirname, '..', 'app', 'src', 'main', 'config.js'));
assert.strictEqual(cfg.appName, 'Zubii Batch Preset Tool');
assert.strictEqual(cfg.githubRepo, 'zubii-batch-preset-tool');
assert.strictEqual(cfg.version, '1.2.0');
const builder = fs.readFileSync(path.join(__dirname, '..', 'app', 'electron-builder.yml'), 'utf8');
assert.ok(builder.includes('productName: Zubii Batch Preset Tool'));
assert.ok(builder.includes('repo: zubii-batch-preset-tool'));
const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'renderer', 'index.html'), 'utf8');
assert.ok(html.includes('<h1>Zubii Batch Preset Tool</h1>'));
console.log('PASS: Zubii naam (package.json, config.js, electron-builder.yml, header)');

// 10. No licence SYSTEM anywhere in this project — i.e. no code that
//    validates/activates/checks a licence key or talks to a licence
//    server. (Plain words like "licence" in docs, or "Photoshop
//    server. (Plain words like "licence" in docs, or "Photoshop
//    installed and licensed", are fine and are not flagged.)
const { execSync } = require('child_process');
const hits = execSync('grep -riIn --exclude-dir=node_modules --exclude-dir=dist --exclude=self-test.js -E "license-client|license-server|license-worker|validateLicense|activateLicense|checkLicense|licenseKey|license_key|licenseServer|licenceServer|licence-client" . || true',
  { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
const bad = hits.split('\n').filter(Boolean);
assert.strictEqual(bad.length, 0, 'Licence-system code found:\n' + bad.join('\n'));
console.log('PASS: no licence system in project (no key validation, no licence server)');

console.log('\nAll self-tests passed.');
