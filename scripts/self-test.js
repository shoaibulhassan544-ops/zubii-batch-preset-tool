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
const lockHits = execSyncLock('grep -rIn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=previews --exclude=package-lock.json --exclude=self-test.js -F "20.0.7" . || true',
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
assert.strictEqual(pkg.version, '1.2.3');
const cfg = require(path.join(__dirname, '..', 'app', 'src', 'main', 'config.js'));
assert.strictEqual(cfg.appName, 'Zubii Batch Preset Tool');
assert.strictEqual(cfg.githubRepo, 'zubii-batch-preset-tool');
assert.strictEqual(cfg.githubOwner, 'shoaibulhassan544-ops');
assert.strictEqual(cfg.version, '1.2.3');
const builder = fs.readFileSync(path.join(__dirname, '..', 'app', 'electron-builder.yml'), 'utf8');
assert.ok(builder.includes('productName: Zubii Batch Preset Tool'));
assert.ok(builder.includes('repo: zubii-batch-preset-tool'));
assert.ok(builder.includes('owner: shoaibulhassan544-ops'), 'updater owner doosre account par hona chahiye');
const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'renderer', 'index.html'), 'utf8');
assert.ok(html.includes('<h1>Zubii Batch Preset Tool</h1>'));
console.log('PASS: Zubii naam + v1.2.3 + updater owner shoaibulhassan544-ops (package.json, config.js, electron-builder.yml, header)');

// 16. Exe path se Photoshop version — COM fallback ke liye.
assert.deepStrictEqual(ps.photoshopExePathToVersion('C:\\Program Files\\Adobe\\Adobe Photoshop 2023\\Photoshop.exe'), { major: 24, version: '24.0' });
assert.deepStrictEqual(ps.photoshopExePathToVersion('C:\\Program Files\\Adobe\\Adobe Photoshop CC 2019\\Photoshop.exe'), { major: 20, version: '20.0' });
assert.deepStrictEqual(ps.photoshopExePathToVersion('C:\\Program Files\\Adobe\\Adobe Photoshop 2025\\Photoshop.exe'), { major: 26, version: '26.0' });
assert.strictEqual(ps.photoshopExePathToVersion('C:\\Program Files\\Adobe\\Adobe Bridge\\Bridge.exe'), null);
assert.strictEqual(ps.photoshopExePathToVersion(''), null);
console.log('PASS: photoshopExePathToVersion (2023->24, CC 2019->20, 2025->26, ghair-Photoshop->null)');

// 17. Registry output parse + candidate -> exe.
const regSample = 'C:\\Program Files\\Adobe\\Adobe Photoshop 2020\\\r\n\r\nC:\\Program Files\\Adobe\\Adobe Photoshop 2024\\\r\n';
assert.deepStrictEqual(ps.parsePhotoshopRegistryOutput(regSample), [
  'C:\\Program Files\\Adobe\\Adobe Photoshop 2020\\',
  'C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\',
]);
assert.strictEqual(ps.parsePhotoshopRegistryOutput('').length, 0);
assert.strictEqual(ps.candidateToExe('C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\'), path.join('C:\\Program Files\\Adobe\\Adobe Photoshop 2024\\', 'Photoshop.exe'));
assert.strictEqual(ps.candidateToExe('C:\\PS\\Photoshop.exe'), 'C:\\PS\\Photoshop.exe');
assert.strictEqual(ps.candidateToExe(''), null);
console.log('PASS: parsePhotoshopRegistryOutput + candidateToExe');

// 18. JSX temp-copy path — run ke workDir me.
assert.strictEqual(ps.buildRunJsxPath('C:\\Temp\\zubii\\batch'), path.join('C:\\Temp\\zubii\\batch', 'apply-preset.jsx'));
assert.strictEqual(typeof ps.getCachedPhotoshop, 'function', 'cached version getter hona chahiye');
assert.strictEqual(ps.getCachedPhotoshop(), null, 'check se pehle cache khaali hona chahiye');
console.log('PASS: buildRunJsxPath + getCachedPhotoshop');

// 19. Photoshop ko KABHI band nahi karna — Quit kahin nahi hona chahiye.
//     COM object sirf release hota hai (ReleaseComObject), band nahi.
for (const f of ['app/src/main/photoshop.js', 'scripts/run-batch.ps1']) {
  const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.ok(!/\$ps\.Quit/.test(src), f + ' me Quit call baqi hai — Photoshop band ho jayega');
  assert.ok(!/\.Quit\(\)/.test(src), f + ' me .Quit() baqi hai');
}
const psMain = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'photoshop.js'), 'utf8');
assert.ok(psMain.includes('ReleaseComObject'), 'COM object release hona chahiye (ReleaseComObject)');
assert.ok(psMain.includes('cachedCheck'), 'version cache hona chahiye');
console.log('PASS: no Quit anywhere (photoshop.js, run-batch.ps1) — COM release only + version cache');

