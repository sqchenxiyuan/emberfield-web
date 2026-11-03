# Read existing isolated screenshots, action logs and saves; never launch or control the target.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime'
$profile=Join-Path $runtime 'profile-weather-20261104'
$output=Join-Path $root 'docs/research/rimworld/evidence'
$shots=Join-Path $output 'weather-runtime'
New-Item -ItemType Directory -Path $shots -Force|Out-Null
function Digest([string]$path){(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()}
$launch=Get-Content (Join-Path $runtime 'weather-launch.json') -Raw|ConvertFrom-Json
$saveNames=@('weather-baseline.rws','New Arrivals1.rws','New Arrivals2.rws','New Arrivals3.rws','New Arrivals4.rws')
$saves=@(foreach($name in $saveNames){
 $file=Join-Path $profile "Saves/$name";$doc=[xml](Get-Content -LiteralPath $file -Raw)
 $manager=$doc.SelectSingleNode('//maps/li/weatherManager');$decider=$doc.SelectSingleNode('//maps/li/weatherDecider')
 $pawn=$doc.SelectSingleNode('//maps/li/things/thing[id="Human961"]')
 $wet=@($pawn.SelectNodes('.//memories//li[def="SoakingWet"]')|ForEach-Object { [ordered]@{def=$_.def;age=[int]$_.age;xml=$_.OuterXml}})
 [ordered]@{file=".local-research/runtime/profile-weather-20261104/Saves/$name";sha256=(Digest $file);ticks_game=[int]$doc.savegame.game.tickManager.ticksGame
  weather=[ordered]@{current=$manager.curWeather;previous=$manager.lastWeather;age=[int]$manager.curWeatherAge;xml=$manager.OuterXml;decider_duration=[int]$decider.curWeatherDuration;decider_xml=$decider.OuterXml}
  pawn=[ordered]@{id=$pawn.id;position=$pawn.pos;job_def=$pawn.jobs.curJob.def;wet_memories=$wet}}
})
if($saves[1].weather.current -ne 'Clear' -or $saves[2].weather.current -ne 'Rain' -or $saves[2].weather.age -ne 0 -or $saves[1].ticks_game -ne $saves[2].ticks_game){throw 'Preparation does not match observed transition'}
if($saves[3].weather.age -lt 4000 -or $saves[3].pawn.wet_memories.Count -ne 1){throw 'Final rain/memory observation missing'}
if($saves[3].ticks_game -ne $saves[4].ticks_game){throw 'Post-weather saves do not confirm stable tick'}
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('WER01','weather-012-weather-menu.png','developer-weather-menu.png',0,0,350,280),
 @('WER02','weather-013-rain-prepared.png','prepared-still-clear-label.png',2410,1160,150,145),
 @('WER03','weather-020-rain-run3.png','rain-outdoor-label.png',2410,1160,150,145),
 @('WER04','weather-021-rain-indoor.png','rain-indoor-label.png',2410,1160,150,145),
 @('WER05','weather-021-rain-indoor.png','constructed-roof-label.png',0,1330,450,75),
 @('WER06','weather-023-needs.png','soaking-wet-needs.png',220,690,310,285),
 @('WER07','weather-020-rain-run3.png','rain-scene.png',1400,580,650,380)
)
$images=@(foreach($spec in $specs){
 $src=Join-Path $runtime $spec[1];$dst=Join-Path $shots $spec[2]
 $bitmap=[Drawing.Bitmap]::new($src);$rect=[Drawing.Rectangle]::new([int]$spec[3],[int]$spec[4],[int]$spec[5],[int]$spec[6]);$crop=$bitmap.Clone($rect,$bitmap.PixelFormat)
 try{$crop.Save($dst,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose();$bitmap.Dispose()}
 [ordered]@{id=$spec[0];source_file=".local-research/runtime/$($spec[1])";source_sha256=(Digest $src);source_dimensions=@(2560,1440);crop=@($spec[3],$spec[4],$spec[5],$spec[6]);file="weather-runtime/$($spec[2])";sha256=(Digest $dst)}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter 'weather-*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 foreach($line in Get-Content -LiteralPath $_.FullName){
  if(!$line.Trim()){continue};$a=$line|ConvertFrom-Json
  [ordered]@{source_file=".local-research/runtime/$($_.Name)";source_sha256=(Digest $_.FullName);started_utc=$a.started_utc;finished_utc=$a.finished_utc;action=$a.action;x=$a.x;y=$a.y;text=$a.text;virtual_key=$a.virtual_key;duration_ms=$a.duration_ms;wait_ms=$a.wait_ms;park_x=$a.park_x;park_y=$a.park_y;image_name=[IO.Path]::GetFileName($a.image)}
 }
})
$running=@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe'"|Select-Object ProcessId,ExecutablePath)
if($running.Count){throw 'RimWorld still running; do not claim exited'}
$e=[ordered]@{
 evidence_id='RW17-NATIVE-WEATHER';date_local='2026-11-04';version='1.7.4980 rev60'
 kind='Native developer weather preparation, ordinary UI observation and original unedited saves; no injected game code'
 launch=[ordered]@{started_utc=$launch.started_utc;pid=$launch.pid;launch_record='.local-research/runtime/weather-launch.json';launch_record_sha256=(Digest (Join-Path $runtime 'weather-launch.json'));profile='.local-research/runtime/profile-weather-20261104';mods_config_sha256=$launch.mods_config_sha256;baseline_source_sha256=$launch.source_sha256;baseline_copy_sha256=$launch.copy_sha256;active_mods=@('ludeon.rimworld','ludeon.rimworld.odyssey')}
 preparation=[ordered]@{method='Developer Actions: Change weather..., select Rain';developer_action=$true;menu_click=@(100,925);weather_click=@(100,118);natural_weather_occurrence_measured=$false}
 target=[ordered]@{pawn_id='Human961';thought='SoakingWet';selected_weather='Rain';indoor_hover_client=@(1660,750);outdoor_hover_client=@(1450,700)}
 saves=$saves
 timing=[ordered]@{load_to_before_ticks=($saves[1].ticks_game-$saves[0].ticks_game);preparation_pair_equal_ticks=($saves[1].ticks_game -eq $saves[2].ticks_game);observed_weather_window_ticks=($saves[3].ticks_game-$saves[2].ticks_game);after_save_pair_equal_ticks=($saves[3].ticks_game -eq $saves[4].ticks_game);exact_onset_tick_measured=$false}
 observations=@(
  [ordered]@{id='WER01';finding='At the same game tick, developer transition changes current weather fromClear toRain, retains previousClear and resets age0. The immediate ordinary weather label still readsClear.';evidence=@('WER01','WER02','saves')},
  [ordered]@{id='WER02';finding='After three bounded speed3 runs, weather age4463 exceeds the4000tick transition duration; Rain label and rain overlay are visible.';evidence=@('WER03','WER07','saves')},
  [ordered]@{id='WER03';finding='Hovering outside shows Outdoors21C, while the constructed-roof room shows Indoors-8C and Dark0percent; both show the global Rain label. This is not a timed shelter movement experiment.';evidence=@('WER03','WER04','WER05')},
  [ordered]@{id='WER04';finding='Squint ordinary Needs panel shows Soaking wet -3; before and prepared saves contain no SoakingWet memory, both final same-tick saves contain one.';evidence=@('WER06','saves')}
 )
 images=$images;actions=$actions
 shutdown=[ordered]@{method='Ordinary Quit to OS at (2215,1315) after the second final save';attempted_capture='weather-030-quit.png';capture_result='Foreground guard rejected capture after native exit; no exit screenshot or successful action-log entry claimed';observed_utc=[DateTime]::UtcNow.ToString('o');rimworld_processes_after_exit=$running}
 limitations=@('Initial load advanced1800ticks before confirmed pause.','Developer Change weather bypasses natural selection and does not reroll WeatherDecider duration.','Three4second wall-clock pulses are input bounds, not calibrated simulation-rate or memory-onset measurements.','The scene also progresses from15h toward17h, so changing brightness cannot be attributed solely to rain.','Indoor cold existed before rain; no claim that rain cooled the room.','No native snow, movement-speed, shooting, solar-output, rain-fire, deterioration-rate or rain-short-circuit experiment.','Only selected save fields and small diagnostic crops are committed; full saves/screenshots remain local.')
}
[IO.File]::WriteAllText((Join-Path $output 'weather-runtime-evidence.json'),($e|ConvertTo-Json -Depth 16).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($actions.Count) actions; $($images.Count) crops; $($saves[2].ticks_game) -> $($saves[3].ticks_game); stable final saves; native exited."
