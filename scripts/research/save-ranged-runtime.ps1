param([Parameter(Mandatory=$true)][ValidatePattern('^ranged-[a-z0-9-]+$')][string]$SaveName)
# Controls only the guarded isolated RimWorld process. Preconditions: paused map,
# no modal dialog, 2560x1440 client, English keyboard. Never overwrites a sample.
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$save=Join-Path $project ".local-research/runtime/profile-20261102/Saves/$SaveName.rws"
if(Test-Path -LiteralPath $save){throw 'Refusing to overwrite an existing experiment sample.'}
$inputScript=Join-Path $PSScriptRoot 'preservation-runtime-input.ps1'
$prefix=Join-Path $project ".local-research/runtime/$SaveName"
& $inputScript -Action click -X 2495 -Y 1422 -OutputPath ($prefix+'-menu.png')
& $inputScript -Action click -X 2215 -Y 1055 -OutputPath ($prefix+'-dialog.png')
& $inputScript -Action key -VirtualKey 65 -Control -OutputPath ($prefix+'-select-name.png')
& $inputScript -Action text -Text $SaveName -OutputPath ($prefix+'-name.png')
& $inputScript -Action click -X 1490 -Y 976 -WaitMs 800 -OutputPath ($prefix+'-saved.png')
if(!(Test-Path -LiteralPath $save)){throw 'Expected original-game save was not written; inspect UI screenshots.'}
& $inputScript -Action click -X 2495 -Y 1422 -OutputPath ($prefix+'-return.png')
Get-FileHash -LiteralPath $save -Algorithm SHA256 | Select-Object Path,Hash | ConvertTo-Json -Compress