// 20. JSX temp copy — asal JSX install folder me rewrite NAHI hota.
assert.ok(psMain.includes('copyFileSync'), 'runBatch ko JSX ki temp copy karni chahiye');
assert.ok(psMain.includes('buildRunJsxPath'), 'runBatch ko temp-copy path istemal karna chahiye');
const ps1run = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-batch.ps1'), 'utf8');
assert.ok(ps1run.includes('Set-Content'), 'run-batch.ps1 ARGS_PATH ko (temp copy me) rewrite karta hai');
console.log('PASS: JSX temp-copy fix (copyFileSync + buildRunJsxPath, Set-Content sirf temp copy par)');

// 21. Signature bold header — gold NAHI (user ko sunehra rang ajeeb
//     laga). Bara "Z" script font me, title bold serif gehre brown me.
const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'renderer', 'css', 'styles.css'), 'utf8');
assert.ok(html.includes('<span class="logo">Z</span>'), 'logo Z hona chahiye');
assert.ok(!html.includes('📷'), 'camera emoji nahi hona chahiye');
assert.ok(html.includes('id="ps-path"'), 'Photoshop path ke liye ps-path span hona chahiye');
assert.ok(css.includes("'Segoe Script'"), 'Z logo signature-style script font me hona chahiye');
assert.ok(css.includes("'Brush Script MT'"), 'Z logo ke liye script font fallback hona chahiye');
assert.ok(/\.logo\s*\{[^}]*font-size:\s*42px/.test(css), 'Z logo bara hona chahiye (42px)');
assert.ok(/\.logo\s*\{[^}]*color:\s*#B4562F/.test(css), 'Z logo terracotta hona chahiye');
assert.ok(/\.brand h1\s*\{[^}]*color:\s*#43302A/.test(css), 'title gehra brown hona chahiye');
assert.ok(/\.brand h1\s*\{[^}]*font-weight:\s*700/.test(css), 'title bold hona chahiye');
assert.ok(!css.includes('#C9A227') && !css.includes('#D4AF37') && !css.includes('#B8860B') && !css.includes('#8C6D1F'),
  'header me sunehra gold bilkul nahi hona chahiye');
assert.ok(!/\.brand h1\s*\{[^}]*linear-gradient/.test(css), 'title par gold gradient nahi hona chahiye');
assert.ok(css.includes('.ps-path'), 'ps-path ka CSS hona chahiye');
console.log('PASS: signature bold header (script Z terracotta + bold brown title, gold nahi) + ps-path span');

// 21b. App version UI me — renderer getInfo se version dikhata hai.
const appJs21 = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'renderer', 'js', 'app.js'), 'utf8');
assert.ok(appJs21.includes("$('app-version').textContent = 'v' + info.version"), 'header me app version (v1.2.2) dikhna chahiye');
assert.ok(appJs21.includes("ps-path"), 'Photoshop path span ko app.js bharna chahiye');
console.log('PASS: app version header me dikhta hai (v + info.version) + ps-path wiring');

