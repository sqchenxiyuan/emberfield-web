param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$DecompilerPath=(Join-Path $PSScriptRoot '../../../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'))
$ErrorActionPreference='Stop'
# Loads ILSpy only. The game assembly is parsed as PE/CIL, never loaded/executed.
& (Join-Path $PSScriptRoot 'extract-rimworld.ps1') -GameRoot $GameRoot -DecompilerPath $DecompilerPath -Group trade
if(!$?){throw 'Trade reconstruction failed'}
& (Join-Path $PSScriptRoot 'collect-trade-xml.ps1') -GameRoot $GameRoot
if(!$?){throw 'Trade XML collection failed'}
Write-Output 'Reconstructed selected trade types under .local-research/trade. Review evidence before deliberately changing pinned expectations.'
