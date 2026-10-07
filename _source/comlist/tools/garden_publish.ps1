# Daily garden run, stage 2: Gmail tasks -> build -> deploy -> quote history,
# then ALWAYS clean the plaintext in _work (try/finally), even when a step fails.
# Prints one final line: RUN_RESULT: OK | RUN_RESULT: FAILED stage=<name>
# and writes the same outcome to statusFile (garden.config.json) for notification.
param(
  [string]$Today = (Get-Date -Format 'yyyy-MM-dd'),
  [string]$Now = (Get-Date -Format 'HH:mm'),
  [switch]$AllowShrink
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$cfg = Get-Content (Join-Path $PSScriptRoot 'garden.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Set-Location -LiteralPath $cfg.gardenRoot

$stage = 'start'
$message = ''
$pushed = $false
$ok = $false

function Invoke-Step([string]$Name, [scriptblock]$Block, [string[]]$MustMatch) {
  $script:stage = $Name
  Write-Output ("=== STEP: " + $Name + " ===")
  $text = & $Block 2>&1 | Out-String
  $script:lastText = $text
  Write-Output $text
  $code = $LASTEXITCODE
  foreach ($m in $MustMatch) {
    if ($text -notmatch [regex]::Escape($m)) { throw ($Name + ': missing "' + $m + '" (exit ' + $code + ')') }
  }
  if ($code -ne 0) { throw ($Name + ': exit ' + $code) }
}

try {
  if (-not (Test-Path -LiteralPath '_work\daily_tasks.json')) { $stage = 'tasks'; throw '_work\daily_tasks.json is missing' }

  Invoke-Step 'field-progress' { node compose_field_progress.js --verify _work/field_progress.json --today $Today } @('FIELD_PROGRESS_FRESH: OK') | Write-Output

  # Token age is reported so an expiring Gmail OAuth grant is noticed before it breaks.
  if (Test-Path -LiteralPath $cfg.gmailOAuthToken) {
    $age = [int]((Get-Date) - (Get-Item -LiteralPath $cfg.gmailOAuthToken).LastWriteTime).TotalDays
    Write-Output ('GMAIL_TOKEN_AGE_DAYS: ' + $age)
  }
  try {
    Invoke-Step 'gmail' { node fetch_gmail_tasks.js --today $Today --tasks _work/daily_tasks.json } @('GMAIL_RESULT: OK') | Write-Output
  } catch {
    if ($script:lastText -match 'oauth-token|oauth-client|invalid_grant|--auth-only') { $stage = 'gmail-auth' }
    throw
  }

  $buildArgs = @('build.js', '--today', $Today, '--now', $Now,
    '--master', '_assets/list.html', '--contacts', '_work/contacts.json',
    '--events', '_work/app_events.json', '--calendar', '_work/calendar.json',
    '--tasks', '_work/daily_tasks.json', '--pass', 'levelup', '--out', '_deploy/comlist.html')
  if ($AllowShrink) { $buildArgs += '--allow-shrink' }
  Invoke-Step 'build' { node @buildArgs } @() | Write-Output

  Invoke-Step 'deploy' {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot '_deploy_garden.ps1')
  } @('PUSH_RESULT: SUCCESS', 'VERIFY_RESULT: OK') | Write-Output
  $pushed = $true

  Invoke-Step 'quote' { node append_quote.js --tasks _work/daily_tasks.json } @('QUOTE_RESULT: OK') | Write-Output
  $ok = $true
} catch {
  $message = "$_"
  Write-Output ('ERROR: ' + $message)
} finally {
  Write-Output '=== STEP: cleanup (always) ==='
  $clean = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot '_rm_garden_work.ps1') 2>&1 | Out-String
  Write-Output $clean
  if ($clean -notmatch 'PLAINTEXT_SWEEP: OK' -or $clean -match 'PLAINTEXT_SWEEP_OUTSIDE: FOUND') {
    if ($ok) { $stage = 'cleanup'; $message = 'plaintext sweep did not pass' }
    $ok = $false
  }

  $status = [ordered]@{
    phase = 'publish'; result = $(if ($ok) { 'OK' } else { 'FAILED' }); stage = $(if ($ok) { 'done' } else { $stage })
    message = $message; date = $Today; finishedAt = (Get-Date -Format 's'); pushed = $pushed
  }
  [IO.File]::WriteAllText($cfg.statusFile, ($status | ConvertTo-Json), [Text.UTF8Encoding]::new($false))

  if ($ok) { Write-Output 'RUN_RESULT: OK' }
  else { Write-Output ('RUN_RESULT: FAILED stage=' + $stage + ' pushed=' + $pushed) }
}
if (-not $ok) { exit 1 }