// 22. "Dobara check karo" button — badge ke saath, wiring samet.
assert.ok(html.includes('id="btn-ps-recheck"'), 're-check button index.html me hona chahiye');
assert.ok(html.includes('Dobara check karo'), 'button par "Dobara check karo" likha hona chahiye');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'renderer', 'js', 'app.js'), 'utf8');
assert.ok(appJs.includes('refreshPhotoshopStatus'), 're-check ke liye refreshPhotoshopStatus function honi chahiye');
assert.ok(appJs.includes("btn-ps-recheck').onclick = () => refreshPhotoshopStatus(true)"), 're-check button ko force check chalana chahiye');
assert.ok(appJs.includes('checkPhotoshop(force)'), 'refreshPhotoshopStatus ko force flag aage bhejna chahiye');
assert.ok(css.includes('.btn.ps-recheck'), 're-check button ka CSS hona chahiye');
console.log('PASS: "Dobara check karo" button (index.html + app.js wiring + CSS)');

// 23. Footer credit (aik dafa) + Support button (WhatsApp).
const creditCount = (html.match(/Developed by Shoaib Azeez/g) || []).length;
assert.strictEqual(creditCount, 1, 'credit sirf aik dafa hona chahiye, mila: ' + creditCount);
assert.ok(html.includes('id="btn-support"'), 'Support button index.html me hona chahiye');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'main.js'), 'utf8');
assert.ok(mainJs.includes('wa.me/923060756225'), 'Support button ko WhatsApp (wa.me/923060756225) kholna chahiye');
assert.ok(appJs.includes('openSupport'), 'renderer ko openSupport call karna chahiye');
console.log('PASS: footer credit (aik dafa) + Support button (WhatsApp)');

// 24. Compatibility check dobara COM NAHI chalata — cached version hi.
assert.ok(!/presets:check-compatibility[\s\S]{0,600}checkPhotoshop\(\)/.test(mainJs), 'compatibility handler ko dobara COM check nahi chalana chahiye');
assert.ok(mainJs.includes('getCachedPhotoshop'), 'compatibility handler ko cached version istemal karna chahiye');
console.log('PASS: presets:check-compatibility cached version istemal karta hai (dobara COM nahi)');

// 25. README — Download section bilkul upar + Requirements saaf.
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const dlIdx = readme.indexOf('## ⬇ Download');
assert.ok(dlIdx > 0, 'README me Download section hona chahiye');
assert.ok(dlIdx < readme.indexOf('## Workflow'), 'Download section bilkul upar hona chahiye (Workflow se pehle)');
assert.ok(readme.includes('exe file for Windows'), 'Download section me "exe file for Windows" likha hona chahiye');
assert.ok(readme.includes('https://github.com/shoaibulhassan544-ops/zubii-batch-preset-tool/releases'), 'Download section me Releases page ka link hona chahiye');
assert.ok(readme.includes('Windows 10/11 (64-bit)'), 'Requirements me Windows 10/11 64-bit hona chahiye');
assert.ok(readme.includes('Adobe Photoshop CC 2019 (20.x) se 2025 (26.x) lazmi'), 'Requirements me Photoshop range saaf honi chahiye');
assert.ok(readme.includes('Exe chalane ke liye Node.js nahi chahiye'), 'Requirements me saaf hona chahiye ke Node.js sirf build ke liye hai');
console.log('PASS: README Download section (upar) + Requirements (Windows 10/11, Photoshop lazmi, Node.js sirf build)');

// 26. Workflow — Release me exe + latest.yml, naam/body, --publish=never.
assert.ok(wf.includes('--publish=never'), 'workflow me --publish=never hona chahiye (GH_TOKEN issue)');
assert.ok(wf.includes('exe file for Windows'), 'Release naam/body me "exe file for Windows" hona chahiye');
assert.ok(wf.includes('name: ${{ github.ref_name }}'), 'Release naam tag se banna chahiye');
assert.ok(wf.includes('shoaibulhassan544-ops'), 'workflow header me doosra account hona chahiye');
assert.ok(!wf.includes('ShoaibAzeez'), 'workflow me purana owner nahi hona chahiye');
console.log('PASS: workflow (Release exe + latest.yml, "exe file for Windows", --publish=never, owner shoaibulhassan544-ops)');

