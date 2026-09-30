[CmdletBinding()]
param(
  [string]$GardenRootOverride = ''
)

$ErrorActionPreference = 'Stop'
$folder = [char]0x30C1 + [char]0x30FC + [char]0x30E0 + [char]0x30D3 + [char]0x30EB + [char]0x30C7 + [char]0x30A3 + [char]0x30F3 + [char]0x30B0
# garden subfolder (My Best Life) inside the team-building folder
$app = [char]0x30DE + [char]0x30A4 + [char]0x30D9 + [char]0x30B9 + [char]0x30C8 + [char]0x30E9 + [char]0x30A4 + [char]0x30D5
$canonicalBase = [IO.Path]::GetFullPath((Join-Path (Join-Path 'C:\Users\ryupr\Codex-work' $folder) $app))
# garden.config.json wins when present (moving the folder = edit the config only)
$cfgPath = Join-Path $PSScriptRoot 'garden.config.json'
if (Test-Path -LiteralPath $cfgPath) {
  $cfg = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($cfg.gardenRoot) {
    $canonicalBase = [IO.Path]::GetFullPath($cfg.gardenRoot).TrimEnd([char[]]@('\', '/'))
    $app = [IO.Path]::GetFileName($canonicalBase)
  }
}
$base = if ([string]::IsNullOrWhiteSpace($GardenRootOverride)) {
  $canonicalBase
} else {
  [IO.Path]::GetFullPath($GardenRootOverride)
}

function Trim-TrailingSeparators([string]$PathValue) {
  return $PathValue.TrimEnd([char[]]@('\', '/'))
}

$base = Trim-TrailingSeparators $base
$baseName = [IO.Path]::GetFileName($base)
if ($baseName -ne $app) {
  throw '削除対象のルート名がマイベストライフではありません'
}
if ([string]::IsNullOrWhiteSpace($GardenRootOverride) -and
    -not [string]::Equals($base, $canonicalBase, [StringComparison]::OrdinalIgnoreCase)) {
  throw '削除対象の本番ルートが想定パスと一致しません'
}

$work = [IO.Path]::GetFullPath((Join-Path $base '_work'))
$script:WorkFull = Trim-TrailingSeparators $work
$script:WorkPrefix = $script:WorkFull + [IO.Path]::DirectorySeparatorChar

function Get-SafeWorkPath([string]$Candidate) {
  $full = [IO.Path]::GetFullPath($Candidate)
  if ([string]::Equals($full, $script:WorkFull, [StringComparison]::OrdinalIgnoreCase) -or
      -not $full.StartsWith($script:WorkPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw ('_work配下以外の削除を拒否しました: ' + $full)
  }
  return $full
}

function Remove-SafeWorkItem([System.IO.FileSystemInfo]$Item) {
  $full = Get-SafeWorkPath $Item.FullName
  if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw ('再解析点の削除を拒否しました: ' + $full)
  }
  Write-Output ('DELETING: ' + $full)
  Remove-Item -LiteralPath $full -Recurse -Force
}

Write-Output ('WORK: ' + $script:WorkFull)
$activeGeneration = $false
$manifestLockPath = Join-Path $script:WorkFull '.material-manifest.lock'
$manifestLockOwned = $false
$manifestLockBusy = $false
$generationRoot = Join-Path $script:WorkFull '.material-generations'
if (-not (Test-Path -LiteralPath $script:WorkFull -PathType Container)) {
  New-Item -ItemType Directory -Path $script:WorkFull -Force -ErrorAction Stop | Out-Null
}
if (Test-Path -LiteralPath $script:WorkFull -PathType Container) {
  try {
    New-Item -ItemType Directory -Path $manifestLockPath -ErrorAction Stop | Out-Null
    $manifestLockOwned = $true
  } catch {
    $manifestLockBusy = $true
    Write-Output ('SKIPPED_MANIFEST_LOCK: ' + (Get-SafeWorkPath $manifestLockPath))
  }
  if (-not $manifestLockBusy) {
    if (Test-Path -LiteralPath $generationRoot -PathType Container) {
      $generationDirs = @(Get-ChildItem -LiteralPath $generationRoot -Force -Directory)
      $activeGenerationDirs = @($generationDirs | Where-Object {
        Test-Path -LiteralPath (Join-Path $_.FullName '.in-progress') -PathType Leaf
      })
      if ($activeGenerationDirs.Count -gt 0) {
        $activeGeneration = $true
        $activeGenerationDirs | ForEach-Object {
          Write-Output ('SKIPPED_ACTIVE_GENERATION: ' + (Get-SafeWorkPath $_.FullName))
        }
      }
      foreach ($generation in $generationDirs) {
        if (-not $activeGeneration) { Remove-SafeWorkItem $generation }
      }
      if (-not $activeGeneration -and (Test-Path -LiteralPath $generationRoot)) {
        Remove-SafeWorkItem (Get-Item -LiteralPath $generationRoot -Force)
      }
    }

    if (-not $activeGeneration) {
      $workItems = @(Get-ChildItem -LiteralPath $script:WorkFull -Force |
        Where-Object { -not [string]::Equals($_.FullName, $manifestLockPath, [StringComparison]::OrdinalIgnoreCase) })
      foreach ($item in $workItems) {
        Remove-SafeWorkItem $item
      }
    }
  }
}

if ($manifestLockOwned) {
  try {
    Remove-Item -LiteralPath (Get-SafeWorkPath $manifestLockPath) -Recurse -Force -ErrorAction Stop
    $manifestLockOwned = $false
  } catch {
    Write-Output ('MANIFEST_LOCK_RELEASE_FAILED: ' + (Get-SafeWorkPath $manifestLockPath))
  }
}

$remaining = if (Test-Path -LiteralPath $script:WorkFull -PathType Container) {
  @(Get-ChildItem -LiteralPath $script:WorkFull -Force -Recurse)
} else { @() }
if ($remaining.Count -gt 0) {
  Write-Output 'PLAINTEXT_SWEEP: FOUND residual _work files or directories:'
  $remaining | ForEach-Object { Write-Output ('  - ' + $_.FullName) }
} else {
  Write-Output 'PLAINTEXT_SWEEP: OK (no residual _work files or directories)'
}

# ---- plaintext sweep outside _work ----
# The encrypted build emits "let DATA = [];" and fills it after decryption.
# A literal "const DATA = [{" means real contact records are sitting in the clear.
Write-Output ''
Write-Output '=== PLAINTEXT SWEEP OUTSIDE _work ==='
$hits = @()
$targets = @()
if (Test-Path -LiteralPath $base -PathType Container) {
  $targets += @(Get-ChildItem -LiteralPath $base -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @('.js', '.html') })
}
foreach ($sub in @('_deploy', '_preview')) {
  $p = Join-Path $base $sub
  if (Test-Path -LiteralPath $p -PathType Container) {
    $targets += @(Get-ChildItem -LiteralPath $p -Force -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -in @('.js', '.html') })
  }
}
foreach ($f in $targets) {
  # never flag the master template: it references data.js but embeds no records
  if ($f.FullName -like '*\_assets\*') { continue }
  $txt = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
  if ($txt -and $txt -match 'const DATA\s*=\s*\[\s*\{') { $hits += $f.FullName }
}
if ($hits.Count -eq 0) {
  Write-Output 'PLAINTEXT_SWEEP_OUTSIDE: OK (no cleartext contact data found)'
} else {
  Write-Output 'PLAINTEXT_SWEEP_OUTSIDE: FOUND cleartext contact data - delete these:'
  $hits | ForEach-Object { Write-Output ('  - ' + $_) }
}

if ($remaining.Count -gt 0 -or $hits.Count -gt 0) { exit 1 }
