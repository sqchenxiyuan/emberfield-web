param([Parameter(Mandatory=$true)][ValidatePattern('^medicine-[a-z0-9-]+$')][string]$Prefix)
# Preconditions are identical to save-medicine-runtime.ps1. No speed/pause toggle.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$saved=@(foreach($suffix in @('a','b')){
 $name="$Prefix-$suffix"
 & (Join-Path $PSScriptRoot 'save-medicine-runtime.ps1') -SaveName $name | Out-Null
 & (Join-Path $PSScriptRoot 'read-medicine-runtime-save.ps1') -SavePath (Join-Path $root ".local-research/runtime/profile-20261102/Saves/$name.rws") | ConvertFrom-Json
})
foreach($s in $saved){foreach($key in @('file','sha256','bytes')){$s.PSObject.Properties.Remove($key)}}
if((ConvertTo-Json $saved[0] -Depth 40 -Compress) -cne (ConvertTo-Json $saved[1] -Depth 40 -Compress)){throw "Pause pair differs: $Prefix"}
$last=$saved[1]
[ordered]@{prefix=$Prefix;equal_state=$true;tick=$last.tick;pawns=@($last.pawns|ForEach-Object{[ordered]@{id=$_.id;pos=$_.pos;care=$_.medical_care;job=$_.job;driver=$_.job_driver;carry=$_.carry;new_hediffs=@($_.hediffs|Where-Object id -ge 148);immunity=$_.immunity}});medicines=$last.medicines}|ConvertTo-Json -Depth 12 -Compress