// 27. Naam "Meta Box" kahin nahi — poore project me zero hits.
const { execSync: execSyncMeta } = require('child_process');
const metaHits = execSyncMeta('grep -rIn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=previews --exclude=package-lock.json --exclude=self-test.js -F "Meta Box" . || true',
  { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
assert.strictEqual(metaHits, '', '"Meta Box" kahin nahi hona chahiye:\n' + metaHits);
console.log('PASS: no "Meta Box" anywhere in project');
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

// 28. User ka exact path — "C:\Program Files\Adobe\Adobe Photoshop
//     CC 2019\Photoshop.exe" -> major 20 (COM fail ho to bhi mile).
assert.deepStrictEqual(
  ps.photoshopExePathToVersion('C:\\Program Files\\Adobe\\Adobe Photoshop CC 2019\\Photoshop.exe'),
  { major: 20, version: '20.0' });
assert.deepStrictEqual(
  ps.photoshopExePathToVersion('C:\\Program Files (x86)\\Adobe\\Adobe Photoshop CC 2019\\Photoshop.exe'),
  { major: 20, version: '20.0' });
assert.strictEqual(ps.parsePhotoshopVersion('20.0.7').major, 20);
assert.strictEqual(ps.parsePhotoshopVersion('20.0.7').label, '2019 (20.0.7)');
console.log('PASS: user ka exact CC 2019 path -> major 20 (Program Files + x86)');

// 29. Adobe folder scan — sirf "Adobe Photoshop*" folders milen.
const scanned = ps.scanAdobeDirEntries('C:\\Program Files\\Adobe', [
  'Adobe Photoshop CC 2019', 'Adobe Photoshop 2024', 'Adobe Photoshop 2025',
  'Adobe Bridge', 'Acrobat', 'CameraRaw', 'Adobe Photoshop Elements 2024',
]);
assert.strictEqual(scanned.length, 4, 'sirf Photoshop wale 4 folders milne chahiye, mile: ' + scanned.length);
assert.strictEqual(scanned[0].exe, path.join('C:\\Program Files\\Adobe', 'Adobe Photoshop CC 2019', 'Photoshop.exe'));
assert.ok(scanned.every((s) => s.exe.endsWith('Photoshop.exe')));
assert.deepStrictEqual(ps.scanAdobeDirEntries('C:\\Program Files\\Adobe', ['Adobe Bridge', 'Acrobat']), []);
console.log('PASS: scanAdobeDirEntries (Photoshop folders hi, Bridge/Acrobat nahi)');

// 30. App Paths output parse — reg query ki default value line.
const appPathsSample = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Photoshop.exe\r\n' +
  '    (Default)    REG_SZ    C:\\Program Files\\Adobe\\Adobe Photoshop CC 2019\\Photoshop.exe\r\n' +
  '    Path    REG_SZ    C:\\Program Files\\Adobe\\Adobe Photoshop CC 2019\\\r\n';
assert.strictEqual(ps.parseAppPathsOutput(appPathsSample),
  'C:\\Program Files\\Adobe\\Adobe Photoshop CC 2019\\Photoshop.exe');
assert.strictEqual(ps.parseAppPathsOutput(''), null);
assert.strictEqual(ps.parseAppPathsOutput('koi path nahi'), null);
console.log('PASS: parseAppPathsOutput (App Paths default value -> exe)');

// 31. Exe FileVersion parse — exact version (COM jaisi).
const fv1 = ps.parseExeFileVersion('20.0.7');
assert.strictEqual(fv1.ok, true);
assert.strictEqual(fv1.major, 20);
assert.strictEqual(fv1.version, '20.0.7');
assert.strictEqual(fv1.label, '2019 (20.0.7)');
const fv2 = ps.parseExeFileVersion('24.7.1.0');
assert.strictEqual(fv2.version, '24.7.1');
assert.strictEqual(fv2.major, 24);
assert.strictEqual(ps.parseExeFileVersion('').ok, false);
assert.strictEqual(ps.parseExeFileVersion('no version here').ok, false);
console.log('PASS: parseExeFileVersion (20.0.7 -> 2019, 24.7.1.0 -> 24.7.1)');

// 32. Detection sources — dono Adobe dirs + 4 registry keys + App Paths.
assert.deepStrictEqual(ps.ADOBE_INSTALL_DIRS, ['C:\\Program Files\\Adobe', 'C:\\Program Files (x86)\\Adobe']);
assert.ok(ps.PHOTOSHOP_REGISTRY_KEYS.includes('HKLM\\SOFTWARE\\Adobe\\Photoshop'));
assert.ok(ps.PHOTOSHOP_REGISTRY_KEYS.includes('HKCU\\SOFTWARE\\Adobe\\Photoshop'));
assert.ok(ps.PHOTOSHOP_REGISTRY_KEYS.includes('HKLM\\SOFTWARE\\WOW6432Node\\Adobe\\Photoshop'));
assert.ok(ps.PHOTOSHOP_REGISTRY_KEYS.includes('HKCU\\SOFTWARE\\WOW6432Node\\Adobe\\Photoshop'));
assert.strictEqual(ps.PHOTOSHOP_APP_PATHS_KEY,
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Photoshop.exe');
const psMain2 = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'photoshop.js'), 'utf8');
assert.ok(psMain2.includes('scanAdobeDirEntries'), 'findPhotoshopOnDisk ko Adobe folder scan istemal karna chahiye');
assert.ok(psMain2.includes('parseExeFileVersion'), 'exact version exe FileVersion se aani chahiye');
assert.ok(psMain2.includes('diagnostics'), 'na milne par diagnostic detail honi chahiye');
console.log('PASS: detection sources (2 Adobe dirs + 4 registry keys + App Paths + FileVersion + diagnostics)');

// 33. Manual Photoshop.exe rasta — validate + set/get.
const os = require('os');
const tmpPsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zubii-ps-test-'));
const fakePsDir = path.join(tmpPsDir, 'Adobe Photoshop CC 2019');
fs.mkdirSync(fakePsDir, { recursive: true });
const fakeExe = path.join(fakePsDir, 'Photoshop.exe');
fs.writeFileSync(fakeExe, 'fake exe');
assert.strictEqual(ps.validateManualExe(fakeExe).valid, true);
assert.strictEqual(ps.validateManualExe(fakeExe).exe, fakeExe);
assert.strictEqual(ps.validateManualExe(path.join(tmpPsDir, 'notepad.exe')).valid, false);
assert.strictEqual(ps.validateManualExe('').valid, false);
assert.strictEqual(ps.validateManualExe(null).valid, false);
ps.setManualPhotoshopPath(fakeExe);
assert.strictEqual(ps.getManualPhotoshopPath(), fakeExe);
ps.setManualPhotoshopPath('');
assert.strictEqual(ps.getManualPhotoshopPath(), null);
ps.setManualPhotoshopPath(null);
assert.strictEqual(ps.getManualPhotoshopPath(), null);
console.log('PASS: validateManualExe + set/getManualPhotoshopPath (fake CC 2019 exe)');

// 34. Watchdog + manual picker wiring (main/preload/renderer/index.html).
assert.strictEqual(ps.CHECK_TIMEOUT_MS, 90000, 'check watchdog 90 second hona chahiye');
assert.ok(psMain2.includes('check-timeout'), 'timeout par check-timeout result hona chahiye');
assert.ok(psMain2.includes('checkManualPhotoshop'), 'manual path ke liye checkManualPhotoshop hona chahiye');
assert.ok(mainJs.includes("ipcMain.handle('photoshop:choose-exe'"), 'main.js me choose-exe handler hona chahiye');
assert.ok(mainJs.includes('setManualPhotoshopPath'), 'main.js ko manual path photoshop.js ko dena chahiye');
assert.ok(mainJs.includes('photoshopExePath'), 'manual path settings me save hona chahiye');
const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'preload', 'preload.js'), 'utf8');
assert.ok(preloadJs.includes('choosePhotoshopExe'), 'preload me choosePhotoshopExe bridge hona chahiye');
assert.ok(html.includes('id="btn-ps-pick"'), '"Photoshop.exe chuno" button index.html me hona chahiye');
assert.ok(html.includes('Photoshop.exe chuno'), 'pick button par yehi likha hona chahiye');
assert.ok(html.includes('id="btn-ps-copy"'), '"Detail copy karo" button index.html me hona chahiye');
assert.ok(html.includes('class="ps-bar"'), 'Photoshop status ke liye header ke neeche ps-bar honi chahiye');
assert.ok(html.indexOf('ps-bar') < html.indexOf('ps-status'), 'ps-status badge ps-bar ke andar hona chahiye (topbar me nahi)');
assert.ok(css.includes('.ps-bar'), 'ps-bar ka CSS hona chahiye');
assert.ok(appJs21.includes('pickPhotoshopExe'), 'renderer me pickPhotoshopExe function honi chahiye');
assert.ok(appJs21.includes('copyPsDiagnostics'), 'renderer me copyPsDiagnostics function honi chahiye');
assert.ok(appJs21.includes('lastPsDiagnostics'), 'diagnostic detail renderer me save honi chahiye');
assert.ok(appJs21.includes("btn-ps-pick').onclick"), 'pick button wired hona chahiye');
assert.ok(appJs21.includes("btn-ps-copy').onclick"), 'copy button wired hona chahiye');
console.log('PASS: watchdog (90s) + manual picker + copy button wiring (main/preload/renderer/index.html)');

