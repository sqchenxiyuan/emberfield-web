# Read-only projections of ordinary furniture relocation; never edits or loads saves.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime/furniture-reinstall-20261104'
$profile=Join-Path $root '.local-research/runtime/profile-furniture-reinstall-20261104'
$out=Join-Path $root 'docs/research/rimworld/evidence';$shots=Join-Path $out 'furniture-reinstall-runtime'
New-Item -ItemType Directory -Path $shots -Force|Out-Null
function Digest([string]$file){(Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant()}
function Project($node,[string[]]$fields){$copy=$node.CloneNode($false);foreach($child in $node.ChildNodes){if($child.LocalName -in $fields){[void]$copy.AppendChild($child.CloneNode($true))}};$copy.OuterXml}
$specs=@(
 @('bed','//*[id="Bed221087"]'),
 @('installed_bed','//maps/li/things/thing[id="Bed221087"]'),
 @('wrapper','//*[id="MinifiedThing292600"]'),
 @('blueprint','//*[id="Blueprint_Install_Bed292601"]'),
 @('worker','//maps/li/things/thing[id="Human958"]'),
 @('construction_skill','//maps/li/things/thing[id="Human958"]/skills/skills/li[def="Construction"]')
)
$saves=@(foreach($name in @('reinstall-baseline.rws','New Arrivals1.rws','New Arrivals2.rws','New Arrivals3.rws','New Arrivals4.rws','New Arrivals5.rws')){
 $file=Join-Path $profile "Saves/$name";$doc=[xml](Get-Content -LiteralPath $file -Raw)
 $nodes=@(foreach($spec in $specs){
  $selected=$doc.SelectNodes($spec[1]);$n=$selected|Select-Object -First 1;$fields=@();$xml=$null
  if($n){if($spec[0] -eq 'worker'){$fields=@('def','id','name','pos','ownership','jobs','records');$xml=Project $n $fields}else{$xml=$n.OuterXml}}
  [ordered]@{role=$spec[0];xpath=$spec[1];count=$selected.Count;fields=$fields;xml=$xml}
 })
 [ordered]@{file=".local-research/runtime/profile-furniture-reinstall-20261104/Saves/$name";sha256=(Digest $file);ticks_game=[int]$doc.savegame.game.tickManager.ticksGame;nodes=$nodes}
})
if(($saves.ticks_game -join ',') -ne '80358,80359,80703,80703,80847,80847'){throw 'Unexpected tick sequence'}
Add-Type -AssemblyName System.Drawing
$imageSpecs=@(
 @('FRR01','018-bed-selected.png','before-owner-bed.png',0,1235,1160,170),
 @('FRR02','024-minified-selected.png','packed-bed.png',0,1235,720,170),
 @('FRR03','031-blueprint-selected.png','install-blueprint.png',0,1235,720,170),
 @('FRR04','039-install-walk.png','haul-to-blueprint.png',0,1208,720,197),
 @('FRR05','041-reinstalled-selected.png','reinstalled-owner-bed.png',0,1235,1160,170),
 @('FRR06','041-reinstalled-selected.png','reinstalled-map.png',925,530,470,220)
)
$images=@(foreach($s in $imageSpecs){
 $src=Join-Path $runtime $s[1];$dst=Join-Path $shots $s[2];$bitmap=[Drawing.Bitmap]::new($src);$dimensions=@($bitmap.Width,$bitmap.Height)
 $rect=[Drawing.Rectangle]::new([int]$s[3],[int]$s[4],[int]$s[5],[int]$s[6]);$crop=$bitmap.Clone($rect,$bitmap.PixelFormat)
 try{$crop.Save($dst,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose();$bitmap.Dispose()}
 [ordered]@{id=$s[0];source_file=".local-research/runtime/furniture-reinstall-20261104/$($s[1])";source_sha256=(Digest $src);source_dimensions=$dimensions;crop=@($s[3],$s[4],$s[5],$s[6]);file="furniture-reinstall-runtime/$($s[2])";sha256=(Digest $dst)}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter '*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 foreach($line in Get-Content -LiteralPath $_.FullName){if(!$line.Trim()){continue};$a=$line|ConvertFrom-Json;$img=[IO.Path]::GetFileName($a.image)
  [ordered]@{source_file=".local-research/runtime/furniture-reinstall-20261104/$($_.Name)";source_sha256=(Digest $_.FullName);started_utc=$a.started_utc;finished_utc=$a.finished_utc;action=$a.action;x=$a.x;y=$a.y;end_x=$a.end_x;end_y=$a.end_y;text=$a.text;virtual_key=$a.virtual_key;control=$a.control;duration_ms=$a.duration_ms;wheel_delta=$a.wheel_delta;wait_ms=$a.wait_ms;park_x=$a.park_x;park_y=$a.park_y;image_name=$img;image_sha256=(Digest (Join-Path $runtime $img))}
 }
})
$running=@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe' OR Name='RimWorldWin64.exe'");if($running.Count){throw 'Native still running'}
$modsPath=Join-Path $profile 'Config/ModsConfig.xml';$mods=[xml](Get-Content $modsPath -Raw)
$launch=Get-Content (Join-Path $runtime 'launch-record.json') -Raw|ConvertFrom-Json
$exit=Get-Content (Join-Path $runtime 'exit-record.json') -Raw|ConvertFrom-Json
$e=[ordered]@{
 evidence_id='RW17-NATIVE-FURNITURE-REINSTALL';date_local='2026-11-04';version='1.7.4980 rev60'
 kind='One ordinary uninstall and reinstall of the same previously ordinarily constructed Poor bed; six native saves; no result injection'
 launch=[ordered]@{pid=$launch.pid;started_utc=$launch.started_utc;executable=$launch.executable;profile='.local-research/runtime/profile-furniture-reinstall-20261104';record_file='.local-research/runtime/furniture-reinstall-20261104/launch-record.json';record_sha256=(Digest (Join-Path $runtime 'launch-record.json'));baseline_source='.local-research/runtime/profile-furniture-quality-20261104/Saves/New Arrivals4.rws';baseline_source_sha256=$launch.baseline_sha256;baseline_copy_sha256=$saves[0].sha256;prefs_sha256=$launch.prefs_sha256;mods_sha256=$launch.mods_sha256;active_mods=@($mods.ModsConfigData.activeMods.li)}
 preparation=[ordered]@{developer_mode_enabled=$true;developer_action_this_trial=$false;edited_saves=$false;method='Copied v33 ordinarily completed Poor-bed save into an isolated profile. Earlier scene contains developer-prepared structures; this trial only sets owner, uninstalls, places install blueprint and prioritizes ordinary jobs. No God-mode construction, spawning, quality or skill setting.';no_statistical_calibration=$true}
 targets=[ordered]@{worker='Human958';bed='Bed221087';wrapper='MinifiedThing292600';blueprint='Blueprint_Install_Bed292601';origin='(115, 0, 132)';destination='(113, 0, 134)';uninstalled_tick=80638;reinstalled_tick=80833}
 saves=$saves;images=$images;actions=$actions
 observations=@(
  [ordered]@{id='FRR-OBS01';finding='At80359 Bed221087 WoodLog Poor health91 is owned by Prophet Human958 at(115,0,132). Original baseline tick80358 advanced1 during loading/navigation.';evidence=@('saves','FRR01')},
  [ordered]@{id='FRR-OBS02';finding='At80703 MinifiedThing292600 has health100 and contains original Bed221087 with health91 and Poor. Inner assignedPawns is empty, uninstalledAssignedPawns stores Human958, and pawn ownedBed=null. Bed despawnedTick and wrapper spawnedTick both80638.';evidence=@('saves','FRR02')},
  [ordered]@{id='FRR-OBS03';finding='Still at80703 Blueprint_Install_Bed292601 at(113,0,134) has miniToInstall=Thing_MinifiedThing292600. Prophet playerForced HaulToContainer60136 targets A=wrapper,B=blueprint,count1. Native selected blueprint reports work left while carrying task is independently recorded.';evidence=@('saves','FRR03','FRR04')},
  [ordered]@{id='FRR-OBS04';finding='At80847 wrapper and blueprint are absent, original Bed221087 appears at destination with spawnedTick80833, same WoodLog/Poor/91HP. Human958 is reassigned, temporary owner cache empty. No duplicate bed is present. Construction XP169.049194 remains unchanged in every sample.';evidence=@('saves','FRR05','FRR06')},
  [ordered]@{id='FRR-OBS05';finding='Paused save repeat has same tick80847 and selected node state. Complete save SHA differs: realPlayTimeInteracting and nextMessageID change. Ordinary Quit to OS then fresh CIM observes no RimWorld process. Post-exit capture guard failed because the target window was gone; there is no047 image or completed action record.';evidence=@('saves','shutdown')}
 )
 shutdown=[ordered]@{record_file='.local-research/runtime/furniture-reinstall-20261104/exit-record.json';record_sha256=(Digest (Join-Path $runtime 'exit-record.json'));observed_utc=$exit.checkedAtUtc;method=$exit.quitRequestedVia;capture_result=$exit.postQuitCapture;rimworld_processes_after_exit=@($exit.remainingProcesses)}
 limitations=@('One undamaged ordinary colonist Poor-bed sample only; medical/prisoner/table flags, damaged wrapper, cancellation, blocking, competing reservations and long outdoor deterioration were not run.','No second reload after relocation: pause-repeat is established, not a relocation reload trial.','Intermediate carrying state was not saved: action039 is approach to source, action040 already shows installation complete.','No exact installation duration is estimated from wall-clock pulse lengths; pauses, travel and screenshot intervals differ from job work.','Actions004/005 occurred on loading screen; action010 closed an already-closed owner modal and deselected; action015 therefore did not designate uninstall; action017 had no prioritize menu. Successful uninstall designation starts019 and priority022.','Action047 input reached ordinary Quit to OS, but subsequent capture failed after window exit; the guard message refers to capture, not proof that the preceding quit click was omitted.','Raw record slot changes remain unnamed ordinals; static code names ThingsUninstalled/ThingsInstalled separately.','Full saves/screenshots remain local; selected projections, crops and SHA are public.')
}
[IO.File]::WriteAllText((Join-Path $out 'furniture-reinstall-runtime-evidence.json'),($e|ConvertTo-Json -Depth 22).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($actions.Count) actions; $($images.Count) crops; $($saves.Count) saves; native exited."
