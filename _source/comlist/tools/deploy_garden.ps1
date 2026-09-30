$ErrorActionPreference = 'Continue'
$root = 'C:\Users\ryupr\Codex-work'
# Dedicated clone. _push_brief.ps1 (morning brief, same repo) uses
# _gh_teambuilding, and this script does reset --hard + clean -fd on its clone -
# sharing one working tree would let the two tasks wipe each other's work when
# they run close together (missed tasks all fire together on next app launch).
$clone = Join-Path $root '_gh_garden'
$repo = 'https://github.com/ryupro202211-ops/teambuilding'

# Locate _deploy\comlist.html. The garden folder comes from garden.config.json
# (ASCII path, \u-escaped JSON), so moving the folder only needs a config edit.
# Without the config, fall back to searching two levels deep and refuse to
# guess if more than one candidate exists - publishing the wrong build would
# be silent and hard to notice.
$srcList = @()
$cfgPath = Join-Path $PSScriptRoot 'garden.config.json'
if (Test-Path $cfgPath) {
  $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $p = Join-Path $cfg.gardenRoot '_deploy\comlist.html'
  if (-not (Test-Path $p)) { Write-Output 'ERROR: _deploy\comlist.html not found under gardenRoot'; exit 1 }
  $srcList += $p
} else {
  foreach ($d in Get-ChildItem $root -Directory) {
    $cands = @($d) + @(Get-ChildItem $d.FullName -Directory -ErrorAction SilentlyContinue)
    foreach ($c in $cands) {
      $p = Join-Path $c.FullName '_deploy\comlist.html'
      if (Test-Path $p) { $srcList += $p }
    }
  }
}
if ($srcList.Count -eq 0) { Write-Output 'ERROR: _deploy\comlist.html not found'; exit 1 }
if ($srcList.Count -gt 1) {
  Write-Output 'ERROR: multiple _deploy\comlist.html found - refusing to guess which one to publish:'
  $srcList | ForEach-Object { Write-Output ('  - ' + $_) }
  exit 1
}
$src = $srcList[0]
$srcHash = (Get-FileHash $src -Algorithm SHA256).Hash.ToLower()
Write-Output "SRC: $src"
Write-Output ("SRC_BYTES: " + (Get-Item $src).Length)
Write-Output "SRC_SHA256: $srcHash"

# Bring the working clone back to exactly what origin has.
# reset --hard only restores TRACKED files, so an untracked stray left in the
# clone would survive and get swept up by the later `git add -A`. clean -fd
# removes those - this is the guard against publishing something unintended.
function Reset-CloneToRemote {
  git fetch origin 2>&1 | Out-String | Write-Output
  git reset --hard origin/main 2>&1 | Out-String | Write-Output
  git clean -fd 2>&1 | Out-String | Write-Output
}

