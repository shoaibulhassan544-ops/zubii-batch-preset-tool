// Zubii Batch Preset Tool — shared config.
// FREE TOOL: no licence system anywhere in this project, on purpose.
// Updates come from GitHub Releases (see updater.js). Change the repo
// here AND in electron-builder.yml `publish` when the repo is created.
//
// PHOTOSHOP SUPPORT: har version — CC 2019 (20.x) se 2025 (26.x) tak.
// COM ProgID `Photoshop.Application` version-independent hai, is liye
// tool kisi bhi installed Photoshop se jud jata hai. Version sirf
// dikhane aur compatibility warning ke liye pehchana jata hai — koi
// version lock nahi hai.
module.exports = {
  appName: 'Zubii Batch Preset Tool',
  version: '1.2.1',
  githubOwner: 'shoaibulhassan544-ops',
  githubRepo: 'zubii-batch-preset-tool',
  photoshopProgId: 'Photoshop.Application',
  // Photoshop major version -> saal / Camera Raw (ACR) mapping.
  // ACR = major - 9 (20 -> 11, 21 -> 12, ..., 26 -> 17).
  // 20 se purana (19.x / CC 2018 aur us se pehle) untested hai;
  // CS6 aur us se purana supported nahi (Camera Raw Filter fallback nahi).
  minSupportedMajor: 20,
  maxTestedMajor: 26,
  photoshopVersions: {
    20: { year: 'CC 2019', label: '2019', acr: 11 },
    21: { year: '2020', label: '2020', acr: 12 },
    22: { year: '2021', label: '2021', acr: 13 },
    23: { year: '2022', label: '2022', acr: 14 },
    24: { year: '2023', label: '2023', acr: 15 },
    25: { year: '2024', label: '2024', acr: 16 },
    26: { year: '2025', label: '2025', acr: 17 },
  },
};
