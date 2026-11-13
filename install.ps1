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
#
# Everything runs in one script block: "irm | iex" runs in your PowerShell session, so no preference,
# function or variable (such as the API key) may leak into it, and nothing runs if the download breaks off.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is very slow with the progress bar

  $NodeMajor = 26
  $Repo = 'https://github.com/ajgassner/darkroom'
  # Marker in node\ and app\: the folder holds a complete, built version that can be restored
  $Complete = '.darkroom-complete'

  function Say($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

  # Absolute paths: the command must work from any folder ("darkroom update" passes its own folder as bin\..)
  function Get-FullPath($path) {
    [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($path))
  }
  # Whether $path is $dir or inside it (Windows paths are case-insensitive)
  function Test-Inside($path, $dir) {
    $path = $path.TrimEnd('\')
    $dir = $dir.TrimEnd('\')
    ($path -ieq $dir) -or $path.StartsWith("$dir\", [StringComparison]::OrdinalIgnoreCase)
  }

  $InstallDir = Get-FullPath $(if ($env:DARKROOM_DIR) { $env:DARKROOM_DIR } else { Join-Path $HOME '.darkroom' })
  # An existing installation keeps its data folder in bin\darkroom.env (see below)
  $commandEnvFile = Join-Path $InstallDir 'bin\darkroom.env'
  $existing = Test-Path -LiteralPath (Join-Path $InstallDir 'bin\darkroom.cmd')
  $DataDir = if ($env:DARKROOM_HOME) {
    $env:DARKROOM_HOME
  } elseif ((Test-Path -LiteralPath $commandEnvFile) -and
    ([IO.File]::ReadAllText($commandEnvFile) -match "(?m)^DARKROOM_HOME=(['``])(.*)\1\r?$")) {
    $Matches[2]
  } else {
    Join-Path $HOME 'darkroom'
  }
  $DataDir = Get-FullPath $DataDir

  # Updates replace the install folder and uninstall removes it: it must not hold your data or anything else.
  # The most specific problem first: a drive root or the home folder also contains the data folder, and a
  # data folder used as install folder also holds files that darkroom did not create.
  if ((Test-Inside (Get-FullPath $HOME) $InstallDir) -or (Test-Inside ([IO.Path]::GetPathRoot($InstallDir)) $InstallDir)) {
    throw "$InstallDir is a drive root or your home folder, or contains it; set DARKROOM_DIR to a folder of its own (default: ~\.darkroom)."
  }
  $problem = if ($InstallDir.TrimEnd('\') -ieq $DataDir.TrimEnd('\')) {
    "The install folder and the data folder are the same ($InstallDir)."
  } elseif (Test-Inside $DataDir $InstallDir) {
    "The data folder $DataDir is inside the install folder $InstallDir."
  } elseif (Test-Inside $InstallDir $DataDir) {
    "The install folder $InstallDir is inside the data folder $DataDir."
  }
  if ($problem) {
    if ($existing) {
      $problem += ' Don''t run "darkroom uninstall" of the existing installation: older versions delete the whole install folder, with your data in it.'
    }
    throw "$problem darkroom replaces its install folder on updates and removes it on uninstall, so set DARKROOM_DIR and DARKROOM_HOME to two separate folders (defaults: ~\.darkroom and ~\darkroom)."
  }
  if (-not $existing -and (Test-Path -LiteralPath $InstallDir -PathType Container)) {
    # Empty, or only what the installer creates (an interrupted first install)
    $foreign = Get-ChildItem -LiteralPath $InstallDir -Force | Where-Object {
      $_.Name -notmatch '^(node|app|bin|staging|cache|node\.old|app\.old|.*\.trash|desktop\.ini|Thumbs\.db)$'
    }
    if ($foreign) {
      throw "$InstallDir already contains files that darkroom did not create; set DARKROOM_DIR to a new or empty folder (default: ~\.darkroom)."
    }
  }

  $Ref = $env:DARKROOM_REF
  if (-not $Ref -and -not $env:DARKROOM_SOURCE) {
    # The latest release from the redirect of releases/latest (unlike the GitHub API it has no rate limit);
    # main only as long as there is no release yet
    try {
      $request = [Net.WebRequest]::Create("$Repo/releases/latest")
      $request.Method = 'HEAD'
      $request.UserAgent = 'darkroom-installer'
      $response = $request.GetResponse()
      $latest = $response.ResponseUri.AbsoluteUri
      $response.Close()
    } catch {
      throw "Could not reach GitHub to look up the latest darkroom release ($($_.Exception.Message)). Check your internet connection, or set DARKROOM_REF to a version."
    }
    $Ref = if ($latest -match '/releases/tag/([^/?#]+)$') {
      $Matches[1]
    } elseif ($latest -match '/releases/?$') {
      'main'
    } else {
      throw "Unexpected answer from GitHub when looking up the latest release: $latest"
    }
  }
  $Source = if ($env:DARKROOM_SOURCE) { $env:DARKROOM_SOURCE } else { "$Repo/archive/$Ref.zip" }

  # A 32-bit PowerShell on 64-bit Windows sees x86 in PROCESSOR_ARCHITECTURE
  $processor = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  $arch = switch ($processor) {
    'AMD64' { 'x64' }
    'ARM64' { 'arm64' }
    default { throw "Unsupported processor $processor" }
  }

  # An update keeps the previous node\ and app\ as node.old\ and app.old\ until the new ones are built,
  # and puts them back if anything fails, so a failed update leaves the installed darkroom working.
  # Building happens in place, because the installed packages contain absolute paths (pnpm uses junctions).
  # Staging inside InstallDir keeps every move on one drive. Folders are renamed to *.trash before they are
  # deleted, so an interrupted deletion never leaves a half-deleted folder under a name that counts.
  function Remove-Tree($dir) {
    # rmdir doesn't follow junctions; Remove-Item -Recurse in Windows PowerShell 5.1 deletes their targets
    if (Test-Path -LiteralPath $dir) {
      Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\cmd.exe') -ArgumentList "/d /c rmdir /s /q `"$dir`"" -NoNewWindow -Wait
    }
  }
  function Rename-Dir($path, $name) {
    try {
      Rename-Item -LiteralPath $path $name
    } catch {
      throw "Could not rename $path ($($_.Exception.Message)). Is darkroom still running? Stop it (Ctrl+C in its window) and try again."
    }
  }
  function Move-ToTrash($path) {
    if (Test-Path -LiteralPath $path) {
      Rename-Dir $path "$(Split-Path -Leaf $path).$([guid]::NewGuid().ToString('N').Substring(0, 8)).trash"
    }
  }
  function Clear-Trash {
    Get-ChildItem -LiteralPath $InstallDir -Directory -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like '*.trash' } | ForEach-Object { Remove-Tree $_.FullName }
  }
  function Restore-Previous($parts) {
    foreach ($part in $parts) {
      $dir = Join-Path $InstallDir $part
      Move-ToTrash $dir
      if (Test-Path -LiteralPath "$dir.old") { Rename-Dir "$dir.old" $part }
    }
  }
  # Windows lets node\ be renamed while darkroom runs from it, so look for its processes. Win32_Process also
  # sees 64-bit processes from a 32-bit PowerShell; processes whose path can't be read are skipped.
  function Assert-NotRunning {
    $prefix = (Join-Path $InstallDir 'node') + '\'
    $paths = @()
    try {
      $paths = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object { $_.ExecutablePath })
    } catch {
      $paths = @(Get-Process node -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Path } catch { $null } })
    }
    if ($paths | Where-Object { $_ -and $_.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) }) {
      throw "darkroom is still running from $InstallDir. Stop it (Ctrl+C in its window) and try again."
    }
  }

  # The installed version can be restored if this update fails. Installations from before the completion
  # markers count as complete unless an earlier update was interrupted.
  $trusted = $existing
  $swapped = @()
  $staging = Join-Path $InstallDir 'staging'
  $tmp = Join-Path ([IO.Path]::GetTempPath()) "darkroom-$([guid]::NewGuid())"
  # Changes to the environment of this process would stay in your PowerShell session
  $envNames = 'Path', 'pnpm_config_store_dir', 'pnpm_config_cache_dir', 'pnpm_config_state_dir', 'npm_config_cache',
    'npm_config_update_notifier', 'npm_config_onnxruntime_node_install_cuda'
  $savedEnv = @{}
  foreach ($name in $envNames) { $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name) }
  Assert-NotRunning
  New-Item -ItemType Directory -Force $tmp, $InstallDir, $DataDir | Out-Null

  try {
    # After an update that was killed halfway: a backup is put back only if it is complete and the new
    # version isn't; otherwise it is dropped
    foreach ($part in 'node', 'app') {
      $dir = Join-Path $InstallDir $part
      if (Test-Path -LiteralPath "$dir.old") {
        $trusted = $false
        if ((Test-Path -LiteralPath "$dir.old\$Complete") -and -not (Test-Path -LiteralPath "$dir\$Complete")) {
          Say "Restoring the previous $part\ (an earlier update did not finish)"
          Restore-Previous $part
        } else {
          Move-ToTrash "$dir.old"
        }
      }
    }
    Clear-Trash
    Remove-Tree $staging
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
    Say "Downloading darkroom ($(if ($env:DARKROOM_SOURCE) { $Source } else { $Ref }))"
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
    # darkroom may have been started during the download; a rename that fails (locked files) also stops here.
    Assert-NotRunning
    foreach ($part in 'node', 'app') {
      $dir = Join-Path $InstallDir $part
      if (Test-Path -LiteralPath $dir) {
        if ($trusted) { New-Item -ItemType File -Force (Join-Path $dir $Complete) | Out-Null }
        Rename-Dir $dir "$part.old"
      }
      $swapped += $part
      Move-Item -LiteralPath (Join-Path $staging $part) $dir
    }
    $nodeDir = Join-Path $InstallDir 'node'
    $appDir = Join-Path $InstallDir 'app'
    $env:Path = "$nodeDir;$env:Path"
    # pnpm's store and the npm and pnpm caches stay in the install folder, so uninstall removes them; the store
    # is on the same drive as app\, so pnpm can hard-link packages from it
    $cache = Join-Path $InstallDir 'cache'
    $env:pnpm_config_store_dir = Join-Path $cache 'pnpm-store'
    $env:pnpm_config_cache_dir = Join-Path $cache 'pnpm'
    $env:pnpm_config_state_dir = Join-Path $cache 'pnpm-state'
    $env:npm_config_cache = Join-Path $cache 'npm'
    $env:npm_config_update_notifier = 'false'
    $env:npm_config_onnxruntime_node_install_cuda = 'skip' # background removal runs on the CPU: no CUDA download

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
    # the PATH entry and removes what the installer created except bin\, then the batch file removes bin\
    # after it has exited ((goto) trick), and the install folder if nothing else is left in it.
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
set "confirm=ask"
rem Only "darkroom update" and "darkroom uninstall [--yes]": anything else (like --help) goes to the CLI
if /i "%~1"=="uninstall" if "%~2"=="" goto uninstall
if /i "%~1"=="uninstall" if /i "%~2"=="--yes" if "%~3"=="" (set "confirm=no" & goto uninstall)
if /i "%~1"=="uninstall" if /i "%~2"=="-y" if "%~3"=="" (set "confirm=no" & goto uninstall)
rem One block: cmd parses it completely before the installer rewrites this file
if /i "%~1"=="update" if "%~2"=="" (set "DARKROOM_DIR=%~dp0.." & set "DARKROOM_HOME=" & powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/ajgassner/darkroom/main/install.ps1 | iex" && exit /b 0 || exit /b 1)
"%~dp0..\node\node.exe" --env-file="%~dp0darkroom.env" "%~dp0..\app\apps\cli\src\cli.ts" %*
exit /b %errorlevel%
:uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %confirm% || exit /b 1
for %%i in ("%~dp0..") do set "install_dir=%%~fi"
rem Plain rmdir removes the install folder only if it is empty; (call ) resets the exit code
(goto) 2>nul & rmdir /s /q "%install_dir%\bin" & rmdir "%install_dir%" 2>nul & (call )
'@
    # CRLF: cmd.exe misreads labels in batch files with LF line endings
    [IO.File]::WriteAllText((Join-Path $binDir 'darkroom.cmd'), ($cmd -replace "`r?`n", "`r`n"), $utf8)
    $psString = { param($text) "'" + ($text -replace "'", "''") + "'" }
    $uninstall = @"
# Written by the darkroom installer, run by "darkroom uninstall [--yes]"
param([string]`$Confirm = 'ask')
`$ErrorActionPreference = 'Stop'
`$installDir = $(& $psString $InstallDir)
`$binDir = $(& $psString $binDir)
`$dataDir = $(& $psString $DataDir)
# Windows lets node\ be renamed while darkroom runs from it, so look for its processes first
`$prefix = (Join-Path `$installDir 'node') + '\'
`$paths = @()
try {
  `$paths = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object { `$_.ExecutablePath })
} catch {
  `$paths = @(Get-Process node -ErrorAction SilentlyContinue | ForEach-Object { try { `$_.Path } catch { `$null } })
}
if (`$paths | Where-Object { `$_ -and `$_.StartsWith(`$prefix, [StringComparison]::OrdinalIgnoreCase) }) {
  Write-Host "darkroom is still running from `${installDir}. Stop it (Ctrl+C in its window) and run darkroom uninstall again."
  exit 1
}
if (`$Confirm -ne 'no' -and -not [Console]::IsInputRedirected) {
  `$answer = Read-Host "Remove darkroom from `${installDir}? Your data in `$dataDir stays. [y/N]"
  if (`$answer -notmatch '^(y|yes)$') {
    Write-Host 'Cancelled.'
    exit 1
  }
}
function Remove-Tree(`$dir) {
  # rmdir doesn't follow junctions; Remove-Item -Recurse in Windows PowerShell 5.1 deletes their targets
  if (Test-Path -LiteralPath `$dir) {
    Start-Process -FilePath (Join-Path `$env:SystemRoot 'System32\cmd.exe') -ArgumentList "/d /c rmdir /s /q ``"`$dir``"" -NoNewWindow -Wait
  }
}
function Test-Data(`$dir) {
  `$dataDir.TrimEnd('\') -ieq `$dir -or `$dataDir.StartsWith("`$dir\", [StringComparison]::OrdinalIgnoreCase)
}
# Renaming node\ first: if a file in it is locked, nothing has been removed yet
`$node = Join-Path `$installDir 'node'
if ((Test-Path -LiteralPath `$node) -and -not (Test-Data `$node)) {
  try {
    Rename-Item -LiteralPath `$node "node.`$([guid]::NewGuid().ToString('N').Substring(0, 8)).trash"
  } catch {
    Write-Host "Could not remove `${node}: is darkroom still running? Stop it and run darkroom uninstall again."
    exit 1
  }
}
# Only what the installer created; bin\ is removed by darkroom.cmd
`$parts = Get-ChildItem -LiteralPath `$installDir -Directory -Force |
  Where-Object { `$_.Name -match '^(node|app|staging|cache|node\.old|app\.old|.*\.trash)$' }
foreach (`$part in `$parts) {
  if (Test-Data `$part.FullName) {
    Write-Host "Kept `$(`$part.FullName): your data folder is in there."
  } else {
    Remove-Tree `$part.FullName
  }
}
`$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
`$path = `$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
`$key.SetValue('Path', ((`$path -split ';') | Where-Object { `$_ -and `$_ -ne `$binDir }) -join ';', 'ExpandString')
`$key.Close()
[Environment]::SetEnvironmentVariable('DARKROOM_INSTALLER', `$null, 'User') # announces the new PATH
if (Get-ChildItem -LiteralPath `$installDir -Force | Where-Object { `$_.Name -ne 'bin' }) {
  Write-Host "Kept `${installDir}: it contains files that darkroom did not create."
}
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

    # The new version works: mark it complete and drop the previous one (from here on nothing is rolled back)
    foreach ($part in 'node', 'app') { New-Item -ItemType File -Force (Join-Path $InstallDir "$part\$Complete") | Out-Null }
    $swapped = @()
    foreach ($part in 'node', 'app') {
      try { Move-ToTrash (Join-Path $InstallDir "$part.old") } catch { Write-Warning $_.Exception.Message }
    }
    Clear-Trash

    # OpenRouter API key, asked once (only with a real console; the web UI asks for it too)
    $envFile = Join-Path $DataDir '.env'
    $hasKey = (Test-Path -LiteralPath $envFile) -and
      (Select-String -LiteralPath $envFile -Pattern '^OPENROUTER_API_KEY=.' -Quiet)
    if (-not $hasKey -and -not [Console]::IsInputRedirected) {
      # Masked while typing (Read-Host -MaskInput needs PowerShell 7)
      $secure = Read-Host "`nOpenRouter API key (https://openrouter.ai/settings/keys), or Enter to add it later" -AsSecureString
      $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try {
        $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
      } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
      }
      if ($key) {
        $line = "OPENROUTER_API_KEY=$key$([Environment]::NewLine)"
        # Start on a new line if the file doesn't end with one
        if ((Test-Path -LiteralPath $envFile) -and ([IO.File]::ReadAllText($envFile) -notmatch '(^|\n)$')) {
          $line = [Environment]::NewLine + $line
        }
        [IO.File]::AppendAllText($envFile, $line)
        $hasKey = $true
      }
      Remove-Variable key, line, secure -ErrorAction SilentlyContinue
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
      try { Restore-Previous $swapped } catch { Write-Warning $_.Exception.Message }
    }
    Remove-Tree $staging
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    try { Clear-Trash } catch { Write-Warning $_.Exception.Message }
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $savedEnv[$name]) }
  }
}
