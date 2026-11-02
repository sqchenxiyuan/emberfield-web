param([Parameter(Mandatory=$true)][ValidatePattern('^logistics-[a-z0-9-]+$')][string]$SaveName)
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$save=Join-Path $project ".local-research/runtime/profile-20261102/Saves/$SaveName.rws"
if(Test-Path -LiteralPath $save){throw 'Refusing to overwrite an existing experiment sample.'}
$inputScript=Join-Path $PSScriptRoot 'preservation-runtime-input.ps1'
$prefix=Join-Path $project ".local-research/runtime/$SaveName"
# Preconditions: paused colony map, no modal dialog; 2560x1440 client and English input.
& $inputScript -Action click -X 2495 -Y 1422 -OutputPath ($prefix+'-menu.png')
& $inputScript -Action click -X 2215 -Y 1055 -OutputPath ($prefix+'-dialog.png')
& $inputScript -Action key -VirtualKey 65 -Control -OutputPath ($prefix+'-select-name.png')
& $inputScript -Action text -Text $SaveName -OutputPath ($prefix+'-name.png')
& $inputScript -Action click -X 1490 -Y 976 -WaitMs 800 -OutputPath ($prefix+'-saved.png')
if(!(Test-Path -LiteralPath $save)){throw 'Expected original-game save was not written; inspect UI screenshots.'}
& $inputScript -Action click -X 2495 -Y 1422 -OutputPath ($prefix+'-return.png')
Get-FileHash -LiteralPath $save -Algorithm SHA256 | Select-Object Path,Hash | ConvertTo-Json -Compress
