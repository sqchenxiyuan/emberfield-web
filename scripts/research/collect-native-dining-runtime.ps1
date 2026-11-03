# Projects retained native saves and crops; never launches or edits the game.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime/dining-20261104'
$profile=Join-Path $root '.local-research/runtime/profile-dining-20261104'
$out=Join-Path $root 'docs/research/rimworld/evidence'
$shots=Join-Path $out 'dining-runtime'
New-Item -ItemType Directory -Path $shots -Force|Out-Null
function Digest([string]$file){(Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant()}
function Project($node,[string[]]$fields){
 if(!$node){return $null};$copy=$node.CloneNode($false)
 foreach($child in $node.ChildNodes){if($child.LocalName -in $fields){[void]$copy.AppendChild($child.CloneNode($true))}}
 $copy.OuterXml
}
$names=@('dining-baseline.rws','New Arrivals1.rws','New Arrivals2.rws','New Arrivals3.rws','New Arrivals4.rws','New Arrivals5.rws','New Arrivals6.rws','New Arrivals7.rws')
$saves=@(foreach($name in $names){
 $file=Join-Path $profile "Saves/$name";$doc=[xml](Get-Content -LiteralPath $file -Raw)
 $pawnPath='//maps/li/things/thing[id="Human958"]';$pawn=$doc.SelectSingleNode($pawnPath)
 $food=$pawn.SelectSingleNode('needs/needs/li[def="Food"]');$comfort=$pawn.SelectSingleNode('needs/needs/li[def="Comfort"]')
 $memory=$pawn.SelectSingleNode('needs/needs/li[def="Mood"]/thoughts/memories/memories/li[def="AteWithoutTable"]')
 $nodes=@([ordered]@{role='pawn';xpath=$pawnPath;xml=(Project $pawn @('id','def','pos','rot','faction','jobs','pather','carryTracker','drafter'))})
 foreach($s in @(@('food','needs/needs/li[def="Food"]'),@('comfort','needs/needs/li[def="Comfort"]'),@('without_table','needs/needs/li[def="Mood"]/thoughts/memories/memories/li[def="AteWithoutTable"]'))){
  $node=$pawn.SelectSingleNode($s[1]);if($node){$nodes+=,[ordered]@{role=$s[0];xpath=$pawnPath+'/'+$s[1];xml=$node.OuterXml}}
 }
 foreach($id in @('Table1x2c149544','DiningChair149545','MealSurvivalPack41855')){
  $xp='//maps/li/things/thing[id="'+$id+'"]';$node=$doc.SelectSingleNode($xp)
  if($node){$nodes+=,[ordered]@{role=$id;xpath=$xp;xml=$node.OuterXml}}
 }
 foreach($xp in @('//maps/li/reservationManager/reservations/li[claimant="Thing_Human958"]','//maps/li/pawnDestinationReservationManager/reservedDestinations/values/li/list/li[claimant="Thing_Human958"]')){
  $selected=$doc.SelectNodes($xp);for($i=0;$i -lt $selected.Count;$i++){$nodes+=,[ordered]@{role='reservation';xpath='('+$xp+')['+($i+1)+']';xml=$selected[$i].OuterXml}}
 }
 [ordered]@{
  file=".local-research/runtime/profile-dining-20261104/Saves/$name";sha256=(Digest $file);ticks_game=[int]$doc.savegame.game.tickManager.ticksGame
  pawn=[ordered]@{id=[string]$pawn.id;position=[string]$pawn.pos;job=[string]$pawn.jobs.curJob.def;job_target_a=[string]$pawn.jobs.curJob.targetA;job_target_b=[string]$pawn.jobs.curJob.targetB;player_forced=([string]$pawn.jobs.curJob.playerForced -eq 'True');toil=[int]$pawn.jobs.curDriver.curToilIndex;ticks_left=[int]$pawn.jobs.curDriver.ticksLeftThisToil;path_destination=[string]$pawn.pather.destination;food=[double]$food.curLevel;comfort=[double]$comfort.curLevel;without_table_age=[int]$memory.age;carry=@($pawn.carryTracker.innerContainer.innerList.li|Where-Object{$_}|ForEach-Object{[ordered]@{id=[string]$_.id;def=[string]$_.def;count=[int]$_.stackCount}})}
  reservations=@($doc.SelectNodes('//maps/li/reservationManager/reservations/li[claimant="Thing_Human958"]')|ForEach-Object{[string]$_.target})
  destination_reservations=@($doc.SelectNodes('//maps/li/pawnDestinationReservationManager/reservedDestinations/values/li/list/li[claimant="Thing_Human958"]')|ForEach-Object{[string]$_.target})
  nodes=$nodes
 }
})
if(($saves.ticks_game -join ',') -ne '75812,76627,76724,75813,76253,76670,77073,77073'){throw 'Unexpected observation ticks'}
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('DR01','009-meal-menu.png','ordinary-consume-order.png',1170,1020,340,130),
 @('DR02','011-walk-without-table.png','no-table-chewing.png',1000,990,290,155),
 @('DR03','017-without-table-needs.png','no-table-needs.png',0,690,580,525),
 @('DR04','030-place-chair.png','developer-furniture-preparation.png',1460,800,310,190),
 @('DR05','041-carry-to-table.png','carrying-to-reserved-seat.png',1340,930,340,340),
 @('DR06','047-chew-needs.png','table-chewing.png',1500,925,240,170),
 @('DR07','047-chew-needs.png','comfort-rising-during-chew.png',0,690,580,525),
 @('DR08','058-finished-needs.png','comfort-after-meal.png',0,690,580,525)
)
$images=@(foreach($s in $specs){
 $src=Join-Path $runtime $s[1];$dst=Join-Path $shots $s[2];$bitmap=[Drawing.Bitmap]::new($src);$dimensions=@($bitmap.Width,$bitmap.Height)
 $rect=[Drawing.Rectangle]::new([int]$s[3],[int]$s[4],[int]$s[5],[int]$s[6]);$crop=$bitmap.Clone($rect,$bitmap.PixelFormat)
 try{$crop.Save($dst,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose();$bitmap.Dispose()}
 [ordered]@{id=$s[0];source_file=".local-research/runtime/dining-20261104/$($s[1])";source_sha256=(Digest $src);source_dimensions=$dimensions;crop=@($s[3],$s[4],$s[5],$s[6]);file="dining-runtime/$($s[2])";sha256=(Digest $dst)}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter '*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 foreach($line in Get-Content -LiteralPath $_.FullName){if(!$line.Trim()){continue};$a=$line|ConvertFrom-Json;$img=[IO.Path]::GetFileName($a.image)
  [ordered]@{source_file=".local-research/runtime/dining-20261104/$($_.Name)";source_sha256=(Digest $_.FullName);started_utc=$a.started_utc;finished_utc=$a.finished_utc;action=$a.action;x=$a.x;y=$a.y;end_x=$a.end_x;end_y=$a.end_y;text=$a.text;virtual_key=$a.virtual_key;control=$a.control;duration_ms=$a.duration_ms;wheel_delta=$a.wheel_delta;wait_ms=$a.wait_ms;park_x=$a.park_x;park_y=$a.park_y;image_name=$img;image_sha256=(Digest (Join-Path $runtime $img))}
 }
})
$running=@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe' OR Name='RimWorldWin64.exe'"|Select-Object ProcessId,ExecutablePath)
if($running.Count){throw 'Native game still running'}
$modsPath=Join-Path $profile 'Config/ModsConfig.xml';$mods=[xml](Get-Content $modsPath -Raw)
$baselineSource=Join-Path $root '.local-research/runtime/profile-animal-husbandry-20261104/Saves/New Arrivals3.rws'
$e=[ordered]@{
 evidence_id='RW17-NATIVE-DINING-COMFORT';date_local='2026-11-04';version='1.7.4980 rev60'
 kind='Ordinary consumption in two save branches; second branch has developer-built table/chair; UI input, original saves and crops, no injection/save editing'
 launch=[ordered]@{pid=16708;executable='F:/SteamLibrary/steamapps/common/RimWorld/RimWorld.exe';profile='.local-research/runtime/profile-dining-20261104';baseline_source='.local-research/runtime/profile-animal-husbandry-20261104/Saves/New Arrivals3.rws';baseline_source_sha256=(Digest $baselineSource);baseline_copy_sha256=$saves[0].sha256;active_mods=@($mods.ModsConfigData.activeMods.li);mods_config_sha256=(Digest $modsPath);configuration_change='Copied prior isolated Config; pauseOnLoad False -> True in this profile before launch';launch_record_limit='Launch command is retained in task tool history; no separate contemporaneous launch-record JSON or prelaunch Prefs digest was captured.'}
 preparation=[ordered]@{developer_action=$true;method='Ordinary reload of dining-baseline, then God-mode wooden Table1x2c and DiningChair placement at75813; God mode disabled before ordinary Consume. Food and pawn reused from baseline.';edited_saves=$false;no_statistical_calibration=$true;load_to_preparation_ticks=1}
 targets=[ordered]@{pawn='Human958';table='Table1x2c149544';chair='DiningChair149545';source_meal_stack='MealSurvivalPack41855';player_faction='Faction_12'}
 branches=[ordered]@{without_table=@(0,1,2);reload_action=22;reload_source_save=0;with_table=@(0,3,4,5,6,7);reason='Same baseline ordinary reload controls prior memory; chronological action order includes a tick rollback and different object ids. No probability inference.'}
 saves=$saves;images=$images;actions=$actions
 observations=@(
  [ordered]@{id='DR-OBS01';finding='Ordinary context menu offered Consume packaged survival meal. First branch Ingest is playerForced; at76627 carry has one meal, chewing has30ticks remaining, food0.486 and prior memory age10350.';evidence=@('DR01','DR02','saves')},
  [ordered]@{id='DR-OBS02';finding='No-table completion at76724 has food0.994, job FeedPatient and memory age150, establishing refresh versus the older baseline9600/chewing10350. Comfort stays0.';evidence=@('DR03','saves')},
  [ordered]@{id='DR-OBS03';finding='After ordinary baseline reload, developer placement yields wooden normal-quality table119,132 and chair119,131 at75813; food is reused, not spawned. The base branch has no such furniture.';evidence=@('DR04','saves')},
  [ordered]@{id='DR-OBS04';finding='At76253 the pawn carries MealSurvivalPack149549 while walking from112,125 toward119,131; both chair and destination cell reservations belong to its Ingest job. At76670 pawn actually occupies the chair, targetB is the table cell, and the same meal remains carried during chewing.';evidence=@('DR05','DR06','saves')},
  [ordered]@{id='DR-OBS05';finding='Comfort changes0 ->0.036 during table chewing ->0.144 after completion. Food remains0.486 while chewing, then0.994 after. Old AteWithoutTable ages to10800 rather than refreshing; it stays visible. Uncomfortable disappears when Comfort passes0.1, independently of the old memory.';evidence=@('DR07','DR08','saves')},
  [ordered]@{id='DR-OBS06';finding='Final two ordinary saves retain identical selected pawn/node/reservation state at77073. Ordinary Quit to OS followed; fresh CIM sees no RimWorld process.';evidence=@('saves')}
 )
 shutdown=[ordered]@{method='Ordinary Quit to OS at(2215,1315) after repeat save';attempted_capture='062-quit.png';capture_result='Exit click sent; post-exit screenshot foreground guard failed. No successful action62 or exit screenshot was fabricated.';observed_utc=[DateTime]::UtcNow.ToString('o');rimworld_processes_after_exit=$running}
 limitations=@('Baseline has an existing AteWithoutTable memory; age refresh is the decisive comparison, not presence/absence.','Need/memory updates are sampled and may occur in batches; displayed ages are saved values, not a fitted per-tick timeline.','Food0.994 after sampling includes time since eating; it is not an exact immediate nutrition increment or meal-size calibration.','Developer instant furniture placement does not measure construction work/cost/quality generation.','No simultaneous diners, blocked/forbidden/burning chair, no-chair table-only branch, interruption, drafted eating, distant-seat boundary or dining-room mood bonus was exercised. Those remain static conclusions or untested.','Only selected nodes/crops/hashes are public; raw saves/screenshots remain local.','The initial click inspected rice but no rice-consume order was sent. Zoom screenshot52 contains a beauty tooltip; clean earlier screenshot47 is used for table evidence.','Two branches explicitly roll back ticks. Final duplicate save checks selected state only, not byte-identical complete saves.')
}
[IO.File]::WriteAllText((Join-Path $out 'dining-runtime-evidence.json'),($e|ConvertTo-Json -Depth 20).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($actions.Count) actions; $($images.Count) crops; $($saves.Count) saves; native exited."