// 36. Batch fallback chain — COM adhoora ho (DoJavaScriptFile method
//     na ho) to seedha Photoshop.exe se script chale. Yehi user ke PC
//     ka asal masla tha: COM object ban gaya, method nahi mili, batch
//     0% par WriteErrorException se mar gaya. Write-Error bilkul nahi
//     hona chahiye (tail lines ki wajah).
const ps1new = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-batch.ps1'), 'utf8');
for (const needle of ['-PhotoshopExe', 'Try-ComRun', 'DoJavaScriptFile', 'DoJavaScript',
  "does not contain a method named 'DoJavaScriptFile'", 'MethodMissing',
  'COM adhoora hai', 'Start-Process', 'Write-FatalProgress', 'Write-ProgressNote',
  'skipToExe', 'progress.json']) {
  assert.ok(ps1new.includes(needle), 'run-batch.ps1 missing: ' + needle);
}
assert.ok(!ps1new.includes('Write-Error'), 'run-batch.ps1 me Write-Error nahi hona chahiye (WriteErrorException tail)');
assert.ok(ps1new.includes('Photoshop.exe se script chala raha hun'), 'exe fallback ka log hona chahiye');
console.log('PASS: run-batch.ps1 fallback chain (method-missing -> DoJavaScript -> exe command line, no Write-Error)');

