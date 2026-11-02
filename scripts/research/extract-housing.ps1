param(
  [Parameter(Mandatory=$true)][string]$GameRoot,
  [Parameter(Mandatory=$true)][string]$DecompilerPath
)
$ErrorActionPreference='Stop'
$types=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/housing-types.json')|ConvertFrom-Json
& (Join-Path $PSScriptRoot 'extract-rimworld.ps1') -GameRoot $GameRoot -DecompilerPath $DecompilerPath -Group housing -Types $types
