# Runs the Photoshop batch script and reports failures.
# Usage: run-batch.ps1 -Jsx <path to apply-preset.jsx> -Args <path to batch-args.json> [-PhotoshopExe <path to Photoshop.exe>]
# The JSX reads its args path from the ARGS_PATH line inside itself, so
# this script rewrites that line before calling Photoshop. Photoshop must
# be installed on this Windows PC (Photoshop CC 2019 / 20.x se 2025 / 26.x
# tak — har version; COM ProgID Photoshop.Application version-independent hai).
# AHAM: -Jsx me jo file milti hai wo TEMP COPY hoti hai (workDir me) —
# install folder (Program Files) read-only hai, is liye asal JSX ko
# rewrite karne par UnauthorizedAccessException aata tha. Is copy ko
# rewrite karna hamesha allowed hai.
#
# ASAL MASLA (user ke PC par, 2026-11-02): COM object BAN jata hai
# (New-Object kamyab), lekin us System.__ComObject me DoJavaScriptFile
# method HI NAHI HAI ("does not contain a method named
# 'DoJavaScriptFile'") — Photoshop ka COM adhoora/kharab register hai.
# Is liye batch 0% par marta tha. COM dobara try karne se kuch nahi
# hoga — wahi adhoora object milega. Is liye fallback chain ye hai:
#   1. COM se DoJavaScriptFile try karo.
#   2. Method na mile to DoJavaScript (string wala method) ek dafa try karo.
#   3. Phir bhi na chale to JSX ko seedha Photoshop.exe ko argument de kar
#      chalao (PRIMARY fallback — Photoshop .jsx file ko execute karta hai),
#      aur progress.json poll karke mukammal hone ka intezar karo.
#   4. COM object hi na bane to pehle Photoshop.exe se Photoshop kholo,
#      phir COM dobara try karo (30 second tak).
# Har step ka result log me Roman Urdu me likha jata hai. Koi bhi fatal
# error progress.json me `fatal` field ke saath likhi jati hai, aur
# fallback ki wajah `note` field me — taake UI 0% par atka na rahe, asal
# wajah dikhaye. PowerShell ka error cmdlet istemal NAHI hota (us se log me sirf
# WriteErrorException ki tail lines aati thin, asal message nahi).
param(
  [Parameter(Mandatory = $true)][string]$Jsx,
  [Parameter(Mandatory = $true)][string]$Args,
  [string]$PhotoshopExe = ""
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Jsx)) { Write-Host "GALTI: JSX file nahi mili: $Jsx"; exit 2 }
if (-not (Test-Path $Args)) { Write-Host "GALTI: Args file nahi mili: $Args"; exit 2 }

# Args JSON se progress file + kul photos nikalo (fatal/note likhne ke liye).
$ProgressFile = $null
$TotalPhotos = 0
try {
  $argsObj = Get-Content -Raw -LiteralPath $Args | ConvertFrom-Json
  $ProgressFile = $argsObj.progressFile
  $TotalPhotos = [int]$argsObj.files.Count
} catch {
  Write-Host "GALTI: Args file parh nahi saka: $($_.Exception.Message)"
  exit 2
}

function Write-ProgressField($name, $value) {
  if (-not $ProgressFile) { return }
  try {
    $st = $null
    if (Test-Path $ProgressFile) { $st = Get-Content -Raw -LiteralPath $ProgressFile | ConvertFrom-Json }
    if (-not $st) { $st = [pscustomobject]@{ total = $TotalPhotos; done = 0; ok = 0; failed = 0; current = ''; errors = @() } }
    $st | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force
    $st | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ProgressFile -Encoding UTF8
  } catch { }
}

function Write-FatalProgress($msg) {
  Write-ProgressField 'fatal' $msg
  try {
    $st = Get-Content -Raw -LiteralPath $ProgressFile | ConvertFrom-Json
    if (-not $st.errors) { $st | Add-Member -NotePropertyName 'errors' -NotePropertyValue @() -Force }
    $st.errors = @(@{ file = ''; error = $msg }) + @($st.errors)
    $st | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ProgressFile -Encoding UTF8
  } catch { }
}

# Fallback ki wajah UI tak — diagnostics ke liye (maslan COM adhoora hai).
function Write-ProgressNote($msg) { Write-ProgressField 'note' $msg }

function Fail($msg, $code) {
  Write-Host "BATCH FAIL: $msg"
  Write-FatalProgress $msg
  exit $code
}

# Point the JSX at this run's args file (first line matching ARGS_PATH).
$content = Get-Content -Raw -LiteralPath $Jsx
$escaped = $Args -replace '\\', '\\'
$content = $content -replace 'var ARGS_PATH = ".*";', ('var ARGS_PATH = "' + $escaped + '";')
Set-Content -LiteralPath $Jsx -Value $content -Encoding UTF8

