param()
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime/item-forbidden-20261104'
$profile=Join-Path $root '.local-research/runtime/profile-item-forbidden-20261104'
$source=Join-Path $root '.local-research/runtime/profile-river-bridge-20261104'
$baseline=Join-Path $source 'Saves/RiverBridgeBaseline.rws'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
if(@(Get-CimInstance Win32_Process -Filter "Name LIKE 'RimWorld%'").Count){throw 'Existing RimWorld process; no launch'}
if(Test-Path -LiteralPath $profile){throw 'Dedicated profile already exists; no overwrite'}
if((Hash $baseline) -ne 'ab629e9b0d24252991f47d2c57149ad29c8152db24b1c004b5659a74862620cd'){throw 'Baseline changed'}
$assembly='F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll'
if((Hash $assembly) -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Assembly changed'}
New-Item -ItemType Directory -Path $runtime,(Join-Path $profile 'Saves'),(Join-Path $profile 'Config') -Force|Out-Null
Copy-Item -LiteralPath $baseline -Destination (Join-Path $profile 'Saves/ItemForbiddenBaseline.rws')
foreach($name in @('Prefs.xml','KeyPrefs.xml','ModsConfig.xml')){Copy-Item -LiteralPath (Join-Path $source "Config/$name") -Destination (Join-Path $profile "Config/$name")}
$argsText='-popupwindow -screen-width 2560 -screen-height 1440 -savedatafolder="'+$profile+'" -logfile="'+(Join-Path $runtime 'Player.log')+'"'
$p=Start-Process -FilePath 'F:/SteamLibrary/steamapps/common/RimWorld/RimWorld.exe' -ArgumentList $argsText -WindowStyle Hidden -PassThru
$record=[ordered]@{createdUtc=[DateTime]::UtcNow.ToString('o');pid=$p.Id;profile=$profile;baseline=$baseline;copiedBaseline=(Join-Path $profile 'Saves/ItemForbiddenBaseline.rws');baselineSha256=Hash $baseline;assemblySha256=Hash $assembly;existingRimWorldAbsentBeforeLaunch=$true;commandLine=(Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)").CommandLine;preparation='Unchanged developer-prepared camp from prior river-bridge research; no new developer preparation or save XML edits in this trial.'}
$record|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $runtime 'launch-record.json') -Encoding utf8
$record|ConvertTo-Json -Depth 6
