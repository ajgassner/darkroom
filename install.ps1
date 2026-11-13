# Installs the darkroom command on Windows, with its own Node.js: nothing else needs to be installed.
#
#   irm https://raw.githubusercontent.com/ajgassner/darkroom/main/install.ps1 | iex
#
# Run it again (or "darkroom update") to update. Optional environment variables:
#   DARKROOM_DIR     where darkroom and its Node.js are installed (default: ~\.darkroom)
#   DARKROOM_HOME    where your data lives: .env, refs\, voices\, out\ (default: ~\darkroom, or the folder
#                    of the existing installation)
#   DARKROOM_REF     branch or tag to install (default: the latest release, or main before the first one)
#   DARKROOM_SOURCE  URL or local path of a source zip, overrides DARKROOM_REF (e.g. for testing)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is very slow with the progress bar

$NodeMajor = 26
# Absolute paths: the command must work from any folder ("darkroom update" passes its own folder as bin\..)
function Get-FullPath($path) {
  [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($path))
}
$InstallDir = Get-FullPath $(if ($env:DARKROOM_DIR) { $env:DARKROOM_DIR } else { Join-Path $HOME '.darkroom' })
# An existing installation keeps its data folder in bin\darkroom.env (see below)
$commandEnvFile = Join-Path $InstallDir 'bin\darkroom.env'
$DataDir = if ($env:DARKROOM_HOME) {
  $env:DARKROOM_HOME
} elseif ((Test-Path -LiteralPath $commandEnvFile) -and
  ([IO.File]::ReadAllText($commandEnvFile) -match "(?m)^DARKROOM_HOME=(['``])(.*)\1\r?$")) {
  $Matches[2]
} else {
  Join-Path $HOME 'darkroom'
}
$DataDir = Get-FullPath $DataDir
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

# An update keeps the previous node\ and app\ as node.old\ and app.old\ until the new ones are built,
# and puts them back if anything fails, so a failed update leaves the installed darkroom working.
# Building happens in place, because the installed packages contain absolute paths (pnpm uses junctions).
# Staging inside InstallDir keeps every move on one drive.
function Restore-Previous($parts) {
  foreach ($part in $parts) {
    $dir = Join-Path $InstallDir $part
    if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
    if (Test-Path -LiteralPath "$dir.old") { Rename-Item -LiteralPath "$dir.old" $part }
  }
}
$swapped = @()
$staging = Join-Path $InstallDir 'staging'
$tmp = Join-Path ([IO.Path]::GetTempPath()) "darkroom-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force $tmp, $InstallDir, $DataDir | Out-Null

