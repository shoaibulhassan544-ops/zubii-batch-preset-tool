@echo off
REM Zubii Batch Preset Tool - Windows build (double-click karo, bas)
REM FREE tool - koi licence nahi, koi key nahi. Zubii Photography.
REM Updates GitHub Releases se aati hain (electron-builder publish: github).

REM STEP 1: Kya ye file poore project ke andar hai?
if not exist "%~dp0app\package.json" (
  echo.
  echo  YE FILE AKELI KAAM NAHI KAREGI!
  echo.
  echo  Lagta hai tumne SIRF ye .bat file download ki hai.
  echo  Poora project chahiye, ye karo:
  echo.
  echo   1. https://github.com/ShoaibAzeez/zubii-batch-preset-tool kholo
  echo   2. Hare "Code" button par click karo, phir "Download ZIP" dabao
  echo   3. ZIP file ko unzip / extract karo
  echo   4. Jo folder nikle, USKE ANDAR ye build-windows.bat hogi -
  echo      us par double-click karo
  echo.
  pause
  exit /b 1
)

cd /d "%~dp0app"

REM STEP 2: Kya Node.js installed hai?
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js NAHI MILA!
  echo.
  echo  Pehle https://nodejs.org kholo
  echo  Wahan se Node.js LTS download karke install karo
  echo  (bas Next Next dabate jao).
  echo  Phir ye file DOBARA chalao.
  echo.
  pause
  exit /b 1
)

echo.
echo Node.js mil gaya! Ab zaroori files download ho rahi hain...
echo (Pehli dafa 3-5 minute lag sakte hain - ghabrana nahi, wait karo)
echo.
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo  Files download FAIL ho gayi!
  echo  Apna internet check karo aur ye file dobara chalao.
  echo.
  pause
  exit /b 1
)

echo.
echo Ab installer ban raha hai... 5-10 minute lagega.
echo Ye window BAND NA KARO, bas wait karo.
echo.
call npm run dist:win
if errorlevel 1 (
  echo.
  echo  Build FAIL ho gaya! Upar jo error likha hai uska screenshot
  echo  mujhe bhejo, main theek kar dunga.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  HO GAYA! Mubarak ho!
echo.
echo  app\dist folder me ZubiiBatchPresetTool-Setup.exe
echo  ban gaya hai. Us par double-click karke install karo.
echo  Pehle use se pehle: Adobe Photoshop CC 2019 (20.x) ya us se naya install hona chahiye.
echo ============================================================
echo.
pause