# Put our payload on top of that clean state and commit it.
function Copy-PayloadAndCommit {
  $gardenRoot = Split-Path (Split-Path $src -Parent) -Parent
  $bundleTool = Join-Path $gardenRoot 'tools\publish_bundle.js'
  node $bundleTool --source $gardenRoot --target $clone
  if ($LASTEXITCODE -ne 0) { throw 'Bundle copy failed' }
  # The generated encrypted HTML may contain CRLF. Keep its exact bytes in Git
  # so the fresh-clone hash check proves the published payload is identical.
  $attrs = Join-Path $clone '.gitattributes'
  $attrsText = if (Test-Path $attrs) { Get-Content $attrs -Raw } else { '' }
  $attrsText = $attrsText -replace 'index\.html -textcomlist\.html -text', "index.html -text`r`ncomlist.html -text"
  [IO.File]::WriteAllText($attrs, $attrsText, [Text.UTF8Encoding]::new($false))
  if ($attrsText -notmatch '(?m)^comlist\.html\s+-text\s*$') {
    $prefix = if ($attrsText.Length -gt 0 -and $attrsText -notmatch '[\r\n]$') { "`r`n" } else { '' }
    [IO.File]::AppendAllText($attrs, $prefix + "comlist.html -text`r`n", [Text.UTF8Encoding]::new($false))
  }
  if ($attrsText -notmatch '(?m)^assets/comlist/\*\s+-text\s*$') {
    [IO.File]::AppendAllText($attrs, "assets/comlist/* -text
", [Text.UTF8Encoding]::new($false))
  }
  # Root URL (.../teambuilding/) must 404: never keep an index.html
  $idx = Join-Path $clone 'index.html'
  if (Test-Path $idx) { Remove-Item $idx -Force; Write-Output 'Removed index.html (root will 404)' }
  $plain = Join-Path $clone 'data.js'
  if (Test-Path $plain) { Remove-Item $plain -Force; Write-Output 'Removed plaintext data.js' }

  Write-Output '--- files in clone ---'
  Get-ChildItem $clone -Force | Where-Object { $_.Name -ne '.git' } | ForEach-Object { Write-Output $_.Name }

  git add --renormalize comlist.html 2>&1 | Out-String | Write-Output
  git add -A 2>&1 | Out-String | Write-Output
  git -c user.name='ryupro202211-ops' -c user.email='ryuhei.otsuka@gmail.com' commit -m 'Update encrypted contact garden (auto)' 2>&1 | Out-String | Write-Output
}

if (-not (Test-Path $clone)) {
  Write-Output 'Cloning...'
  git clone $repo $clone 2>&1 | Out-String | Write-Output
}
Set-Location $clone
Reset-CloneToRemote
Copy-PayloadAndCommit

# A push can be rejected because another task pushed to this repo first
# (income.html / morningblief.html live here too). Retrying the same push
# would fail every time, so re-sync with origin and rebuild the commit on top
# of it before each retry.
$ok = $false
for ($i = 1; $i -le 5; $i++) {
  Write-Output "PUSH attempt $i"
  git push origin main 2>&1 | Out-String | Write-Output
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  if ($i -lt 5) {
    Write-Output 'push rejected - re-syncing with origin and re-applying payload'
    Start-Sleep -Seconds 5
    Reset-CloneToRemote
    Copy-PayloadAndCommit
  }
}
if ($ok) { Write-Output 'PUSH_RESULT: SUCCESS' } else { Write-Output 'PUSH_RESULT: FAILED' }
git log --oneline -1 2>&1 | Out-String | Write-Output

# ---------------- verification against a fresh clone ----------------
# Proves what is actually published: byte-identical comlist.html, and no
# plaintext / no root index.html. Runs here so it can never be skipped.
Write-Output ''
Write-Output '=== VERIFY (fresh clone) ==='
Set-Location $root
$t = Join-Path $env:TEMP ('vgard' + (Get-Random))
git -c core.autocrlf=false -c core.eol=lf clone --depth 1 $repo $t 2>&1 | Out-Null
$vfail = @()
if (-not (Test-Path $t)) {
  $vfail += 'clone failed'
} else {
  Write-Output '--- files in fresh clone ---'
  Get-ChildItem $t -Force | Where-Object { $_.Name -ne '.git' } | ForEach-Object { Write-Output $_.Name }

  if (Test-Path (Join-Path $t 'index.html')) { $vfail += 'index.html exists (root would not 404)' }
  if (Test-Path (Join-Path $t 'data.js'))    { $vfail += 'plaintext data.js exists' }

  $cf = Join-Path $t 'comlist.html'
  if (-not (Test-Path $cf)) {
    $vfail += 'comlist.html missing'
  } else {
    $cloneHash = (Get-FileHash $cf -Algorithm SHA256).Hash.ToLower()
    Write-Output ('CLONE_BYTES: ' + (Get-Item $cf).Length)
    Write-Output "CLONE_SHA256: $cloneHash"
    if ($cloneHash -ne $srcHash) { $vfail += "comlist.html hash mismatch (src=$srcHash clone=$cloneHash)" }
    $gardenRoot = Split-Path (Split-Path $src -Parent) -Parent
    node (Join-Path $gardenRoot 'tools\publish_bundle.js') --verify $cf
    if ($LASTEXITCODE -ne 0) { $vfail += 'bundle verification failed' }
    # published file must be ciphertext-only: the decrypt gate present, no data.js reference
    $txt = Get-Content $cf -Raw -Encoding UTF8
    if ($txt -notmatch 'id="lockgate"') { $vfail += 'lockgate missing (file may not be encrypted)' }
    if ($txt -match '<script src="data\.js"></script>') { $vfail += 'data.js script reference still present' }
    if ($txt -match 'API_TOKEN\s*[:=]') { $vfail += 'API_TOKEN-like string present' }
  }
  Write-Output '--- HEAD ---'
  git -C $t log -1 --oneline 2>&1 | Out-String | Write-Output
  Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue
}

if ($vfail.Count -eq 0) {
  Write-Output 'VERIFY_RESULT: OK'
} else {
  Write-Output 'VERIFY_RESULT: FAILED'
  $vfail | ForEach-Object { Write-Output ("  - " + $_) }
  exit 1
}