try {
  # A previous update that was interrupted left its backups behind: they are the working version
  foreach ($part in 'node', 'app') {
    if (Test-Path -LiteralPath (Join-Path $InstallDir "$part.old")) { Restore-Previous $part }
  }
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
  New-Item -ItemType Directory -Force $staging | Out-Null

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
  $nodeZipDir = Join-Path $staging 'node-zip'
  Expand-Archive $nodeZip -DestinationPath $nodeZipDir
  Move-Item -LiteralPath (Join-Path $nodeZipDir ($match.Groups[2].Value -replace '\.zip$', '')) (Join-Path $staging 'node')

  # darkroom itself (your data lives in DataDir, so replacing the app keeps it)
  Say "Downloading darkroom ($Ref)"
  $srcZip = Join-Path $tmp 'darkroom.zip'
  if (Test-Path $Source) { Copy-Item $Source $srcZip } else { Invoke-WebRequest $Source -OutFile $srcZip -UseBasicParsing }
  $srcDir = Join-Path $staging 'src'
  Expand-Archive $srcZip -DestinationPath $srcDir
  $srcRoot = Get-ChildItem -LiteralPath $srcDir -Directory | Select-Object -First 1
  if (-not $srcRoot -or -not (Test-Path -LiteralPath (Join-Path $srcRoot.FullName 'package.json'))) {
    throw 'The darkroom download is incomplete'
  }
  Move-Item -LiteralPath $srcRoot.FullName (Join-Path $staging 'app')

  # Everything is downloaded: swap in the new version, keeping the previous one until it is built.
  # Renaming fails while darkroom is running (Windows locks node.exe); nothing has changed then.
  foreach ($part in 'node', 'app') {
    $dir = Join-Path $InstallDir $part
    if (Test-Path -LiteralPath $dir) { Rename-Item -LiteralPath $dir "$part.old" }
    $swapped += $part
    Move-Item -LiteralPath (Join-Path $staging $part) $dir
  }
  $nodeDir = Join-Path $InstallDir 'node'
  $appDir = Join-Path $InstallDir 'app'
  $env:Path = "$nodeDir;$env:Path"

  Say 'Installing dependencies (this takes a few minutes)'
  Push-Location -LiteralPath $appDir
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
  # darkroom.cmd contains no paths: it finds node\ and app\ from its own folder (%~dp0), so non-ASCII
  # characters in the install path don't matter (cmd.exe decodes batch files with the console code page).
  # The data folder is in darkroom.env (UTF-8), which Node.js loads with --env-file; a DARKROOM_HOME that
  # is already set takes precedence. "darkroom update" clears it, so the installer reads it from there.
  # "darkroom uninstall" is handled here, since it removes the app the CLI runs from: uninstall.ps1 drops
  # the PATH entry, then the batch file deletes the install folder after it has exited ((goto) trick).
  $binDir = Join-Path $InstallDir 'bin'
  New-Item -ItemType Directory -Force $binDir | Out-Null
  $utf8 = New-Object Text.UTF8Encoding $false
  $utf8Bom = New-Object Text.UTF8Encoding $true # Windows PowerShell reads scripts without a BOM as ANSI
  $quote = if (-not $DataDir.Contains("'")) { "'" } elseif (-not $DataDir.Contains('`')) { '`' } else {
    throw "The data folder $DataDir must not contain both ' and ``"
  }
  [IO.File]::WriteAllText((Join-Path $binDir 'darkroom.env'), "DARKROOM_HOME=$quote$DataDir$quote`n", $utf8)
  $cmd = @'
@echo off
setlocal
if /i "%~1"=="uninstall" goto uninstall
rem One block: cmd parses it completely before the installer rewrites this file
if /i "%~1"=="update" (set "DARKROOM_DIR=%~dp0.." & set "DARKROOM_HOME=" & powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/ajgassner/darkroom/main/install.ps1 | iex" && exit /b 0 || exit /b 1)
"%~dp0..\node\node.exe" --env-file="%~dp0darkroom.env" "%~dp0..\app\apps\cli\src\cli.ts" %*
exit /b %errorlevel%
:uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" || exit /b 1
for %%i in ("%~dp0..") do set "install_dir=%%~fi"
(goto) 2>nul & rmdir /s /q "%install_dir%"
'@
  # CRLF: cmd.exe misreads labels in batch files with LF line endings
  [IO.File]::WriteAllText((Join-Path $binDir 'darkroom.cmd'), ($cmd -replace "`r?`n", "`r`n"), $utf8)
  $psString = { param($text) "'" + ($text -replace "'", "''") + "'" }
  $uninstall = @"
# Written by the darkroom installer, run by "darkroom uninstall"
`$ErrorActionPreference = 'Stop'
`$binDir = $(& $psString $binDir)
`$dataDir = $(& $psString $DataDir)
`$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
`$path = `$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
`$key.SetValue('Path', ((`$path -split ';') | Where-Object { `$_ -and `$_ -ne `$binDir }) -join ';', 'ExpandString')
`$key.Close()
[Environment]::SetEnvironmentVariable('DARKROOM_INSTALLER', `$null, 'User') # announces the new PATH
Write-Host "darkroom is uninstalled. Your data is still in `$dataDir; delete that folder if you don't need it anymore."
"@
  [IO.File]::WriteAllText((Join-Path $binDir 'uninstall.ps1'), ($uninstall -replace "`r?`n", "`r`n"), $utf8Bom)

  # Put the command on the user's PATH. Read and written as REG_EXPAND_SZ without expanding, so entries
  # like %USERPROFILE%\bin stay as they are ([Environment]::SetEnvironmentVariable would flatten them).
  $envKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
  try {
    $userPath = $envKey.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
    if (-not (($userPath -split ';') -contains $binDir)) {
      $envKey.SetValue('Path', (@($binDir) + ($userPath -split ';' | Where-Object { $_ })) -join ';', 'ExpandString')
      # Deleting a variable that doesn't exist just broadcasts the change, so new terminals see the PATH
      [Environment]::SetEnvironmentVariable('DARKROOM_INSTALLER', $null, 'User')
    }
  } finally {
    $envKey.Close()
  }

  # The new version works: drop the previous one
  foreach ($part in 'node', 'app') {
    $old = Join-Path $InstallDir "$part.old"
    if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force }
  }
  $swapped = @()

  # OpenRouter API key, asked once (only with a real console; the web UI asks for it too)
  $envFile = Join-Path $DataDir '.env'
  $hasKey = (Test-Path -LiteralPath $envFile) -and
    (Select-String -LiteralPath $envFile -Pattern '^OPENROUTER_API_KEY=.' -Quiet)
  if (-not $hasKey -and -not [Console]::IsInputRedirected) {
    $key = Read-Host "`nOpenRouter API key (https://openrouter.ai/settings/keys), or Enter to add it later"
    if ($key) {
      $line = "OPENROUTER_API_KEY=$key$([Environment]::NewLine)"
      # Start on a new line if the file doesn't end with one
      if ((Test-Path -LiteralPath $envFile) -and ([IO.File]::ReadAllText($envFile) -notmatch '(^|\n)$')) {
        $line = [Environment]::NewLine + $line
      }
      [IO.File]::AppendAllText($envFile, $line)
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
  # Also runs on Ctrl+C, unlike catch
  if ($swapped) {
    Say 'Installation failed, restoring the previous version'
    Restore-Previous $swapped
  }
  Remove-Item -LiteralPath $tmp, $staging -Recurse -Force -ErrorAction SilentlyContinue
}
