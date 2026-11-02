// apply-preset.jsx — ExtendScript for Adobe Photoshop (CC 2019 / 20.x se
// 2025 / 26.x tak — har version; COM ProgID version-independent hai).
// Run by PowerShell via Photoshop COM: app.DoJavaScriptFile(this file).
// Reads its arguments from a JSON file whose path is embedded below by
// the Electron main process (see photoshop.js — it writes batch-args.json
// and rewrites the ARGS_PATH line before each run).
//
// args JSON:
//   presetPath, presetName, files: [{src, index}], outputDir,
//   quality (1-100), resize (bool), resizeWidth, namingPattern,
//   workDir, progressFile, cancelFile
//
// Method (see photoshop.js header for the full explanation):
//   per file: copy JPG to a temp work file -> write the .xmp preset next
//   to it as a Camera Raw sidecar -> open via CameraRawOpenOptions
//   (settings=CUSTOM) -> fallback: Camera Raw Filter -> resize ->
//   save as JPG -> close. Originals are never touched.

#target photoshop

var ARGS_PATH = ""; // <-- replaced by the runner before each batch

function readTextFile(p) {
  var f = new File(p);
  f.encoding = "UTF8";
  if (!f.open("r")) return null;
  var s = f.read();
  f.close();
  return s;
}

function writeTextFile(p, text) {
  var f = new File(p);
  f.encoding = "UTF8";
  if (!f.open("w")) return false;
  f.write(text);
  f.close();
  return true;
}

function writeProgress(state) {
  writeTextFile(state.progressFile, JSON.stringify(state));
}

function safeName(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
}

function outputName(pattern, presetName, fileName, seq) {
  var base = fileName.replace(/\.[^.]+$/, "");
  var n = (pattern || "{preset}_{filename}_{seq}")
    .replace(/\{preset\}/gi, safeName(presetName || "preset"))
    .replace(/\{filename\}/gi, safeName(base))
    .replace(/\{seq\}/gi, ("000" + seq).slice(-3));
  return n + ".jpg";
}

function main() {
  var argsText = readTextFile(ARGS_PATH);
  if (!argsText) throw new Error("Could not read args file: " + ARGS_PATH);
  var args = JSON.parse(argsText);

  var presetXmp = readTextFile(args.presetPath);
  if (!presetXmp) throw new Error("Could not read preset: " + args.presetPath);
  // Per-photo presets (Auto Pick / override): cache XMP text per path.
  var presetCache = {};
  presetCache[args.presetPath] = presetXmp;
  function xmpFor(presetPath) {
    if (!presetPath) return presetXmp;
    if (!presetCache[presetPath]) {
      var t = readTextFile(presetPath);
      if (!t) throw new Error("Could not read preset: " + presetPath);
      presetCache[presetPath] = t;
    }
    return presetCache[presetPath];
  }

  var state = { total: args.files.length, done: 0, ok: 0, failed: 0, current: "", errors: [] };
  writeProgress(state);

  var outFolder = new Folder(args.outputDir);
  if (!outFolder.exists) outFolder.create();

  for (var i = 0; i < args.files.length; i++) {
    // Cancel check between files (Electron writes cancel.flag).
    var cancelFile = new File(args.cancelFile);
    if (cancelFile.exists) { state.current = "Cancelled by user"; writeProgress(state); return; }

    var item = args.files[i];
    var srcFile = new File(item.src);
    var baseName = srcFile.name.replace(/\.[^.]+$/, "");
    state.current = srcFile.name;
    writeProgress(state);

    var doc = null;
    try {
      // 1. Temp copy + sidecar (original stays untouched).
      //    Per-photo preset (Auto Pick / override) or the batch preset.
      var filePresetXmp = xmpFor(item.presetPath);
      var tmpJpg = new File(args.workDir + "/" + baseName + "_work.jpg");
      srcFile.copy(tmpJpg);
      var sidecar = new File(args.workDir + "/" + baseName + "_work.xmp");
      writeTextFile(sidecar, filePresetXmp);

      // 2. Open through Camera Raw so the sidecar settings apply.
      var rawOpts = new CameraRawOpenOptions();
      rawOpts.settings = CameraRawSettingsType.CUSTOM;
      rawOpts.bitsPerChannel = BitsPerChannelType.EIGHT;
      doc = app.open(tmpJpg, rawOpts);

      // 3. Fallback: if the open path ignored the settings, run the
      //    Camera Raw Filter with the XMP packet attached (best-effort).
      try {
        var desc = new ActionDescriptor();
        desc.putString(stringIDToTypeID("cameraRawSettings"), filePresetXmp);
        executeAction(stringIDToTypeID("Adobe Camera Raw Filter"), desc, DialogModes.NO);
      } catch (e2) {
        // Filter fallback not available on this build — the open path
        // already applied the preset. Continue with the document as-is.
      }

      // 4. Optional resize (long edge = resizeWidth, keep ratio).
      if (args.resize && args.resizeWidth) {
        var w = doc.width.as("px"), h = doc.height.as("px");
        if (w > args.resizeWidth || h > args.resizeWidth) {
          if (w >= h) doc.resizeImage(UnitValue(args.resizeWidth, "px"), null, null, ResampleMethod.BICUBIC);
          else doc.resizeImage(null, UnitValue(args.resizeWidth, "px"), null, ResampleMethod.BICUBIC);
        }
      }

      // 5. Save as JPG to the output folder.
      var outName = outputName(args.namingPattern, item.presetName || args.presetName, srcFile.name, item.index + 1);
      var outFile = new File(args.outputDir + "/" + outName);
      var jpgOpts = new JPEGSaveOptions();
      jpgOpts.quality = Math.max(0, Math.min(12, Math.round((args.quality || 85) / 100 * 12)));
      jpgOpts.embedColorProfile = true;
      jpgOpts.formatOptions = FormatOptions.STANDARDBASELINE;
      doc.saveAs(outFile, jpgOpts, true, Extension.LOWERCASE);

      state.ok++;
    } catch (e) {
      state.failed++;
      state.errors.push({ file: item.src, error: String(e && e.message ? e.message : e) });
    } finally {
      try { if (doc) doc.close(SaveOptions.DONOTSAVE); } catch (_) {}
      // Clean temp files for this photo.
      try { var t1 = new File(args.workDir + "/" + baseName + "_work.jpg"); if (t1.exists) t1.remove(); } catch (_) {}
      try { var t2 = new File(args.workDir + "/" + baseName + "_work.xmp"); if (t2.exists) t2.remove(); } catch (_) {}
    }
    state.done++;
    writeProgress(state);
  }
}

try {
  main();
} catch (fatal) {
  // Surface a fatal error through the progress file so Electron can show it.
  try {
    var st = { total: 0, done: 0, ok: 0, failed: 1, current: "", errors: [{ file: "", error: "Fatal: " + fatal }] };
    writeTextFile(new File(ARGS_PATH).parent + "/progress.json", JSON.stringify(st));
  } catch (_) {}
  throw fatal;
}
