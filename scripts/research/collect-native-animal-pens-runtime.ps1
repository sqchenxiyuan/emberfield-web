# Read original saves and retained UI captures. Never launches or modifies the game.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime'
$profile=Join-Path $runtime 'profile-animal-pens-20261104'
$out=Join-Path $root 'docs/research/rimworld/evidence'
$shots=Join-Path $out 'animal-pens-runtime'
New-Item -ItemType Directory -Path $shots -Force|Out-Null
function Digest([string]$file){(Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant()}
function Project($node,[string[]]$fields){
 if(!$node){return $null};$copy=$node.CloneNode($false)
 foreach($child in $node.ChildNodes){if($child.LocalName -in $fields){[void]$copy.AppendChild($child.CloneNode($true))}}
 $copy.OuterXml
}
function Pawn($node){
 if(!$node){return $null}
 [ordered]@{id=[string]$node.id;def=[string]$node.def;position=[string]$node.pos;faction=[string]$node.faction;gender_stored=[string]$node.gender;name_xml=$node.name.OuterXml;job=[string]$node.jobs.curJob.def;jobs_xml=$node.jobs.OuterXml;roping_xml=$node.roping.OuterXml;roped_to=[string]$node.roping.ropedTo;ropees=@($node.roping.ropees.li|Where-Object{$_});player_settings_xml=$node.playerSettings.OuterXml;xml=(Project $node @('def','id','pos','faction','name','gender','jobs','roping','playerSettings','drafter'))}
}
$launch=Get-Content (Join-Path $runtime 'animal-pens-launch.json') -Raw|ConvertFrom-Json
$names=@('animal-pens-baseline.rws','New Arrivals1.rws','New Arrivals2.rws','New Arrivals3.rws','New Arrivals4.rws','New Arrivals5.rws','New Arrivals6.rws')
$saves=@(foreach($name in $names){
 $file=Join-Path $profile "Saves/$name";$doc=[xml](Get-Content -LiteralPath $file -Raw)
 $gate=$doc.SelectSingleNode('//maps/li/things/thing[id="FenceGate149577"]')
 $marker=$doc.SelectSingleNode('//maps/li/things/thing[id="PenMarker149578"]')
 [ordered]@{
  file=".local-research/runtime/profile-animal-pens-20261104/Saves/$name";sha256=(Digest $file);ticks_game=[int]$doc.savegame.game.tickManager.ticksGame
  handler=(Pawn $doc.SelectSingleNode('//maps/li/things/thing[id="Human958"]'))
  deer=(Pawn $doc.SelectSingleNode('//maps/li/things/thing[id="Deer149579"]'))
  hare=(Pawn $doc.SelectSingleNode('//maps/li/things/thing[id="Hare113769"]'))
  gate=if($gate){[ordered]@{id=[string]$gate.id;position=[string]$gate.pos;open=([string]$gate.open -eq 'True');hold_open=([string]$gate.holdOpen -eq 'True');xml=$gate.OuterXml}}else{$null}
  marker=if($marker){[ordered]@{id=[string]$marker.id;position=[string]$marker.pos;filter_xml=$marker.animalFilter.OuterXml;allowed_defs=@($marker.animalFilter.allowedDefs.li);disallowed_special_filters=@($marker.animalFilter.disallowedSpecialFilters.li|Where-Object{$_});xml=(Project $marker @('def','id','pos','health','stuff','faction','label','animalFilter'))}}else{$null}
  fences=@($doc.SelectNodes('//maps/li/things/thing[def="Fence"]')|ForEach-Object{[ordered]@{id=[string]$_.id;position=[string]$_.pos;xml=(Project $_ @('def','id','pos','health','stuff','faction'))}})
 }
})
if(($saves.ticks_game -join ',') -ne '75812,75813,76651,77073,76756,77990,77990'){throw 'Unexpected observation ticks'}
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('APR01','animal-pens-032-dev-tame-tool.png','developer-preparation.png',1260,720,510,290),
 @('APR02','animal-pens-037-males-disallowed.png','sex-filter.png',0,730,300,480),
 @('APR03','animal-pens-055-rope-menu-held.png','ordinary-rope-order.png',1610,1010,250,80),
 @('APR04','animal-pens-078-deer-rope-status.png','roped-inspector.png',0,1235,430,155),
 @('APR05','animal-pens-065-marker-status.png','enclosed-pen-and-deer.png',1740,790,320,290),
 @('APR06','animal-pens-065-marker-status.png','enclosed-pen-inspector.png',0,1235,430,145),
 @('APR07','animal-pens-093-unenclosed-status.png','open-gate-boundary.png',1720,790,340,285),
 @('APR08','animal-pens-093-unenclosed-status.png','unenclosed-inspector.png',0,1235,430,150),
 @('APR09','animal-pens-094-animals-roster.png','allowed-area-versus-pen.png',0,1185,1215,220)
)
$images=@(foreach($s in $specs){
 $src=Join-Path $runtime $s[1];$dst=Join-Path $shots $s[2];$bitmap=[Drawing.Bitmap]::new($src);$dimensions=@($bitmap.Width,$bitmap.Height)
 $rect=[Drawing.Rectangle]::new([int]$s[3],[int]$s[4],[int]$s[5],[int]$s[6]);$crop=$bitmap.Clone($rect,$bitmap.PixelFormat)
 try{$crop.Save($dst,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose();$bitmap.Dispose()}
 [ordered]@{id=$s[0];source_file=".local-research/runtime/$($s[1])";source_sha256=(Digest $src);source_dimensions=$dimensions;crop=@($s[3],$s[4],$s[5],$s[6]);file="animal-pens-runtime/$($s[2])";sha256=(Digest $dst)}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter 'animal-pens-*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 foreach($line in Get-Content -LiteralPath $_.FullName){if(!$line.Trim()){continue};$a=$line|ConvertFrom-Json;$img=[IO.Path]::GetFileName($a.image)
  [ordered]@{source_file=".local-research/runtime/$($_.Name)";source_sha256=(Digest $_.FullName);started_utc=$a.started_utc;finished_utc=$a.finished_utc;action=$a.action;x=$a.x;y=$a.y;end_x=$a.end_x;end_y=$a.end_y;text=$a.text;virtual_key=$a.virtual_key;control=$a.control;duration_ms=$a.duration_ms;wait_ms=$a.wait_ms;park_x=$a.park_x;park_y=$a.park_y;image_name=$img;image_sha256=(Digest (Join-Path $runtime $img))}
 }
})
$running=@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe'"|Select-Object ProcessId,ExecutablePath)
if($running.Count){throw 'Native game still running'}
$mods=[xml](Get-Content (Join-Path $profile 'Config/ModsConfig.xml') -Raw)
$e=[ordered]@{
 evidence_id='RW17-NATIVE-ANIMAL-PENS';date_local='2026-11-04';version='1.7.4980 rev60'
 kind='Native developer preparation, then ordinary filter/priority roping, saved rope references, movement/release and held-open gate; no injection or save editing'
 launch=[ordered]@{started_utc=$launch.started_utc;pid=$launch.pid;launch_record='.local-research/runtime/animal-pens-launch.json';launch_record_sha256=(Digest (Join-Path $runtime 'animal-pens-launch.json'));profile='.local-research/runtime/profile-animal-pens-20261104';baseline_source_sha256=$launch.source_sha256;baseline_copy_sha256=$launch.copy_sha256;mods_config_sha256=$launch.mods_config_sha256;active_mods=@($mods.ModsConfigData.activeMods.li);prefs_source_sha256=$launch.prefs_source_sha256;prefs_prepared_sha256=$launch.prefs_prepared_sha256;configuration_change=$launch.configuration_change}
 preparation=[ordered]@{developer_action=$true;method='God mode built wooden Fence/FenceGate/PenMarker immediately; Spawn Pawn -> Deer once; Tame Animal on that deer. God mode then disabled. Existing Prophet and Hare1 retained.';direct_tame_action=$true;edited_saves=$false;no_statistical_calibration=$true;load_to_preparation_ticks=1;input_corrections='Escape initially closed Architect without canceling placement; an identical-marker placement was rejected. Right-click menus disappeared while the cursor was parked far away; keeping the cursor nearby retained the ordinary menu. Action62 attempted a pulse while the escape menu was still open, so it is not a measured gameplay interval.'}
 targets=[ordered]@{handler='Human958';deer='Deer149579';hare='Hare113769';marker='PenMarker149578';gate='FenceGate149577';player_faction='Faction_12'}
 saves=$saves
 branches=[ordered]@{main_sequence=@(0,1,2,3);reload_action=75;reload_source_save=2;second_sequence=@(2,4,5,6);reason='First sample2 retained approach before actual rope; ordinary reload of that original save allowed a shorter pulse and sample4 of actual bidirectional rope. This is not a single monotonic-tick sequence or an automated replay.'}
 observations=@(
  [ordered]@{id='APR-OBS01';finding='Ordinary marker UI disallowed males. Save1 retains AllowMaleGender in disallowedSpecialFilters, while Deer remains in allowedDefs. Re-enabling males removed that filter before the ordinary roping order.';evidence=@('APR02','saves')},
  [ordered]@{id='APR-OBS02';finding='Ordinary context menu offered Prioritize roping Buck1. Save2 has playerForced RopeToPen/TakeToPen targeting Deer149579 and PenMarker149578, but rope state is still empty: it is approach, not attachment.';evidence=@('APR03','saves')},
  [ordered]@{id='APR-OBS03';finding='After ordinary reload of save2, save4 at76756 has deer.ropedTo=Thing_Human958 and handler.ropees=[Thing_Deer149579]; deer Wait has expiryInterval30 and queued FollowRoper. Inspector says Roped by: Prophet.';evidence=@('APR04','saves')},
  [ordered]@{id='APR-OBS04';finding='The first run save3 has deer at(125,0,141), inside the fence beyond the gate(124,0,141); ropes are cleared and handler resumed FeedPatient. Marker is green/enclosed, with nutrition consumption0.32. The later shorter-pulse branch also enters the pen before the gate experiment.';evidence=@('APR05','APR06','saves')},
  [ordered]@{id='APR-OBS05';finding='Ordinary Hold open toggle and drafted human movement through the gate yield Unenclosed(open door). Final identical selected-state saves at77990 retain open=True/holdOpen=True; deer remains player-owned and spawned. No roaming or exit was observed.';evidence=@('APR07','APR08','saves')},
  [ordered]@{id='APR-OBS06';finding='Animals roster shows allowed-area controls for Hare1, while Buck1 shows not in a pen. No area reassignment or return travel was tested.';evidence=@('APR09')}
 )
 images=$images;actions=$actions
 shutdown=[ordered]@{method='Ordinary Quit to OS at(2215,1315), after final duplicate save';attempted_capture='animal-pens-100-quit.png';capture_result='Exit click was sent; post-exit foreground guard failed. No successful action100 record or exit screenshot exists.';observed_utc=[DateTime]::UtcNow.ToString('o');rimworld_processes_after_exit=$running}
 limitations=@('Baseline75812 and preparation75813 show one tick of advancement despite pauseOnLoad preparation.','All buildings and tame deer were developer-prepared; no normal build costs/time or natural tame success are measured. The developer tame notification names Grump; it is not evidence that Grump performed ordinary taming.','First approach screenshot includes a job target line; save2 explicitly has no rope. Actual rope is established only by save4 and the inspector.','A normal reload creates a documented branch; save3 and save4 cannot be treated as chronological tick order.','Wall-clock pulses include scheduling/walking and are not job-duration calibration. The save ticks are authoritative.','No normal fence destruction, permanent escape, natural Roaming, species-filter exclusion, allowed-area travel, grass sustainability, birth or statistical probabilities were tested.','All samples are below300000ticks, so the five-day natural Roaming grace period has not elapsed.','Only selected XML projections/crops/hashes are public; full native screenshots and saves remain local.')
}
[IO.File]::WriteAllText((Join-Path $out 'animal-pens-runtime-evidence.json'),($e|ConvertTo-Json -Depth 20).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($actions.Count) actions; $($images.Count) crops; $($saves.Count) saves; native exited."
