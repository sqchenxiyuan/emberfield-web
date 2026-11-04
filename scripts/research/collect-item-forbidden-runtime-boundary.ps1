param([switch]$Check)
# Retained-file audit only. No launch, process termination, GUI input or new capture.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtimeRelative='.local-research/runtime/item-forbidden-20261104'
$profileRelative='.local-research/runtime/profile-item-forbidden-20261104'
$runtime=Join-Path $root $runtimeRelative
$output=Join-Path $root 'docs/research/rimworld/evidence/item-forbidden-runtime-boundary.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
$launchFile=Join-Path $runtime 'launch-record.json';$interruptionFile=Join-Path $runtime 'interruption-record.json'
$launch=Get-Content -LiteralPath $launchFile -Raw|ConvertFrom-Json
$interruption=Get-Content -LiteralPath $interruptionFile -Raw|ConvertFrom-Json
if($launch.pid -ne 35384 -or !$launch.existingRimWorldAbsentBeforeLaunch -or $interruption.targetPid -ne 35384 -or $interruption.stillRunning -or $interruption.newMechanismScenariosCompleted -ne 0){throw 'Unexpected launch/interruption identity'}
if([IO.Path]::GetFullPath($launch.profile) -ne [IO.Path]::GetFullPath((Join-Path $root $profileRelative))){throw 'Unexpected profile'}
$baselineHash='ab629e9b0d24252991f47d2c57149ad29c8152db24b1c004b5659a74862620cd'
if($launch.baselineSha256 -ne $baselineHash -or (Hash $launch.baseline) -ne $baselineHash -or (Hash $launch.copiedBaseline) -ne $baselineHash){throw 'Copied baseline changed'}
$saves=@(Get-ChildItem -LiteralPath (Join-Path $root "$profileRelative/Saves") -Filter '*.rws')
if($saves.Count -ne 1 -or $saves[0].Name -ne 'ItemForbiddenBaseline.rws'){throw 'Unexpected new native save; reassess boundary before updating'}
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter '*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 $f=$_;$action=Get-Content -LiteralPath $f.FullName -Raw|ConvertFrom-Json
 $captureFile=$f.FullName.Replace('.actions.jsonl','.jsonl');$capture=Get-Content -LiteralPath $captureFile -Raw|ConvertFrom-Json
 $imageFile=$f.FullName.Replace('.actions.jsonl','')
 if($action.pid -ne 35384 -or $capture.pid -ne 35384 -or $capture.width -ne 2560 -or $capture.height -ne 1440 -or $action.profile -ne $launch.profile){throw 'Preparation receipt identity differs'}
 [ordered]@{ordinal=[int]$f.Name.Substring(0,3);file="$runtimeRelative/$($f.Name)";sha256=Hash $f.FullName;action=$action;captureSha256=Hash $captureFile;imageSha256=Hash $imageFile}
})
if($actions.Count -ne 4 -or ($actions.ordinal -join ';') -ne '1;2;3;4' -or ($actions.action.action -join ';') -ne 'capture;capture;click;click'){throw 'Preparation sequence changed'}
if([datetime]$actions[-1].action.finished_utc -ne [datetime]$interruption.acquisitionCutoffUtc){throw 'Cutoff differs'}
if($actions[2].action.x -ne 2160 -or $actions[2].action.y -ne 690 -or $actions[3].action.x -ne 1469 -or $actions[3].action.y -ne 442){throw 'Recorded loading clicks changed'}
$scripts=@(foreach($name in @('launch-item-forbidden-runtime.ps1','item-forbidden-runtime-input.ps1')){[ordered]@{file="scripts/research/$name";sha256=Hash (Join-Path $PSScriptRoot $name);status='Historical preparation helper; not invoked by this collector or authorized for replay while user pause is active'}})
$record=[ordered]@{evidence_id='RW17-ITEM-FORBIDDEN-RUNTIME-BOUNDARY';status='Preparation interrupted; zero completed v45 forbidden gameplay scenarios';version='1.7.4980 rev60';assemblySha256=$launch.assemblySha256;launch=$launch;launchSha256=Hash $launchFile;interruption=$interruption;interruptionSha256=Hash $interruptionFile;baseline=[ordered]@{file="$profileRelative/Saves/ItemForbiddenBaseline.rws";sha256=$baselineHash;preparation='Unchanged copy of earlier developer-prepared river-bridge camp, not a v45 gameplay result'};actions=$actions;scripts=$scripts;newNativeSaveCount=0;publicScreenshotCount=0;limits=@('Four receipts document startup and two load-menu clicks only; no forbid/allow, hauling, food, material, equipment, trade or reload scenario was completed.','The file name 004-loaded is an intended capture label, not proof of gameplay success.','The retained images remain local because full screenshots can include account/notification UI. Only their hashes are published.','Process absence was observed by a read-only CIM check; no normal Quit to OS or exact exit cause is claimed.','After the user paused further program interaction, no new game launch, GUI input or screenshot was performed.','Existing v44 allowed-area runtime evidence is a different experiment and cannot establish v45 item-forbidden behavior.');collectorSha256=Hash $PSCommandPath}
$json=($record|ConvertTo-Json -Depth 20).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($output) -cne $json){throw 'Retained preparation boundary differs'};'Checked retained item-forbidden preparation boundary; no runtime scenario claimed'}else{[IO.File]::WriteAllText($output,$json,[Text.UTF8Encoding]::new($false));'Collected item-forbidden preparation boundary'}
