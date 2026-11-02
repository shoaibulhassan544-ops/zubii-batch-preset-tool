// auto-pick.js — AUTO PRESET SELECTION.
// Har photo ka analysis karke (brightness, rang, warm/cool, saturation,
// contrast, skin tones, indoor/outdoor) us preset se match karta hai jo
// us photo par sab se acha baithega. User har photo par manual override
// bhi kar sakta hai (renderer me per-photo dropdown).
//
// KYUN "try every preset and score" NAHI:
// Har preset ko har photo par Photoshop me render karke score dena
// 50 photos x 10 presets = 500 Photoshop renders hota — ghanton ka kaam.
// Is liye fast analysis-based matching hai (millisecond me), aur user
// "Test one photo" se kisi bhi preset ko asal Photoshop render par
// visually confirm kar sakta hai. Yehi sahi trade-off hai.
'use strict';

const { parseXmpSettings } = require('./photoshop');

// ---------------------------------------------------------------------------
// Pure stats from raw BGRA pixels (testable without Electron/Photoshop).
// pixels: Buffer, BGRA order, width*height*4 bytes.
// ---------------------------------------------------------------------------
function computeStatsFromPixels(pixels, width, height) {
  const n = width * height;
  let sumL = 0, sumR = 0, sumG = 0, sumB = 0, sumSat = 0;
  let sumL2 = 0, sumR2 = 0, sumG2 = 0, sumB2 = 0;
  let dark = 0, bright = 0, skin = 0, green = 0;
  for (let i = 0; i < n; i++) {
    const b = pixels[i * 4], g = pixels[i * 4 + 1], r = pixels[i * 4 + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sumL += lum; sumL2 += lum * lum;
    sumR += r; sumR2 += r * r; sumG += g; sumG2 += g * g; sumB += b; sumB2 += b * b;
    sumSat += mx === 0 ? 0 : (mx - mn) / mx;
    if (lum < 60) dark++;
    if (lum > 200) bright++;
    // Classic skin-tone range (RGB): R>G>B, R-B clearly positive.
    if (r > 95 && g > 40 && b > 20 && r > g && g > b && (r - b) > 15 && (r - g) > 10) skin++;
    if (g > r && g > b && g > 80) green++;
  }
  const mean = (s) => s / n;
  const std = (s, s2) => Math.sqrt(Math.max(0, s2 / n - (s / n) * (s / n)));
  const meanLum = mean(sumL), meanR = mean(sumR), meanG = mean(sumG), meanB = mean(sumB);
  return {
    meanLum, contrast: std(sumL, sumL2),
    meanR, meanG, meanB,
    warmCool: meanR - meanB,              // + = warm (laal/peela), - = cool (neela)
    saturation: mean(sumSat),             // 0..1
    colorfulness: (std(sumR, sumR2) + std(sumG, sumG2) + std(sumB, sumB2)) / 3,
    darkShare: dark / n, brightShare: bright / n,
    skinShare: skin / n,                  // 0..1, zyada = portraits/faces
    greenShare: green / n,                // 0..1, zyada = outdoor/garden
  };
}

// ---------------------------------------------------------------------------
// Preset character — XMP settings se preset ki "fitrat" nikalo.
// ---------------------------------------------------------------------------
function presetCharacter(xmpText) {
  const s = parseXmpSettings(xmpText || '');
  const num = (k, dflt) => (typeof s[k] === 'number' ? s[k] : dflt);
  const exposure = num('Exposure2012', 0);
  const temp = num('Temperature', 6500);
  const tint = num('Tint', 0);
  const vibrance = num('Vibrance', 0);
  const saturation = num('Saturation', 0);
  const contrast = num('Contrast2012', 0);
  const clarity = num('Clarity2012', 0);
  const shadows = num('Shadows2012', 0);
  const isBW = saturation <= -90 || /ConvertToGrayscale="True"/i.test(xmpText || '');
  return {
    settings: s, exposure, temp, tint, vibrance, saturation, contrast, clarity, shadows,
    isBW,
    warm: temp > 6500 || tint > 8,        // garam rang deta hai
    cool: temp < 5800 || tint < -8,       // thanda rang deta hai
    brightens: exposure > 0.15 || shadows > 15,
    darkens: exposure < -0.15,
    vivid: vibrance > 15 || saturation > 10,
    muted: vibrance < -10 || saturation < -10,
    contrasty: contrast > 15 || clarity > 20,
    soft: contrast < -5 || clarity < -10, // matte/soft look
  };
}

// ---------------------------------------------------------------------------
// Scoring: photo stats + preset character -> 0..100 + wajah (Roman Urdu).
// ---------------------------------------------------------------------------
function scorePreset(stats, ch) {
  let score = 50;
  const reasons = [];
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

  // 1. Roshni: andheri photo ko roshni chahiye, zyada roshan ko nahi.
  if (stats.meanLum < 95 || stats.darkShare > 0.35) {
    if (ch.brightens) { score += 16; reasons.push('photo andheri hai, ye preset roshni barhata hai'); }
    else if (ch.darkens) { score -= 14; reasons.push('photo pehle se andheri hai, ye aur andhera karega'); }
  } else if (stats.meanLum > 175 || stats.brightShare > 0.35) {
    if (ch.brightens) { score -= 14; reasons.push('photo pehle se roshan hai, ye jal jayegi (blowout)'); }
    else if (ch.darkens) { score += 8; reasons.push('roshan photo ko ye halka sa balance karega'); }
  }

  // 2. Warm/cool: ulta rang balance karta hai, waisa hi rang zyada karta hai.
  if (stats.warmCool > 15) {           // photo pehle se garam
    if (ch.warm) { score -= 10; reasons.push('photo pehle se garam hai, ye aur peela kar dega'); }
    else if (ch.cool) { score += 10; reasons.push('garam photo ko ye thanda karke balance karega'); }
  } else if (stats.warmCool < -10) {   // photo thandi/neeli
    if (ch.warm) { score += 14; reasons.push('thandi photo ko ye garam, natural rang dega'); }
    else if (ch.cool) { score -= 10; reasons.push('photo pehle se thandi hai, ye aur neela kar dega'); }
  }

  // 3. Saturation: pheeki photo ko rang chahiye, rangeen ko nahi.
  if (stats.saturation < 0.25) {
    if (ch.vivid) { score += 12; reasons.push('photo ke rang pheeke hain, ye rang ubharega'); }
    else if (ch.muted) { score -= 8; reasons.push('photo pehle se pheeki hai, ye aur dull karega'); }
  } else if (stats.saturation > 0.45) {
    if (ch.vivid) { score -= 12; reasons.push('rang pehle se tez hain, ye aur tez karke kharab karega'); }
    else if (ch.muted) { score += 8; reasons.push('tez rangon ko ye naram karega'); }
  }

  // 4. Contrast: flat photo ko contrast, contrasty ko narmi.
  if (stats.contrast < 35) {
    if (ch.contrasty) { score += 10; reasons.push('photo flat hai, ye depth dega'); }
  } else if (stats.contrast > 70) {
    if (ch.contrasty) { score -= 8; reasons.push('photo me contrast pehle se zyada hai'); }
    else if (ch.soft) { score += 8; reasons.push('sakht photo ko ye naram karega'); }
  }

  // 5. Skin tones: portraits par naram, garam preset acha lagta hai.
  if (stats.skinShare > 0.08) {
    if (ch.isBW) { score -= 5; reasons.push('is me chehre hain, black & white rang hata dega'); }
    else if (ch.warm && ch.clarity < 25) { score += 8; reasons.push('chehron par garam, naram rang acha lagega'); }
    else if (ch.clarity > 30) { score -= 6; reasons.push('zyada clarity chehron par sakht lagti hai'); }
  }

  // 6. Outdoor/garden: hare bhare scene par vivid/warm acha lagta hai.
  if (stats.greenShare > 0.25) {
    if (ch.vivid || ch.warm) { score += 6; reasons.push('outdoor/garden photo hai, rang ubhrenge'); }
  }

  // 7. Black & white: rang wali photo par B&W aam tor par second choice.
  if (ch.isBW) {
    score -= 10;
    if (stats.saturation < 0.2) { score += 14; reasons.push('photo ke rang waise bhi kam hain, B&W suit karega'); }
  }

  if (!reasons.length) reasons.push('photo aur preset ka overall balance theek hai');
  return { score: clamp(score), reasons: reasons.slice(0, 2) };
}

// Rank all presets for one photo. presets: [{name, path, xmpText}]
function rankPresetsForPhoto(stats, presets) {
  return presets
    .map((p) => {
      const ch = presetCharacter(p.xmpText);
      const { score, reasons } = scorePreset(stats, ch);
      return { name: p.name, path: p.path, score, reasons, character: ch };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Electron-only: analyse a JPG file with nativeImage (no extra dependency).
// Downscales to 64px first so 50 photos analyse in ~1 second.
// ---------------------------------------------------------------------------
function analyzeImageFile(filePath) {
  const { nativeImage } = require('electron');
  let img = nativeImage.createFromPath(filePath);
  if (img.isEmpty()) throw new Error('Photo load nahi hui: ' + filePath);
  const size = img.getSize();
  const scale = Math.min(1, 64 / Math.max(size.width, size.height));
  if (scale < 1) img = img.resize({ width: Math.max(1, Math.round(size.width * scale)) });
  const s = img.getSize();
  const bitmap = img.toBitmap(); // BGRA
  return computeStatsFromPixels(bitmap, s.width, s.height);
}

// Full auto-pick for a list of photos. Returns per-photo assignments:
// [{ photo, stats, ranked: [{name, path, score, reasons}], picked, reason }]
function autoPickForPhotos(photoPaths, presets) {
  return photoPaths.map((photo) => {
    const stats = analyzeImageFile(photo);
    const ranked = rankPresetsForPhoto(stats, presets);
    const picked = ranked[0] || null;
    return {
      photo, stats,
      ranked: ranked.map((r) => ({ name: r.name, path: r.path, score: r.score, reasons: r.reasons })),
      picked: picked ? { name: picked.name, path: picked.path, score: picked.score } : null,
      reason: picked ? picked.reasons.join(' — ') : 'Koi preset nahi mila',
    };
  });
}

module.exports = {
  computeStatsFromPixels, presetCharacter, scorePreset, rankPresetsForPhoto,
  analyzeImageFile, autoPickForPhotos,
};
