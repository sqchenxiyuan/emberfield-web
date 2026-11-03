# Read retained UI captures, original saves and action logs. Never launches the game.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime'
$profile=Join-Path $runtime 'profile-animal-husbandry-20261104'
$output=Join-Path $root 'docs/research/rimworld/evidence'
$shots=Join-Path $output 'animal-husbandry-runtime'
New-Item -ItemType Directory -Path $shots -Force|Out-Null
function Digest([string]$path){(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()}
function Project($node,[string[]]$fields){
 if(!$node){return $null};$copy=$node.CloneNode($false)
 foreach($child in $node.ChildNodes){if($child.LocalName -in $fields){[void]$copy.AppendChild($child.CloneNode($true))}}
 return $copy.OuterXml
}
function Item($node){
 if(!$node){return $null}
 [ordered]@{id=[string]$node.id;def=[string]$node.def;position=[string]$node.pos;hit_points=[int]$node.health;stack_count=[int]$node.stackCount;xml=$node.OuterXml}
}
$launch=Get-Content (Join-Path $runtime 'animal-husbandry-launch.json') -Raw|ConvertFrom-Json
$saveNames=@('animal-husbandry-baseline.rws','New Arrivals1.rws','New Arrivals2.rws','New Arrivals3.rws','New Arrivals4.rws')
$saves=@(foreach($name in $saveNames){
 $file=Join-Path $profile "Saves/$name";$doc=[xml](Get-Content -LiteralPath $file -Raw)
 $handler=$doc.SelectSingleNode('//maps/li/things/thing[id="Human958"]')
 $hare=$doc.SelectSingleNode('//maps/li/things/thing[id="Hare113769"]')
 $ground=$doc.SelectSingleNode('//maps/li/things/thing[id="RawRice113770"]')
 $inventory=@($handler.SelectNodes('inventory/innerContainer/innerList/li')|ForEach-Object{Item $_})
 $skill=$handler.SelectSingleNode('skills/skills/li[def="Animals"]')
 $food=if($hare){$hare.SelectSingleNode('needs/needs/li[def="Food"]')}else{$null}
 [ordered]@{
  file=".local-research/runtime/profile-animal-husbandry-20261104/Saves/$name";sha256=(Digest $file);ticks_game=[int]$doc.savegame.game.tickManager.ticksGame
  handler=[ordered]@{id='Human958';faction=[string]$handler.faction;name_xml=$handler.SelectSingleNode('name').OuterXml;animals_level=[int]$skill.level;animals_skill_xml=$skill.OuterXml;inventory=$inventory;inventory_xml=$handler.inventory.OuterXml;inspiration_def=[string]$handler.mindState.inspirationHandler.curState.def;inspiration_xml=$handler.mindState.inspirationHandler.OuterXml;job_xml=$handler.jobs.curJob.OuterXml}
  animal=if($hare){[ordered]@{id='Hare113769';def=[string]$hare.def;position=[string]$hare.pos;faction=[string]$hare.faction;spawned_tick=[int]$hare.spawnedTick;name_xml=$hare.SelectSingleNode('name').OuterXml;food_level=[double]$food.curLevel;xml=(Project $hare @('def','id','pos','faction','spawnedTick','name','gender','ageTracker','needs','training'))}}else{$null}
  ground_rice=(Item $ground)
  designation_xml=$doc.SelectSingleNode('//maps/li/designationManager').OuterXml
 }
})
if(($saves.ticks_game -join ',') -ne '69526,72541,73375,75812,75812'){throw 'Unexpected observation ticks'}
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('AHR01','animal-husbandry-030-inspiration-menu.png','inspiration-preparation.png',0,0,445,275),
 @('AHR02','animal-husbandry-046-tame-designated.png','wildlife-designation.png',0,1230,530,165),
 @('AHR03','animal-husbandry-054-order-menu.png','ordinary-tame-order.png',1270,690,320,105),
 @('AHR04','animal-husbandry-058-handler-gear.png','inventory-five.png',0,1015,465,380),
 @('AHR05','animal-husbandry-069-interaction2.png','taming-success.png',120,0,850,110),
 @('AHR06','animal-husbandry-070-final-inventory.png','inventory-three.png',0,1015,465,380),
 @('AHR07','animal-husbandry-071-animals-tab.png','animal-roster.png',0,1200,1220,200)
)
$images=@(foreach($spec in $specs){
 $src=Join-Path $runtime $spec[1];$dst=Join-Path $shots $spec[2]
 $bitmap=[Drawing.Bitmap]::new($src);$dims=@($bitmap.Width,$bitmap.Height)
 $rect=[Drawing.Rectangle]::new([int]$spec[3],[int]$spec[4],[int]$spec[5],[int]$spec[6]);$crop=$bitmap.Clone($rect,$bitmap.PixelFormat)
 try{$crop.Save($dst,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose();$bitmap.Dispose()}
 [ordered]@{id=$spec[0];source_file=".local-research/runtime/$($spec[1])";source_sha256=(Digest $src);source_dimensions=$dims;crop=@($spec[3],$spec[4],$spec[5],$spec[6]);file="animal-husbandry-runtime/$($spec[2])";sha256=(Digest $dst)}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter 'animal-husbandry-*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 foreach($line in Get-Content -LiteralPath $_.FullName){
  if(!$line.Trim()){continue};$a=$line|ConvertFrom-Json;$imageName=[IO.Path]::GetFileName($a.image)
  [ordered]@{source_file=".local-research/runtime/$($_.Name)";source_sha256=(Digest $_.FullName);started_utc=$a.started_utc;finished_utc=$a.finished_utc;action=$a.action;x=$a.x;y=$a.y;text=$a.text;virtual_key=$a.virtual_key;control=$a.control;duration_ms=$a.duration_ms;wait_ms=$a.wait_ms;park_x=$a.park_x;park_y=$a.park_y;image_name=$imageName;image_sha256=(Digest (Join-Path $runtime $imageName))}
 }
})
$running=@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe'"|Select-Object ProcessId,ExecutablePath)
if($running.Count){throw 'RimWorld still running; cannot record exit'}
$mods=[xml](Get-Content (Join-Path $profile 'Config/ModsConfig.xml') -Raw)
$e=[ordered]@{
 evidence_id='RW17-NATIVE-ANIMAL-HUSBANDRY';date_local='2026-11-04';version='1.7.4980 rev60'
 kind='Native developer preparation followed by ordinary designation, priority order, food pickup, interaction and original saves; no injection or save editing'
 launch=[ordered]@{started_utc=$launch.started_utc;pid=$launch.pid;launch_record='.local-research/runtime/animal-husbandry-launch.json';launch_record_sha256=(Digest (Join-Path $runtime 'animal-husbandry-launch.json'));profile='.local-research/runtime/profile-animal-husbandry-20261104';mods_config_sha256=$launch.mods_config_sha256;baseline_source_sha256=$launch.source_sha256;baseline_copy_sha256=$launch.copy_sha256;active_mods=@($mods.ModsConfigData.activeMods.li)}
 preparation=[ordered]@{developer_action=$true;method='Spawn Pawn -> Hare once; Spawn full thing stack -> RawRice once; Inspiration -> Inspired_Taming on existing Animals-12 handler Prophet. Ordinary Wildlife Tame checkbox and right-click Prioritize taming hare follow.';guaranteed_success_inspiration=$true;direct_tame_action=$false;edited_saves=$false;no_statistical_calibration=$true;input_corrections='An initial search hit the Back button. The first attempted inspiration click missed Prophet after camera movement; a later correctly targeted click applied it. No extra hare or rice stack was placed.'}
 targets=[ordered]@{handler='Human958';animal='Hare113769';ground_rice='RawRice113770';carried_rice='RawRice113776';player_faction='Faction_12'}
 saves=$saves
 timing=[ordered]@{load_to_preparation_ticks=($saves[1].ticks_game-$saves[0].ticks_game);pickup_window_ticks=($saves[2].ticks_game-$saves[1].ticks_game);observed_taming_window_ticks=($saves[3].ticks_game-$saves[1].ticks_game);after_save_pair_equal_ticks=($saves[3].ticks_game -eq $saves[4].ticks_game);exact_success_tick_measured=$false;initial_speed1_pause_pulse_ms=40;ordinary_speed3_pulses_ms=@(1000,1000,2500,4000)}
 observations=@(
  [ordered]@{id='AHR-OBS01';finding='Prepared hare was wild and designated Tame; ordinary right-click menu offered Prioritize taming hare.';evidence=@('AHR02','AHR03','saves')},
  [ordered]@{id='AHR-OBS02';finding='The handler picked up five rice from the prepared stack: ground75 ->70 and inventory0 ->5. Tame job target IDs are preserved in the native save.';evidence=@('AHR04','saves')},
  [ordered]@{id='AHR-OBS03';finding='After ordinary interaction, inventory5 ->3 while ground remains70; successful taming message names Hare1, Animals roster adds it, faction becomes player and inspiration clears. Final pair has identical selected state and tick.';evidence=@('AHR05','AHR06','AHR07','saves')}
 )
 images=$images;actions=$actions
 shutdown=[ordered]@{method='Ordinary Quit to OS at (2215,1315) after the second final save';attempted_capture='animal-husbandry-079-quit.png';capture_result='Post-exit foreground guard failed; the click was already sent, but no successful action79 entry or exit screenshot exists';observed_utc=[DateTime]::UtcNow.ToString('o');rimworld_processes_after_exit=$running}
 limitations=@('The load advanced3015 ticks before confirmed pause; preparation occurs at72541.','Inspired_Taming was granted through developer UI. The ordinary success transition and consumption are observed; natural success probability is not measured.','The four speed3 pulses total8500 wall-clock milliseconds, but3271 is a whole simulation window including walking; neither number is an interaction-duration calibration.','The final job XML still says Tame while completion notifications, faction, name and Animals roster show success; job cleanup timing was not measured.','No runtime observation of failed taming, revenge, autonomous feeding, plant grazing, breeding, birth, starvation death or maintenance decay.','Dense training arrays are retained as raw XML; their numeric indices are not treated as portable Def identifiers.','Full native screenshots and original saves remain local; only selected snapshots and crops are committed.')
}
[IO.File]::WriteAllText((Join-Path $output 'animal-husbandry-runtime-evidence.json'),($e|ConvertTo-Json -Depth 18).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($actions.Count) actions; $($images.Count) crops; $($saves.Count) saves; native exited."