// 37. Batch exe path — cached check ka exe pehle, phir manual, phir null.
assert.strictEqual(ps.resolveBatchExePath({ exe: 'C:\\PS\\Photoshop.exe' }, 'C:\\Other\\Photoshop.exe'), 'C:\\PS\\Photoshop.exe');
assert.strictEqual(ps.resolveBatchExePath({ exe: null }, 'C:\\Other\\Photoshop.exe'), 'C:\\Other\\Photoshop.exe');
assert.strictEqual(ps.resolveBatchExePath(null, null), null);
assert.strictEqual(ps.resolveBatchExePath(null, '   '), null);
assert.strictEqual(ps.resolveBatchExePath({}, ''), null);
console.log('PASS: resolveBatchExePath (cached > manual > null)');

// 38. Batch fatal message — Roman Urdu, tail lines saaf.
const fm1 = ps.batchFatalMessage({ code: 4, stderr: '', progress: { fatal: 'Photoshop ka COM adhoora hai — script Photoshop.exe se chalai ja rahi hai.' } });
assert.ok(fm1.includes('COM adhoora hai'), 'fatal field jeetna chahiye');
const fm2 = ps.batchFatalMessage({ code: 4, stderr: '', progress: { errors: [{ file: '', error: 'Photoshop script fail: kuch ghalat' }] } });
assert.ok(fm2.includes('kuch ghalat'), 'pehli error milni chahiye');
const fm3 = ps.batchFatalMessage({
  code: 1, stderr: 'run-batch.ps1 : Photoshop script failed: Method invocation failed because [System.__ComObject] does not contain a method named \'DoJavaScriptFile\'.\n    + CategoryInfo          : NotSpecified: (:) [Write-Error], WriteErrorException\n    + FullyQualifiedErrorId : Microsoft.PowerShell.Commands.WriteErrorException,run-batch.ps1',
  progress: { errors: [] },
});
assert.ok(fm3.includes('DoJavaScriptFile'), 'stderr se asal message milna chahiye, tail nahi');
assert.ok(!fm3.includes('CategoryInfo') && !fm3.includes('FullyQualifiedErrorId') && !fm3.includes('WriteErrorException'),
  'tail lines saaf honi chahiye');
