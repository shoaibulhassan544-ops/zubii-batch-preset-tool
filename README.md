# Zubii Batch Preset Tool — FREE

**40–50 photos par aik XMP preset aik saath lagao — Adobe Photoshop ke zariye, har version par.**
Bilkul **FREE** — koi licence nahi, koi key nahi, koi activation nahi, koi server nahi.
Updates GitHub Releases se aati hain (MetaBox tool jaisa update flow, licence ke baghair).

Made by Zubair Ul Hassan — Zubii Photography.

## ⬇ Download — exe file for Windows (v1.2.3)

**[ZubiiBatchPresetTool-Setup-1.2.3.exe — exe file for Windows](https://github.com/shoaibulhassan544-ops/zubii-batch-preset-tool/releases)** — Releases page se latest version download karo (exe file for Windows). Download karke install karo, Photoshop khol kar test karo.

![UI mockup](previews/ui-mockup.webp)

## Workflow (4 steps — neeche footer me bhi dikhte hain)

| Step | Kya karna hai |
|---|---|
| **1. Add Photos** | `Add Photos` se JPGs chuno, ya `Add Folder` se poora folder. 40–50 photos aik saath chal jayengi. |
| **2. Choose XMP Preset** | Left list se preset chuno. `+ Import XMP Preset` se apni `.xmp` file add karo (preset app me save ho jata hai). `Install preset in Camera Raw` dabao to preset Photoshop ke andar bhi aa jayega. |
| **3. Preview** | Kisi photo par click karo, phir `Test one photo` — asal Photoshop se aik photo par preset lag kar BEFORE / AFTER dikhayega. Rang pasand aaye to aage barho. |
| **4. Export JPG** | Right side se JPG Quality (85% default), Output Folder, Resize (optional), File Naming set karo, phir **▶ Start Batch** dabao. Progress bar + log batayega kitni photos ho gayin. |

**File naming:** `{preset}_{filename}_{seq}` — maslan `wedding-classic_DSC0123_001.jpg`.
**Original photos kabhi nahi badalti** — tool temp copy par kaam karta hai, originals untouched rehte hain.

## ✦ Auto Pick Preset (v1.1.0) — har photo ke liye khud preset chunega

User ke paas kafi saare presets honge — tool har photo ka analysis karke khud chunega ke kaun sa preset us photo par sab se acha lagega.

**Kaise kaam karta hai:**

1. Center panel me **✦ Auto Pick Preset** dabao.
2. Tool har photo ko 64px tak chhota karke us ka analysis karta hai — **brightness** (andheri/roshan), **rang** (warm/cool), **saturation** (pheeke/tez rang), **contrast** (flat/sakht), **skin tones** (chehre hain ya nahi), **outdoor/garden** (hara scene).
3. Har preset ki XMP settings parhi jati hain — exposure, temperature, tint, vibrance, contrast, clarity, B&W — aur us se preset ki "fitrat" nikali jati hai (garam, roshni barhane wala, vivid, naram, B&W…).
4. Har photo ke liye har preset ko **0–100 score** diya jata hai. Maslan:
   - Andheri photo + roshni barhane wala preset = **zyada score**
   - Pehle se garam photo + garam preset = **kam score** (aur peela ho jayega)
   - Pheeke rang + vivid preset = **zyada score**; tez rang + vivid preset = **kam score**
   - Chehron wali photo + naram garam preset = **zyada score**; zyada clarity = **kam score**
5. Har photo ke thumbnail par chuna hua preset likha aata hai, aur photo par click karke **kyun chuna gaya** (wajah, Roman Urdu me) aur top 3 choices scores ke saath dikhte hain.

**Manual override:** Agar auto wala pasand na aaye to photo par click karo aur neeche wale dropdown se khud preset badal do — wo photo par wahi lagega (thumbnail par ✎ nishan aa jayega). Baqi photos par auto wala hi rahega. `Start Batch` har photo par us ka apna preset lagata hai, aur file naam me bhi us photo wala preset likha aata hai.

**Kyun har preset ko render karke score nahi diya:** 50 photos × 10 presets = 500 Photoshop renders — ghanton ka kaam hota. Is liye fast analysis-based scoring hai (~1 second), aur **Test one photo** se kisi bhi preset ko asal Photoshop render par visually confirm kar sakte ho.

## Photoshop — har version (v1.2.3)

Tool kisi aik Photoshop version se bandha hua **nahi** hai. Photoshop se judne ke liye `Photoshop.Application` (COM) istemal hota hai — ye version-independent hai, is liye jo Photoshop installed ho, tool usi se jud jata hai. App khulte hi upar right corner me version dikhta hai, maslan `✓ Photoshop connected — 2023 (24.7)`.

Supported range:

| Photoshop | Version | Camera Raw |
|---|---|---|
| CC 2019 | 20.x | ACR 11 |
| 2020 | 21.x | ACR 12 |
| 2021 | 22.x | ACR 13 |
| 2022 | 23.x | ACR 14 |
| 2023 | 24.x | ACR 15 |
| 2024 | 25.x | ACR 16 |
| 2025 | 26.x | ACR 17 |

- **Aam settings har version par chalti hain** — exposure, temperature, tint, contrast, vibrance, clarity, tone curve, HSL, sharpness. Purana preset naye Photoshop par bhi chalega, aur naya aam preset purane Photoshop par bhi chalega.
- **Compatibility warning:** agar preset me nayi ACR feature ho (maslan AI masking, Lens Blur, Adaptive profile, Point Color), to tool batch se pehle Roman Urdu me warning dikhata hai — maslan "is ke liye Camera Raw 15 / Photoshop 2023 chahiye, tumhare paas Photoshop 2019 hai". Warning hoti hai, **batch block nahi hota** — aam setting lag jayegi, sirf nayi wali poori nahi lagegi. Faisla tumhara hai; pehle `Test one photo` se check kar lo.
- Photoshop 20.x se **purana untested** hai; **CS6 aur us se purana supported nahi** (Camera Raw Filter wala fallback us par nahi chalta).
- Photoshop 26.x se naya aaye to tool us se jud jayega, lekin us par test nahi hua — pehle Test one photo se check kar lo.

## UI / UX

- **Light, simple, modern** — Zubii site wale rang: Cream `#F7EFE3`, Terracotta `#B4562F`, Sage `#7D8C5C`, Dark Brown `#43302A`.
- **Left:** XMP Presets list (search + import + Camera Raw install).
- **Center:** Before / After photo grid preview (click a photo → Test one photo se asal preview).
- **Right:** Export Settings — JPG Quality slider, Output Folder, Resize toggle + width, File Naming, Start Batch button, progress bar, log.
- **Bottom:** 4-step workflow strip (Add Photos → Choose Preset → Preview → Export JPG).
- Upar right corner: Photoshop connection status (version ke saath) + **Check for updates** button.

## Zaroorat (Requirements)

- Windows 10/11 (64-bit)
- **Adobe Photoshop CC 2019 (20.x) se 2025 (26.x) lazmi** installed — tool Photoshop ko COM (`Photoshop.Application`) se chalata hai. Photoshop band ho tab bhi tool use khud khol leta hai.
- Node.js LTS — sirf developer ke liye, build karne ke liye. Exe chalane ke liye Node.js nahi chahiye.
- JPG photos in, JPG out. Preset files `.xmp` (Lightroom / Camera Raw presets).

## Install / Build (Windows par — apne PC par)

1. Is project ko GitHub se download karo (ya ZIP extract karo).
2. `build-windows.bat` par **double-click** karo — Node.js check, `npm install`, phir installer banayega.
3. `app\dist\ZubiiBatchPresetTool-Setup-1.2.3.exe` par double-click karke install karo.
4. Pehli dafa kholo: upar `✓ Photoshop connected — 2023 (24.7)` jaisa dikhna chahiye (tumhare version ke mutabiq). Agar `✕ Photoshop nahi mila` dikhe to Photoshop install karo aur "Dobara check karo" dabao.

Developer run: `cd app && npm install && npm start`.

## EXE GitHub Actions se banana (v1.2.3)

**Imaandaari se pehle ye samajh lo: sirf source GitHub par dalne se exe khud nahi banta.** Exe banane ke liye ya to GitHub Actions wala workflow chalao, ya apne Windows PC par `build-windows.bat` chalao. Linux VM par Windows exe nahi ban sakta.

Workflow file maujood hai: `.github/workflows/build-windows.yml` — `windows-latest` runner, Node 20, `app` folder me `npm install`, phir `npm run dist:win`, bani hui exe artifact ke tor par upload, aur tag `v*` par GitHub Release bhi (exe + `latest.yml` attach). Workflow me npm cache jaan boojh kar nahi lagaya — pehle SA tool me lockfile ki wajah se cache wala step fail hota tha.

**Step-by-step:**

1. GitHub par repo banao: `shoaibulhassan544-ops/zubii-batch-preset-tool` (naam `app/src/main/config.js` aur `app/electron-builder.yml` ke `publish` section me bhi yahi hai).
2. Source push karo.
3. Tag lagao: `git tag v1.2.3` phir `git push origin v1.2.3` — is se workflow chalega aur Release ban jayegi. (Tag ke baghair bhi Actions tab → "Build Windows EXE" → Run workflow se chala sakte ho, phir exe Artifacts se download karni hogi.)
4. Actions tab me build dekho — green ho to Release kholo aur `ZubiiBatchPresetTool-Setup-1.2.3.exe` download karo.

**Agar Actions disabled hui to:** user ke GitHub account par pehle SA tool ke waqt Actions disabled mili thi ("Actions has been disabled for this user"). Agar is repo par bhi Actions disabled hui to workflow chalega hi nahi aur GitHub se exe nahi banegi — us surat me apne Windows PC par `build-windows.bat` chalana hi rasta hai.

## Updates — GitHub se (licence ke baghair)

- App khulte hi GitHub Releases check karta hai; nayi version mile to download poochta hai.
- **Setup (aik dafa, developer ke liye):** upar wale Actions steps se `v1.2.3` tag par Release ban jayegi — us me exe + `latest.yml` attach honge. Bas — users ke app me **Check for updates** ab us release ko dhoondhega. Koi licence server, koi key, kuch nahi.
- Manual: app me **Check for updates** button, ya GitHub Releases page kholo.

## Photoshop me preset kaise lagta hai (technical, imaandaari se)

Adobe ki taraf se **koi official scripting API nahi** hai jo `.xmp` preset ko seedha apply kare. Is liye tool ye tareeqa istemal karta hai (`scripts/apply-preset.jsx`):

1. Har photo ki **temp copy** banayi jati hai; preset `.xmp` us ke saath Camera Raw settings sidecar (`<name>.xmp`) ki tarah likha jata hai — `.xmp` presets aur Camera Raw sidecars aik hi `crs:` settings namespace istemal karte hain.
2. Temp copy **Camera Raw ke zariye kholi** jati hai (`CameraRawOpenOptions`, settings = CUSTOM) taake sidecar settings apply hon.
3. Agar kisi Photoshop build me ye rasta settings ignore kare, to fallback hai: **Camera Raw Filter** ActionManager se XMP packet ke saath.
4. Phir optional resize, JPG save (quality setting ke mutabiq), close. Temp files delete.

### Limitations (saaf saaf)

- **Test one photo pehle zaroor karo.** Sidecar tareeqa standard adjustment presets (exposure, white balance, tone curve, HSL, clarity, vibrance, sharpness) ke liye kaam karta hai — aur ye standard settings har supported version par chalti hain.
- Jo preset **tumhare Camera Raw se nayi** features istemal kare (maslan AI masking, Lens Blur), wo hisse poori tarah apply nahi honge — tool batch se pehle warning dikhata hai, block nahi karta. Ye Adobe ki limitation hai, tool ka bug nahi.
- Photoshop install aur licensed hona zaroori hai; tool Photoshop ke baghair preset apply nahi kar sakta.
- Supported range CC 2019 (20.x) se 2025 (26.x) tak hai. 20.x se purana untested, CS6 aur us se purana supported nahi.
- Windows-only hai (COM automation ki wajah se) — Mac par nahi chalega. Linux VM par Windows installer / Photoshop test nahi ho sakta.

## Test (bina Photoshop ke)

```bat
cd app
npm test
```

Ye `scripts/self-test.js` chalata hai: output naming, XMP parsing, batch args, JSX/PowerShell sanity, Photoshop version parsing (20.x, 24.7, 25.3, 26.0), compatibility warning (naya preset + purana Photoshop = warning, purana preset + naya Photoshop = no warning), GitHub Actions workflow file, Zubii naam (package.json productName, config githubRepo), aur ye bhi check karta hai ke project me **koi licence code nahi** hai aur koi hard version lock baqi nahi hai.

## Project structure

```
zubii-batch-preset-tool/
├── build-windows.bat            # Windows build (double-click)
├── README.md
├── previews/ui-mockup.webp      # UI mockup (aisa dikhega)
├── .github/workflows/
│   └── build-windows.yml        # GitHub Actions: Windows exe + Release
├── scripts/
│   ├── apply-preset.jsx         # Photoshop ExtendScript (preset apply)
│   ├── run-batch.ps1            # Photoshop COM runner (PowerShell)
│   └── self-test.js             # npm test
└── app/
    ├── package.json             # electron + electron-builder + electron-updater
    ├── electron-builder.yml     # NSIS installer + GitHub publish
    ├── build/icon.ico / icon.png
    └── src/
        ├── main/main.js         # Electron main + IPC
        ├── main/photoshop.js    # COM runner, version detect, compatibility, naming, XMP parse
        ├── main/auto-pick.js    # Auto Pick Preset engine (v1.1.0)
        ├── main/updater.js      # GitHub Releases update check
        ├── main/config.js       # version + GitHub repo + Photoshop version map
        ├── preload/preload.js   # safe renderer bridge
        └── renderer/            # UI (index.html, css/styles.css, js/app.js)
```

## Version

**v1.2.3** — Batch 0% fix (asal wajah: Photoshop ka COM adhoora hai — DoJavaScriptFile method nahi mili, is liye COM dobara try karna bekar hai): fallback chain — DoJavaScript ek dafa, phir JSX seedha Photoshop.exe command line se (primary fallback); fatal error progress.json + UI me Roman Urdu me (WriteErrorException tail nahi); update flow ab MetaBox jaisa bottom-right popup (Roman Urdu, download progress usi me).
**v1.2.2** — Photoshop auto-detect mazboot: Adobe folders scan (Program Files + x86, har "Adobe Photoshop*" folder), registry HKLM + HKCU + WOW6432Node + App Paths, exact version exe FileVersion se, UI me version + path dono, na milne par diagnostic detail. Header dobara: gold hata diya, signature-style bold script "Z" (terracotta) + bold serif title (gehra brown).
**v1.2.1** — Photoshop "nahi mila" fix (COM fallback: registry + install paths), "Dobara check karo" button, JSX temp-copy fix (UnauthorizedAccessException khatam), Photoshop khulna/band hona band (version cache, kabhi Quit nahi), updater doosre repo par (shoaibulhassan544-ops), VIP gold title + bara "Z" logo, footer credit + Support (WhatsApp) button.
**v1.2.0** — Har Photoshop version support (CC 2019 / 20.x se 2025 / 26.x), version detection + compatibility warning, GitHub Actions workflow (Windows exe + Release).
**v1.1.0** — Auto Pick Preset added (per-photo analysis + manual override).
**v1.0.0** — pehla version. Free forever, Zubii Photography.