# COM se script chalao. Returns @{ Ok; Stage; Error; MethodMissing }.
# Stage: 'create' (COM object hi nahi bana) ya 'run' (object bana, script/method fail).
# MethodMissing = COM object me DoJavaScriptFile method hi nahi hai —
# ye wohi adhoora COM hai jo user ke PC par hai; is par dobara COM try
# karna bekar hai, seedha Photoshop.exe wala rasta lena hai.
function Try-ComRun {
  try {
    $ps = New-Object -ComObject Photoshop.Application
  } catch {
    return @{ Ok = $false; Stage = 'create'; Error = $_.Exception.Message; MethodMissing = $false }
  }
  try {
    $ps.DoJavaScriptFile($Jsx)
    return @{ Ok = $true; Stage = 'ok'; Error = ''; MethodMissing = $false }
  } catch {
    $errMsg = $_.Exception.Message
    if ($errMsg -like "*does not contain a method named 'DoJavaScriptFile'*") {
      Write-Host 'Photoshop ka COM adhoora hai (DoJavaScriptFile method nahi mili) — pehle DoJavaScript try kar raha hun...'
      Write-ProgressNote 'Photoshop ka COM adhoora hai (DoJavaScriptFile method nahi mili) — script Photoshop.exe se chalai ja rahi hai.'
      try {
        $jsxText = Get-Content -Raw -LiteralPath $Jsx
        $ps.DoJavaScript($jsxText)
        return @{ Ok = $true; Stage = 'ok'; Error = ''; MethodMissing = $true }
      } catch {
        return @{ Ok = $false; Stage = 'run'; Error = $_.Exception.Message; MethodMissing = $true }
      }
    }
    return @{ Ok = $false; Stage = 'run'; Error = $errMsg; MethodMissing = $false }
  }
}

# Photoshop.exe dhoondo: pehle diya hua path, phir App Paths registry,
# phir aam install paths.
function Find-PhotoshopExe {
  if ($PhotoshopExe -and (Test-Path $PhotoshopExe)) { return $PhotoshopExe }
  try {
    $ap = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Photoshop.exe' -ErrorAction SilentlyContinue).'(default)'
    if ($ap -and (Test-Path $ap)) { return $ap }
  } catch { }
  $known = @(
    'C:\Program Files\Adobe\Adobe Photoshop 2025\Photoshop.exe',
    'C:\Program Files\Adobe\Adobe Photoshop 2024\Photoshop.exe',
    'C:\Program Files\Adobe\Adobe Photoshop 2023\Photoshop.exe',
    'C:\Program Files\Adobe\Adobe Photoshop 2022\Photoshop.exe',
    'C:\Program Files\Adobe\Adobe Photoshop 2021\Photoshop.exe',
    'C:\Program Files\Adobe\Adobe Photoshop 2020\Photoshop.exe',
    'C:\Program Files\Adobe\Adobe Photoshop CC 2019\Photoshop.exe',
    'C:\Program Files\Adobe\Adobe Photoshop 2019\Photoshop.exe'
  )
  foreach ($k in $known) { if (Test-Path $k) { return $k } }
  return $null
}

function Test-PhotoshopRunning {
  return $null -ne (Get-Process 'Photoshop' -ErrorAction SilentlyContinue | Select-Object -First 1)
}

# --- Step 1: COM se DoJavaScriptFile -------------------------------------
Write-Host 'Photoshop COM se script chala raha hun...'
$try1 = Try-ComRun
if ($try1.Ok) { Write-Host 'Batch mukammal — Photoshop COM se chala.'; exit 0 }
if ($try1.Stage -eq 'run' -and -not $try1.MethodMissing) {
  # Script khud fail hui (COM theek hai) — fallback ka faida nahi.
  Fail ("Photoshop script chali nahi: $($try1.Error)") 4
}

$skipToExe = $false
if ($try1.MethodMissing) {
  Write-Host 'COM adhoora hai — COM dobara try karna bekar hai, seedha Photoshop.exe se script chala raha hun...'
  $skipToExe = $true
}