const fm4 = ps.batchFatalMessage({ code: 3, stderr: '', progress: {} });
assert.ok(fm4.includes('Photoshop'), 'exit code fallback me bhi wajah honi chahiye');
console.log('PASS: batchFatalMessage (fatal > errors > stderr saaf, tail lines nahi)');

// 39. runBatch runner ko -PhotoshopExe deta hai + adhoora batch reject karta hai.
assert.ok(psMain2.includes("'-PhotoshopExe'"), 'runBatch ko runner ko -PhotoshopExe dena chahiye');
assert.ok(psMain2.includes('batchFatalMessage'), 'runBatch ko fatal message builder istemal karna chahiye');
assert.ok(psMain2.includes('resolveBatchExePath'), 'runBatch ko resolveBatchExePath istemal karna chahiye');
assert.ok(psMain2.includes('code === 0 && final.done >= final.total'), 'adhoora batch (done < total) resolve nahi hona chahiye');
console.log('PASS: runBatch (-PhotoshopExe + fatal message + adhoora batch reject)');

// 40. Update toast — updater.js native dialog nahi, events bhejta hai.
const updJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'updater.js'), 'utf8');
assert.ok(!updJs.includes('showMessageBoxSync'), 'updater.js me native dialog nahi hona chahiye');
assert.ok(!updJs.includes("require('electron')") || !updJs.includes('dialog'), 'updater.js me dialog import nahi hona chahiye');
assert.ok(updJs.includes("win.webContents.send('update:event'"), 'updater ko renderer ko update:event bhejna chahiye');
for (const t of ["type: 'available'", "type: 'progress'", "type: 'downloaded'", "type: 'none'", "type: 'error'"]) {
  assert.ok(updJs.includes(t), 'updater event missing: ' + t);
}
assert.ok(updJs.includes('downloadUpdate'), 'updater ko downloadUpdate export karna chahiye');
assert.ok(updJs.includes('restartToInstall'), 'updater ko restartToInstall export karna chahiye');
assert.ok(mainJs.includes("ipcMain.handle('updates:download'"), 'main.js me updates:download handler hona chahiye');
assert.ok(mainJs.includes("ipcMain.handle('updates:restart'"), 'main.js me updates:restart handler hona chahiye');
assert.ok(preloadJs.includes('onUpdate'), 'preload me onUpdate bridge hona chahiye');
assert.ok(preloadJs.includes('downloadUpdate'), 'preload me downloadUpdate bridge hona chahiye');
assert.ok(preloadJs.includes('restartToInstall'), 'preload me restartToInstall bridge hona chahiye');
console.log('PASS: updater toast events (available/progress/downloaded/none/error, no native dialog)');

