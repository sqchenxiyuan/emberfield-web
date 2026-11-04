# Projects retained native saves and screenshots; never edits or launches the game.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime/social-20261104'
$profile=Join-Path $root '.local-research/runtime/profile-social-20261104'
$out=Join-Path $root 'docs/research/rimworld/evidence';$shots=Join-Path $out 'social-runtime'
New-Item -ItemType Directory -Path $shots -Force|Out-Null
function Digest([string]$file){(Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant()}
function Project($node,[string[]]$fields){
 if(!$node){return $null};$copy=$node.CloneNode($false)
 foreach($child in $node.ChildNodes){if($child.LocalName -in $fields){[void]$copy.AppendChild($child.CloneNode($true))}}
 $copy.OuterXml
}
$names=@('social-baseline.rws','New Arrivals1.rws','New Arrivals2.rws','New Arrivals3.rws','New Arrivals4.rws')
$saves=@(foreach($name in $names){
 $file=Join-Path $profile "Saves/$name";$doc=[xml](Get-Content -LiteralPath $file -Raw);$nodes=@()
 $pawns=@(foreach($id in @('Human958','Human961')){
  $xp='//maps/li/things/thing[id="'+$id+'"]';$pawn=$doc.SelectSingleNode($xp)
  $nodes+=,[ordered]@{role=$id;xpath=$xp;fields=@('id','def','name','pos','rot','faction','jobs','pather','interactions','drafter','timetable');xml=(Project $pawn @('id','def','name','pos','rot','faction','jobs','pather','interactions','drafter','timetable'))}
  foreach($need in @('Joy','Comfort','Food','Rest')){$nx='needs/needs/li[def="'+$need+'"]';$node=$pawn.SelectSingleNode($nx);if($node){$nodes+=,[ordered]@{role=$id+'/'+$need;xpath=$xp+'/'+$nx;xml=$node.OuterXml}}}
  $other=if($id -eq 'Human958'){'Thing_Human961'}else{'Thing_Human958'}
  $mx='needs/needs/li[def="Mood"]/thoughts/memories/memories/li[otherPawn="'+$other+'" and (def="Chitchat" or def="DeepTalk" or def="Insulted" or def="InsultedMood")]'
  $selected=$pawn.SelectNodes($mx)
  $memories=@(for($i=0;$i -lt $selected.Count;$i++){
   $n=$selected[$i];$nodes+=,[ordered]@{role=$id+'/memory';xpath='('+$xp+'/'+$mx+')['+($i+1)+']';xml=$n.OuterXml}
   [ordered]@{class=[string]$n.Class;def=[string]$n.def;other=[string]$n.otherPawn;age=[int]$n.age;offset=[double]$n.opinionOffset;power=[double]$n.moodPowerFactor}
  })
  $sx='skills/skills/li[def="Social"]';$node=$pawn.SelectSingleNode($sx);if($node){$nodes+=,[ordered]@{role=$id+'/Social';xpath=$xp+'/'+$sx;xml=$node.OuterXml}}
  [ordered]@{id=$id;name=[string]$pawn.name.nick;position=[string]$pawn.pos;job=[string]$pawn.jobs.curJob.def;job_id=[int]$pawn.jobs.curJob.loadID;target_a=[string]$pawn.jobs.curJob.targetA;target_b=[string]$pawn.jobs.curJob.targetB;player_forced=([string]$pawn.jobs.curJob.playerForced -eq 'True');toil=[int]$pawn.jobs.curDriver.curToilIndex;ticks_left=[int]$pawn.jobs.curDriver.ticksLeftThisToil;last_interaction=[string]$pawn.interactions.lastInteraction;last_interaction_time=[int]$pawn.interactions.lastInteractionTime;joy=[double]$pawn.SelectSingleNode('needs/needs/li[def="Joy"]/curLevel').InnerText;comfort=[double]$pawn.SelectSingleNode('needs/needs/li[def="Comfort"]/curLevel').InnerText;memories=$memories}
 })
 foreach($id in @('Table1x2c149544','DiningChair149545','DiningChair185311')){$xp='//maps/li/things/thing[id="'+$id+'"]';$node=$doc.SelectSingleNode($xp);if($node){$nodes+=,[ordered]@{role=$id;xpath=$xp;xml=$node.OuterXml}}}
 $reservationXp='//maps/li/reservationManager/reservations/li[claimant="Thing_Human958" or claimant="Thing_Human961"]'
 $selected=$doc.SelectNodes($reservationXp);for($i=0;$i -lt $selected.Count;$i++){$nodes+=,[ordered]@{role='reservation';xpath='('+$reservationXp+')['+($i+1)+']';xml=$selected[$i].OuterXml}}
 $logXp='//game/playLog/entries/li[logID="24"]';$log=$doc.SelectSingleNode($logXp);if($log){$nodes+=,[ordered]@{role='new_interaction_log';xpath=$logXp;xml=$log.OuterXml}}
 [ordered]@{file=".local-research/runtime/profile-social-20261104/Saves/$name";sha256=(Digest $file);ticks_game=[int]$doc.savegame.game.tickManager.ticksGame;play_log_ids=@($doc.savegame.game.playLog.entries.li|ForEach-Object{[int]$_.logID});pawns=$pawns;nodes=$nodes}
})
if(($saves.ticks_game -join ',') -ne '77073,77074,78429,79055,79055'){throw 'Unexpected ticks'}
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('SR01','006-table.png','gather-spot-enabled.png',0,1235,850,170),
 @('SR02','029-prophet.png','ordinary-social-relax-seat.png',1180,550,350,290),
 @('SR03','030-social-before.png','opinion-and-log-before.png',0,700,545,630),
 @('SR04','035-social-pulse.png','automatic-deep-talk-after.png',0,700,545,630),
 @('SR05','047-prophet-opinion.png','prophet-opinion-breakdown.png',0,700,630,630),
 @('SR06','048-squint-opinion.png','squint-opinion-breakdown.png',0,700,630,630)
)
$images=@(foreach($s in $specs){
 $src=Join-Path $runtime $s[1];$dst=Join-Path $shots $s[2];$bitmap=[Drawing.Bitmap]::new($src);$dimensions=@($bitmap.Width,$bitmap.Height)
 $rect=[Drawing.Rectangle]::new([int]$s[3],[int]$s[4],[int]$s[5],[int]$s[6]);$crop=$bitmap.Clone($rect,$bitmap.PixelFormat)
 try{$crop.Save($dst,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose();$bitmap.Dispose()}
 [ordered]@{id=$s[0];source_file=".local-research/runtime/social-20261104/$($s[1])";source_sha256=(Digest $src);source_dimensions=$dimensions;crop=@($s[3],$s[4],$s[5],$s[6]);file="social-runtime/$($s[2])";sha256=(Digest $dst)}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter '*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 foreach($line in Get-Content -LiteralPath $_.FullName){if(!$line.Trim()){continue};$a=$line|ConvertFrom-Json;$img=[IO.Path]::GetFileName($a.image)
  [ordered]@{source_file=".local-research/runtime/social-20261104/$($_.Name)";source_sha256=(Digest $_.FullName);started_utc=$a.started_utc;finished_utc=$a.finished_utc;action=$a.action;x=$a.x;y=$a.y;end_x=$a.end_x;end_y=$a.end_y;text=$a.text;virtual_key=$a.virtual_key;control=$a.control;duration_ms=$a.duration_ms;wheel_delta=$a.wheel_delta;wait_ms=$a.wait_ms;park_x=$a.park_x;park_y=$a.park_y;image_name=$img;image_sha256=(Digest (Join-Path $runtime $img))}
 }
})
$running=@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe' OR Name='RimWorldWin64.exe'");if($running.Count){throw 'Native still running'}
$modsPath=Join-Path $profile 'Config/ModsConfig.xml';$mods=[xml](Get-Content $modsPath -Raw)
$launch=Get-Content (Join-Path $runtime 'launch-record.json') -Raw|ConvertFrom-Json
$shutdown=Get-Content (Join-Path $runtime 'shutdown-record.json') -Raw|ConvertFrom-Json
$e=[ordered]@{
 evidence_id='RW17-NATIVE-SOCIAL-INTERACTION';date_local='2026-11-04';version='1.7.4980 rev60'
 kind='One ordinary automatic DeepTalk during ordinary SocialRelax; prior developer chair preparation, read-only save projections and native UI'
 launch=[ordered]@{pid=$launch.pid;started_utc=$launch.started_utc;executable=$launch.executable;profile='.local-research/runtime/profile-social-20261104';record_file='.local-research/runtime/social-20261104/launch-record.json';record_sha256=(Digest (Join-Path $runtime 'launch-record.json'));baseline_source='.local-research/runtime/profile-dining-20261104/Saves/New Arrivals7.rws';baseline_source_sha256=$launch.baseline_sha256;baseline_copy_sha256=$saves[0].sha256;prefs_sha256=$launch.prefs_sha256;mods_sha256=$launch.mods_sha256;active_mods=@($mods.ModsConfigData.activeMods.li)}
 preparation=[ordered]@{developer_action=$true;edited_saves=$false;method='God-mode copy of one wooden normal chair at119,134; God off. Ordinary partial recreation schedule painting. Existing table/one chair and pawns from prior dining baseline. Debug search need returned no action; no need level, forced interaction or forced JoyGiver was executed.';schedule_limit='12-step drag painted alternating hour cells, not all24; current13h was Joy. Saved timetable is authoritative.';no_statistical_calibration=$true}
 targets=[ordered]@{initiator='Human961';recipient='Human958';table='Table1x2c149544';occupied_chair='DiningChair149545';added_chair='DiningChair185311';new_log_id=24;event_tick=78450}
 saves=$saves;images=$images;actions=$actions
 observations=@(
  [ordered]@{id='SR-OBS01';finding='At78429 Prophet is seated119,131 in ordinary SocialRelax job48947,toil1,ticksLeft3978; nearby Squint is GotoWander122,129. No new log exists; old paired DeepTalk memories number2 each.';evidence=@('SR02','SR03','saves')},
  [ordered]@{id='SR-OBS02';finding='New log24 is DeepTalk, Squint→Prophet at absolute148450 (game tick78450); both lastInteractionTime=78450. At79055 both have a third paired DeepTalk age600, offsets13.5374994/12.3000002 and power.902499974/.819999993. Old Chitchat offsets remain unchanged.';evidence=@('SR04','saves')},
  [ordered]@{id='SR-OBS03';finding='Prophet opinion of Squint54→65; reverse51→61. After tooltips show crashed-together25,DeepTalkx3=37/33,Chitchat3. Totals reflect stacking and rounding, not simply adding raw15.';evidence=@('SR03','SR04','SR05','SR06')},
  [ordered]@{id='SR-OBS04';finding='Prophet keeps the same SocialRelax job48947,toil1 and seat through the interval,ticksLeft3978→3352; joy.797087073→.88470453 and comfort.12240003→.266400039. Squint moves on to Clean. No conversation job was assigned through UI.';evidence=@('SR02','SR05','SR06','saves')},
  [ordered]@{id='SR-OBS05';finding='Final repeated saves have matching selected state at79055. Ordinary Quit to OS followed; fresh CIM confirms no native game process.';evidence=@('saves','shutdown')}
 )
 shutdown=[ordered]@{record_file='.local-research/runtime/social-20261104/shutdown-record.json';record_sha256=(Digest (Join-Path $runtime 'shutdown-record.json'));observed_utc=$shutdown.observed_utc;method=$shutdown.method;capture_result=$shutdown.capture_result;rimworld_processes_after_exit=@($shutdown.processes)}
 limitations=@('Only DeepTalk was newly observed; Chitchat and Insult behavior remains static evidence in this round.','The event moment bubble was not captured; durable log, memories and before/after UI are retained.','Squint was already requesting random interaction before the event; no causal claim that SocialRelax initiated the observed interaction.','A sampled before-position is not an exact event-position trace.','Two developer-generated chair qualities/work costs are not runtime construction measurements.','No full4000tick completion, seat contention, gather toggle-off, ordinary no-chair fallback or interruption branch was exercised.','Selected original nodes/crops/hashes are public; raw complete saves/screenshots remain local.','Actions17–19 and36–40 include harmless menu-navigation misses; successful saves are22,33,43,52. No missing save or action53 is fabricated.','Need ages update in150tick batches; participants can have different age phases.','Observation ends in mid-job; repeated paused save is an integrity check, not a full reload trial.')
}
[IO.File]::WriteAllText((Join-Path $out 'social-runtime-evidence.json'),($e|ConvertTo-Json -Depth 22).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($actions.Count) actions; $($images.Count) crops; $($saves.Count) saves; native exited."
