# Installs the darkroom command on Windows, with its own Node.js: nothing else needs to be installed.
#
#   irm https://raw.githubusercontent.com/ajgassner/darkroom/main/install.ps1 | iex
#
# Run it again (or "darkroom update") to update. Optional environment variables:
#   DARKROOM_DIR     where darkroom and its Node.js are installed (default: ~\.darkroom)
#   DARKROOM_HOME    where your data lives: .env, refs\, voices\, out\ (default: ~\darkroom)
#   DARKROOM_REF     branch or tag to install (default: the latest release, or main before the first one)
#   DARKROOM_SOURCE  URL or local path of a source zip, overrides DARKROOM_REF (e.g. for testing)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is very slow with the progress bar

$NodeMajor = 26
$InstallDir = if ($env:DARKROOM_DIR) { $env:DARKROOM_DIR } else { Join-Path $HOME '.darkroom' }
$DataDir = if ($env:DARKROOM_HOME) { $env:DARKROOM_HOME } else { Join-Path $HOME 'darkroom' }
$Ref = $env:DARKROOM_REF
if (-not $Ref -and -not $env:DARKROOM_SOURCE) {
  try {
    $Ref = (Invoke-RestMethod 'https://api.github.com/repos/ajgassner/darkroom/releases/latest').tag_name
  } catch {
    $Ref = $null # no release yet
  }
}
if (-not $Ref) { $Ref = 'main' }
$Source = if ($env:DARKROOM_SOURCE) { $env:DARKROOM_SOURCE } else { "https://github.com/ajgassner/darkroom/archive/$Ref.zip" }

function Say($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { 'x64' }
  'ARM64' { 'arm64' }
  default { throw "Unsupported processor $($env:PROCESSOR_ARCHITECTURE)" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) "darkroom-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force $tmp, $InstallDir, $DataDir | Out-Null

try {
  # Node.js: latest release of the major version, verified against the official checksums
  Say "Downloading Node.js $NodeMajor (win-$arch)"
  $nodeBase = "https://nodejs.org/dist/latest-v$NodeMajor.x"
  $sums = (Invoke-WebRequest "$nodeBase/SHASUMS256.txt" -UseBasicParsing).Content
  $match = [regex]::Match($sums, "([0-9a-f]{64})\s+(node-v[0-9.]+-win-$arch\.zip)")
  if (-not $match.Success) { throw "No Node.js $NodeMajor build for win-$arch" }
  $nodeZip = Join-Path $tmp $match.Groups[2].Value
  Invoke-WebRequest "$nodeBase/$($match.Groups[2].Value)" -OutFile $nodeZip -UseBasicParsing
  if ((Get-FileHash $nodeZip -Algorithm SHA256).Hash -ne $match.Groups[1].Value.ToUpper()) {
    throw "Checksum mismatch for $($match.Groups[2].Value)"
  }
  $nodeDir = Join-Path $InstallDir 'node'
  if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
  Expand-Archive $nodeZip -DestinationPath $tmp
  Move-Item (Join-Path $tmp ($match.Groups[2].Value -replace '\.zip$', '')) $nodeDir
  $env:Path = "$nodeDir;$env:Path"

  # darkroom itself (your data lives in DataDir, so replacing the app keeps it)
  Say "Downloading darkroom ($Ref)"
  $srcZip = Join-Path $tmp 'darkroom.zip'
  if (Test-Path $Source) { Copy-Item $Source $srcZip } else { Invoke-WebRequest $Source -OutFile $srcZip -UseBasicParsing }
  $srcDir = Join-Path $tmp 'src'
  Expand-Archive $srcZip -DestinationPath $srcDir
  $appDir = Join-Path $InstallDir 'app'
  if (Test-Path $appDir) { Remove-Item -Recurse -Force $appDir }
  Move-Item (Get-ChildItem $srcDir -Directory | Select-Object -First 1).FullName $appDir

  Say 'Installing dependencies (this takes a few minutes)'
  Push-Location $appDir
  try {
    $pnpmVersion = & "$nodeDir\node.exe" -p "require('./package.json').packageManager.split('@')[1]"
    & "$nodeDir\npm.cmd" exec --yes --silent -- "pnpm@$pnpmVersion" install --frozen-lockfile --reporter=silent
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
    Say 'Building the web UI'
    & "$nodeDir\npm.cmd" exec --yes --silent -- "pnpm@$pnpmVersion" build | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Building the web UI failed' }
  } finally {
    Pop-Location
  }

  # The command itself: runs the CLI with darkroom's own Node.js and your data folder.
  # "darkroom uninstall" is handled here, since it removes the app the CLI runs from:
  # it drops the PATH entry, then deletes the install folder after the batch file has exited ((goto) trick).
  $binDir = Join-Path $InstallDir 'bin'
  New-Item -ItemType Directory -Force $binDir | Out-Null
  Set-Content -Encoding ASCII (Join-Path $binDir 'darkroom.cmd') @"
@echo off
setlocal
if /i "%~1"=="uninstall" goto uninstall
rem One block: cmd parses it completely before the installer rewrites this file
if /i "%~1"=="update" (set "DARKROOM_DIR=$InstallDir" & set "DARKROOM_HOME=$DataDir" & powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/ajgassner/darkroom/main/install.ps1 | iex" && exit /b 0 || exit /b 1)
if not defined DARKROOM_HOME set "DARKROOM_HOME=$DataDir"
"$nodeDir\node.exe" "$appDir\apps\cli\src\cli.ts" %*
exit /b %errorlevel%
:uninstall
powershell -NoProfile -Command "`$p = [Environment]::GetEnvironmentVariable('Path', 'User'); [Environment]::SetEnvironmentVariable('Path', ((`$p -split ';') | Where-Object { `$_ -and `$_ -ne '$binDir' }) -join ';', 'User')"
echo darkroom is uninstalled. Your data is still in $DataDir; delete that folder if you don't need it anymore.
(goto) 2>nul & rmdir /s /q "$InstallDir"
"@

  # Put the command on the user's PATH
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (($userPath -split ';') -contains $binDir)) {
    [Environment]::SetEnvironmentVariable('Path', (@($binDir, $userPath) | Where-Object { $_ }) -join ';', 'User')
  }

  # OpenRouter API key, asked once (only with a real console; the web UI asks for it too)
  $envFile = Join-Path $DataDir '.env'
  $hasKey = (Test-Path $envFile) -and (Select-String -Path $envFile -Pattern '^OPENROUTER_API_KEY=.' -Quiet)
  if (-not $hasKey -and -not [Console]::IsInputRedirected) {
    $key = Read-Host "`nOpenRouter API key (https://openrouter.ai/settings/keys), or Enter to add it later"
    if ($key) {
      Add-Content -Encoding ASCII $envFile "OPENROUTER_API_KEY=$key"
      $hasKey = $true
    }
  }

  Write-Host ''
  Say 'darkroom is installed'
  Write-Host "    app:  $InstallDir"
  Write-Host "    data: $DataDir"
  if (-not $hasKey) { Write-Host "    Add your key to ${envFile}: OPENROUTER_API_KEY=sk-or-v1-..." }
  Write-Host ''
  Write-Host 'Open a new terminal, then:'
  Write-Host '    darkroom start      web UI on http://localhost:5177'
  Write-Host '    darkroom --help     all commands'
  Write-Host '    darkroom update     update to the latest release (keeps your data)'
  Write-Host '    darkroom uninstall  remove darkroom (keeps your data)'
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