// 41. Toast UI — bottom-right popup, Roman Urdu, app styling.
assert.ok(html.includes('id="update-toast"'), 'index.html me update-toast hona chahiye');
for (const id of ['update-toast-title', 'update-toast-msg', 'update-toast-progress', 'update-toast-bar', 'update-toast-primary', 'update-toast-secondary', 'update-toast-close']) {
  assert.ok(html.includes('id="' + id + '"'), 'toast element missing: ' + id);
}
assert.ok(/\.update-toast\s*\{[^}]*position:\s*fixed/.test(css), 'toast fixed hona chahiye');
assert.ok(/\.update-toast\s*\{[^}]*right:\s*22px/.test(css), 'toast right side par hona chahiye');
assert.ok(/\.update-toast\s*\{[^}]*bottom:\s*22px/.test(css), 'toast neeche hona chahiye');
assert.ok(css.includes('.toast-progress'), 'toast progress bar ka CSS hona chahiye');
assert.ok(appJs21.includes('bindUpdateToast'), 'renderer me bindUpdateToast function honi chahiye');
for (const s of ['Nayi version aa gayi hai', 'Download karo', 'Restart karo', 'Baad me', 'Update tayyar hai', 'Download ho raha hai']) {
  assert.ok(appJs21.includes(s), 'toast Roman Urdu string missing: ' + s);
}
assert.ok(appJs21.includes("btn-updates').onclick"), 'Check for updates button toast se jurna chahiye');
console.log('PASS: update toast UI (bottom-right popup, Roman Urdu, progress bar)');

// 42. Batch fatal/note renderer me dikhe — 0% par atka na rahe.
assert.ok(appJs21.includes("s.fatal"), 'bindProgress ko s.fatal dekhna chahiye');
assert.ok(appJs21.includes("'Batch ERROR: ' + s.fatal"), 'fatal log me aana chahiye');
assert.ok(appJs21.includes("s.note"), 'bindProgress ko s.note dekhna chahiye');
assert.ok(appJs21.includes("'NOTE: ' + s.note"), 'note (COM adhoora hai) log me aana chahiye');
assert.ok(appJs21.includes('Batch ruk gaya'), 'fatal par progress text badalna chahiye');
console.log('PASS: batch fatal/note renderer me dikhte hain (0% stuck nahi)');

// 43. README — v1.2.3 entry + Download section nayi version.
assert.ok(readme.includes('**v1.2.3**'), 'README me v1.2.3 entry honi chahiye');
assert.ok(readme.includes('ZubiiBatchPresetTool-Setup-1.2.3.exe'), 'README Download me 1.2.3 exe honi chahiye');
assert.ok(readme.includes('COM adhoora'), 'README me COM adhoora wali wajah likhi honi chahiye');
console.log('PASS: README v1.2.3 entry + Download (1.2.3 exe)');

// 35. Async: findPhotoshopOnDisk hamesha resolve hota hai (hang nahi) aur
//     checkManualPhotoshop fake exe par folder version deta hai.
ps.findPhotoshopOnDisk('test COM fail').then((nf) => {
  assert.strictEqual(nf.ok, false, 'Linux par Photoshop nahi milna chahiye');
  assert.ok(nf.diagnostics && nf.diagnostics.includes('Adobe folders'), 'diagnostics me Adobe folders scan hona chahiye');
  assert.ok(nf.detail && nf.detail.includes('test COM fail'), 'detail me COM error hona chahiye');
  console.log('PASS: findPhotoshopOnDisk hamesha resolve hota hai (not-found + diagnostics, hang nahi)');
  return ps.checkManualPhotoshop(fakeExe);
}).then((m) => {
  assert.strictEqual(m.ok, true, 'manual fake exe ok hona chahiye');
  assert.strictEqual(m.method, 'manual');
  assert.strictEqual(m.major, 20, 'fake CC 2019 exe -> major 20');
  assert.strictEqual(m.exe, fakeExe);
  console.log('PASS: checkManualPhotoshop (fake CC 2019 exe -> major 20, method manual)');
  fs.rmSync(tmpPsDir, { recursive: true, force: true });
  console.log('\nAll self-tests passed.');
}).catch((err) => { console.error('ASYNC TEST FAILED:', err); process.exit(1); });
