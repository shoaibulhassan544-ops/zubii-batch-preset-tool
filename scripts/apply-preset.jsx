// apply-preset.jsx - ExtendScript for Adobe Photoshop (CC 2019 / 20.x se
// 2025 / 26.x tak - har version; COM ProgID version-independent hai).
// Run by PowerShell via Photoshop COM: app.DoJavaScriptFile(this file).
// Reads its arguments from a JSON file whose path is embedded below by
// the Electron main process (see photoshop.js - it writes batch-args.json
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

// JSON-POLYFILL-START
// JSON polyfill - Photoshop CC 2019 ke ExtendScript engine (ES3) me
// native JSON object maujood nahi hota ("ReferenceError: JSON is
// undefined"). Is liye JSON.parse / JSON.stringify yahan define kiye
// gaye hain. Sirf tab define hota hai jab typeof JSON === "undefined"
// ho - naye Photoshop par native JSON ho to usay chheda nahi jata.
// ES3-safe: Object.keys / Array.isArray / trim / map waghera kuch nahi.
// Sirf wahi shapes support karta hai jo tool istemal karta hai:
// objects, arrays, strings, numbers, booleans, null. (Crockford
// json2.js ke public-domain design par mabni, is tool ke liye chhota
// karke likha gaya.)
if (typeof JSON === "undefined") {
  JSON = {};
  (function () {
    // quote() - string ko JSON string literal banata hai. Regex ki
    // bajaye seedha char loop hai (regex literal me '"' hota to
    // self-test ka stripper confuse hota hai, aur loop ES3 me saaf hai).
    function quote(string) {
      var out = '"', i, c, code;
      for (i = 0; i < string.length; i += 1) {
        c = string.charAt(i);
        code = string.charCodeAt(i);
        if (c === '"') {
          out += '\\"';
        } else if (c === "\\") {
          out += "\\\\";
        } else if (c === "\b") {
          out += "\\b";
        } else if (c === "\f") {
          out += "\\f";
        } else if (c === "\n") {
          out += "\\n";
        } else if (c === "\r") {
          out += "\\r";
        } else if (c === "\t") {
          out += "\\t";
        } else if (code < 0x20 || code === 0x7f ||
          (code >= 0x80 && code <= 0x9f) || code === 0x00ad ||
          (code >= 0x0600 && code <= 0x0604) || code === 0x070f ||
          code === 0x17b4 || code === 0x17b5 ||
          (code >= 0x200c && code <= 0x200f) ||
          (code >= 0x2028 && code <= 0x202f) ||
          (code >= 0x2060 && code <= 0x2064) || code === 0xfeff ||
          (code >= 0xfff0 && code <= 0xffff)) {
          out += "\\u" + ("0000" + code.toString(16)).slice(-4);
        } else {
          out += c;
        }
      }
      return out + '"';
    }
    function str(key, holder) {
      var i, k, v, length, partial, value = holder[key];
      if (value && typeof value === "object" && typeof value.toJSON === "function") {
        value = value.toJSON(key);
      }
      switch (typeof value) {
        case "string":
          return quote(value);
        case "number":
          return isFinite(value) ? String(value) : "null";
        case "boolean":
          return String(value);
        case "object":
          if (!value) {
            return "null";
          }
          partial = [];
          if (Object.prototype.toString.apply(value) === "[object Array]") {
            length = value.length;
            for (i = 0; i < length; i += 1) {
              partial[i] = str(i, value) || "null";
            }
            return partial.length === 0 ? "[]" : "[" + partial.join(",") + "]";
          }
          for (k in value) {
            if (Object.prototype.hasOwnProperty.call(value, k)) {
              v = str(k, value);
              if (v) {
                partial.push(quote(k) + ":" + v);
              }
            }
          }
          return partial.length === 0 ? "{}" : "{" + partial.join(",") + "}";
      }
      return undefined;
    }
    JSON.stringify = function (value) {
      return str("", { "": value });
    };
    var text, at, ch;
    var escapee = {
      '"': '"', "\\": "\\", "/": "/",
      b: "\b", f: "\f", n: "\n", r: "\r", t: "\t"
    };
    function parseError(m) {
      throw new SyntaxError(m);
    }
    function next(c) {
      if (c && c !== ch) {
        parseError("Expected '" + c + "' instead of '" + ch + "'");
      }
      ch = text.charAt(at);
      at += 1;
      return ch;
    }
    function white() {
      while (ch) {
        if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
          next();
        } else {
          break;
        }
      }
    }
    function parseString() {
      var hex, i, uffff, s = "";
      if (ch === '"') {
        while (next()) {
          if (ch === '"') {
            next();
            return s;
          }
          if (ch === "\\") {
            next();
            if (ch === "u") {
              uffff = 0;
              for (i = 0; i < 4; i += 1) {
                hex = parseInt(next(), 16);
                if (!isFinite(hex)) {
                  break;
                }
                uffff = uffff * 16 + hex;
              }
              s += String.fromCharCode(uffff);
            } else if (typeof escapee[ch] === "string") {
              s += escapee[ch];
            } else {
              break;
            }
          } else {
            s += ch;
          }
        }
      }
      parseError("Bad string");
    }
    function parseNumber() {
      var string = "";
      if (ch === "-") {
        string = "-";
        next("-");
      }
      while (ch >= "0" && ch <= "9") {
        string += ch;
        next();
      }
      if (ch === ".") {
        string += ".";
        while (next() && ch >= "0" && ch <= "9") {
          string += ch;
        }
      }
      if (ch === "e" || ch === "E") {
        string += ch;
        next();
        if (ch === "-" || ch === "+") {
          string += ch;
          next();
        }
        while (ch >= "0" && ch <= "9") {
          string += ch;
          next();
        }
      }
      var num = parseFloat(string);
      if (!isFinite(num)) {
        parseError("Bad number");
      }
      return num;
    }
    function parseWord() {
      switch (ch) {
        case "t":
          next("t"); next("r"); next("u"); next("e");
          return true;
        case "f":
          next("f"); next("a"); next("l"); next("s"); next("e");
          return false;
        case "n":
          next("n"); next("u"); next("l"); next("l");
          return null;
      }
      parseError("Unexpected '" + ch + "'");
    }
    function parseArray() {
      var arr = [];
      if (ch === "[") {
        next("[");
        white();
        if (ch === "]") {
          next("]");
          return arr;
        }
        while (ch) {
          arr.push(parseValue());
          white();
          if (ch === "]") {
            next("]");
            return arr;
          }
          next(",");
          white();
        }
      }
      parseError("Bad array");
    }
    function parseObject() {
      var key, obj = {};
      if (ch === "{") {
        next("{");
        white();
        if (ch === "}") {
          next("}");
          return obj;
        }
        while (ch) {
          key = parseString();
          white();
          next(":");
          obj[key] = parseValue();
          white();
          if (ch === "}") {
            next("}");
            return obj;
          }
          next(",");
          white();
        }
      }
      parseError("Bad object");
    }
    function parseValue() {
      white();
      switch (ch) {
        case "{":
          return parseObject();
        case "[":
          return parseArray();
        case '"':
          return parseString();
        case "-":
          return parseNumber();
        default:
          return (ch >= "0" && ch <= "9") ? parseNumber() : parseWord();
      }
    }
    JSON.parse = function (source) {
      var result;
      text = String(source);
      at = 0;
      ch = " ";
      result = parseValue();
      white();
      if (ch) {
        parseError("Syntax error");
      }
      return result;
    };
  }());
}
// JSON-POLYFILL-END

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
        // Filter fallback not available on this build - the open path
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