# --- Step 2: COM object hi na bane to Photoshop.exe launch + COM retry ---
if (-not $skipToExe) {
  Write-Host "Photoshop COM object nahi bana ($($try1.Error)) — Photoshop.exe se khol kar dobara try karta hun..."
  $exe = Find-PhotoshopExe
  if (-not $exe) {
    Fail 'Photoshop COM object nahi bana aur Photoshop.exe bhi kahin nahi mila — Photoshop CC 2019 (20.x) ya us se naya install karo, ya "Photoshop.exe chuno" se khud path do.' 3
  }
  Write-Host "Photoshop.exe se Photoshop khol raha hun: $exe"
  try {
    if (-not (Test-PhotoshopRunning)) { Start-Process -FilePath $exe }
  } catch {
    Fail ("Photoshop.exe launch nahi ho saka: $($_.Exception.Message)") 3
  }
  # Photoshop khulne ka intezar (30 second tak), har 5 second COM retry.
  $comOk = $false
  for ($i = 0; $i -lt 6; $i++) {
    Start-Sleep -Seconds 5
    if (Test-PhotoshopRunning) { Write-Host 'Photoshop khul gaya — COM dobara try kar raha hun...' }
    $retry = Try-ComRun
    if ($retry.Ok) { $comOk = $true; break }
    if ($retry.Stage -eq 'run' -and -not $retry.MethodMissing) {
      Fail ("Photoshop script chali nahi: $($retry.Error)") 4
    }
    if ($retry.MethodMissing) {
      Write-Host 'COM adhoora hai — seedha Photoshop.exe se script chala raha hun...'
      break
    }
  }
  if ($comOk) { Write-Host 'Batch mukammal — Photoshop.exe launch ke baad COM se chala.'; exit 0 }
  $exe = Find-PhotoshopExe
  if (-not $exe) {
    Fail 'Photoshop COM se nahi khula aur Photoshop.exe bhi nahi mila.' 3
  }
} else {
  $exe = Find-PhotoshopExe
  if (-not $exe) {
    Fail 'Photoshop ka COM adhoora hai aur Photoshop.exe bhi kahin nahi mila — Photoshop.exe ka path "Photoshop.exe chuno" se do.' 3
  }
}

# --- Step 3 (PRIMARY fallback): JSX seedha Photoshop.exe ko argument -----
# Photoshop .jsx file ko execute karta hai (chahe pehle se khula ho ya
# abhi khula ho). Script progress.json me likhti hai — usay poll karo.
Write-Host "Script Photoshop.exe se chala raha hun: $exe"
try {
  Start-Process -FilePath $exe -ArgumentList ('"' + $Jsx + '"')
} catch {
  Fail ("Photoshop.exe se script launch nahi ho saki: $($_.Exception.Message)") 3
}
$timeoutSec = [Math]::Min(1800, 120 + $TotalPhotos * 90)
$deadline = (Get-Date).AddSeconds($timeoutSec)
$lastDone = -1
$lastChange = Get-Date
$lastLoggedDone = -1
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  $st = $null
  try {
    if (Test-Path $ProgressFile) { $st = Get-Content -Raw -LiteralPath $ProgressFile | ConvertFrom-Json }
  } catch { }
  if ($st) {
    if ($st.fatal) { Fail ("Photoshop script fail: $($st.fatal)") 4 }
    if ($st.errors -and ($st.errors | Where-Object { $_.error -like 'Fatal:*' })) {
      Fail ("Photoshop script fail: $(($st.errors | Where-Object { $_.error -like 'Fatal:*' } | Select-Object -First 1).error)") 4
    }
    $done = [int]$st.done
    if ($done -ne $lastDone) { $lastDone = $done; $lastChange = Get-Date }
    if ($done -ge $TotalPhotos -and $TotalPhotos -gt 0) {
      Write-Host "Batch mukammal — Photoshop.exe se script chali ($done of $TotalPhotos photos)."
      exit 0
    }
    if ($done -ne $lastLoggedDone -and $done -gt 0) {
      $lastLoggedDone = $done
      Write-Host "Script chal rahi hai — $done of $TotalPhotos photos ho gayin..."
    }
  }
  # 120 second se progress me koi tabdeeli nahi = script atki hui hai.
  if (((Get-Date) - $lastChange).TotalSeconds -gt 120) {
    Fail 'Photoshop ne script 120 second se aage nahi chalayi — script shuru hi nahi hui ya atak gayi. Photoshop band karke "Test one photo" se dobara check karo.' 5
  }
  # Photoshop band ho gaya aur kaam adhoora hai = fail.
  if (-not (Test-PhotoshopRunning) -and $lastDone -lt $TotalPhotos) {
    # Ho sakta hai Photoshop abhi start ho raha ho (pehle 30 second).
    if (((Get-Date) - $lastChange).TotalSeconds -gt 30) {
      Fail 'Photoshop batch ke doran band ho gaya — kaam adhoora reh gaya.' 5
    }
  }
}
Fail ("Batch waqt par mukammal nahi hua ($timeoutSec second) — $lastDone of $TotalPhotos photos hui thin.") 5
