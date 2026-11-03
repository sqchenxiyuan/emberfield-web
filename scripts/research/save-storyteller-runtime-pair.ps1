param([Parameter(Mandatory=$true)][ValidatePattern('^storyteller-[a-z0-9-]+$')][string]$Prefix)
# Preconditions: authorized paused map, no modal dialog. Never toggles pause.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$saved=@(foreach($suffix in @('a','b')){
 $name="$Prefix-$suffix"
 & (Join-Path $PSScriptRoot 'save-storyteller-runtime.ps1') -SaveName $name | Out-Null
 & (Join-Path $PSScriptRoot 'read-storyteller-runtime-save.ps1') -SavePath (Join-Path $root ".local-research/runtime/profile-20261102/Saves/$name.rws") | ConvertFrom-Json
})
foreach($s in $saved){foreach($key in @('file','sha256','bytes')){$s.PSObject.Properties.Remove($key)}}
if((ConvertTo-Json $saved[0] -Depth 45 -Compress) -cne (ConvertTo-Json $saved[1] -Depth 45 -Compress)){throw "Pause pair differs: $Prefix"}
[ordered]@{prefix=$Prefix;equal_state=$true;tick=$saved[1].tick;storyteller=$saved[1].storyteller_raw;silver=@($saved[1].tracked_entities|Where-Object def -eq 'Silver')}|ConvertTo-Json -Depth 8 -Compress
