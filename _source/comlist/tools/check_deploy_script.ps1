$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'deploy_garden.ps1'
$parseTokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$parseTokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count -gt 0) {
  $parseErrors | ForEach-Object { Write-Output $_.Message }
  exit 1
}
Write-Output 'DEPLOY_SYNTAX: OK'
