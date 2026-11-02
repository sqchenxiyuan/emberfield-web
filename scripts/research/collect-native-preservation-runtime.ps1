# Rebuild committed summaries/crops from existing local captures and original-game saves.
# This script never sends input, launches the game, changes saves, or runs target code.
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $project '.local-research/runtime'
$evidence=Join-Path $project 'docs/research/rimworld/evidence'
$utf8=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
$samples=@(& (Join-Path $PSScriptRoot 'read-native-preservation-saves.ps1')|ConvertFrom-Json)
$specs=@(
 @('warm-0','preservation-065-close-save-menu.png',22,'Cooler selected; temperature only',0,1100,2560,340),
 @('warm-1','preservation-068-warm-meal.png',23,'Fresh (Unrefrigerated, spoils in 3.8 days)',0,1100,2560,340),
 @('chilled-0','preservation-081-chill-paused.png',6,'Fresh (Refrigerated, spoils in 6.1 days)',0,1100,2560,340),
 @('frozen-0','preservation-089-freeze-paused.png','-0','Fresh (Frozen)',0,1100,2560,340),
 @('frozen-1','preservation-091-frozen-paused.png',-4,'Fresh (Frozen)',0,1100,2560,340),
 @('cooler-dev','preservation-084-target-minus15.png',6,'Not connected to power; target -15C; Current power use: High',0,1100,2560,340),
 @('chamber','preservation-084-target-minus15.png',$null,'Roofed developer chamber; cooler north wall',1220,660,400,360)
)
$shots=@()
foreach($row in $specs){
 $source=Join-Path $runtime $row[1];$relative="runtime/preservation-$($row[0]).png";$destination=Join-Path $evidence $relative
 $bitmap=[Drawing.Bitmap]::new($source)
 try{$rect=[Drawing.Rectangle]::new($row[4],$row[5],$row[6],$row[7]);$crop=$bitmap.Clone($rect,$bitmap.PixelFormat);try{$crop.Save($destination,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose()}}
 finally{$bitmap.Dispose()}
 $capture=Get-Content -LiteralPath ($source+'.jsonl')|Select-Object -Last 1|ConvertFrom-Json
 $shots += [ordered]@{id=$row[0];image=$relative;sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant();source_file=".local-research/runtime/$($row[1])";source_sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();source_size=@(2560,1440);crop_xywh=@($row[4],$row[5],$row[6],$row[7]);observed_utc=$capture.timestamp_utc;ui_temperature_c=$row[2];ui_text=$row[3]}
}
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter 'preservation-*.png.actions.jsonl'|ForEach-Object{Get-Content -LiteralPath $_.FullName|ForEach-Object{$_|ConvertFrom-Json}}|Sort-Object started_utc)
$actionFile=Join-Path $evidence 'native-preservation-actions.jsonl'
[IO.File]::WriteAllText($actionFile,(($actions|ForEach-Object{ConvertTo-Json $_ -Depth 8 -Compress}) -join "`n")+"`n",$utf8)
$intervals=@()
for($i=1;$i -lt $samples.Count;$i++){
 $a=$samples[$i-1];$b=$samples[$i];$delta=$b.tick-$a.tick;$rot=$b.meals[0].rot_progress-$a.meals[0].rot_progress
 $intervals += [ordered]@{from=$a.id;to=$b.id;delta_ticks=$delta;indoor_delta_rot=$rot;indoor_average_progress_per_tick=$rot/$delta;outdoor_delta_rot=if($a.meals[1].present -and $b.meals[1].present){$b.meals[1].rot_progress-$a.meals[1].rot_progress}else{$null};constant_temperature_demonstrated=$false}
}
$record=[ordered]@{
 schema_version=1;evidence_id='RW17-NATIVE-PRESERVATION-RUNTIME';version_text='1.7.4980 rev60';assembly_sha256='eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'
 process_id=29920;profile='.local-research/runtime/profile-20261102';active_mods=@('ludeon.rimworld','ludeon.rimworld.odyssey')
 method='Foreground-targeted original UI; developer room/spawn/God build/DEV power; bounded ordinary time advancement; read-only original-game save parsing; no injection or save editing'
 developer_actions_performed=$true;normal_power_network_demonstrated=$false;constant_freezing_interval_demonstrated=$false;pure_core_runtime=$false
 initial_backup=@{file='.local-research/runtime/preservation-before-20261102-175453.rws';sha256='855a173e4b12e1a1f485a302e2bd00337388b58b53a20d31bb2e91e22cac1b11'}
 setup=@{room='Developer Make empty room (rect), wooden roofed chamber';food='Developer-spawned MealSimple stacks of 1, forbidden using UI';cooler='God-mode original Cooler in north wall; cold port south, hot port north';power='DEV: Toggle power on; no connected power network';targets_c=@(21,5,-15);excluded_setup_ticks=@(10459,21141);excluded_setup_reason='Menu navigation failed once; unintended shortcuts advanced simulation during setup. Formal sampling starts at warm-0.'}
 samples=$samples;intervals=$intervals;screenshots=$shots
 actions=@{file='native-preservation-actions.jsonl';sha256=(Get-FileHash -LiteralPath $actionFile -Algorithm SHA256).Hash.ToLowerInvariant();count=$actions.Count}
 temperature_decode=@{compression='Base64 raw DEFLATE';byte_order='unsigned 16-bit little-endian';cell_index='z * map_size_x + x';decode_c='(ushort - 32768) / 16';quantization_c=0.0625;is_continuous_trace=$false;new_type_manifest='preservation-runtime-manifest.json';existing_temperature_type='energy:Verse.TemperatureVacuumSaveLoad';source_refs=@(@{group='preservation-runtime';type='Verse.CellIndicesUtility';start=8;end=23},@{group='preservation-runtime';type='Verse.MapSerializeUtility';start=21;end=32},@{group='preservation-runtime';type='Verse.DataSerializeUtility';start=41;end=77},@{group='preservation-runtime';type='Verse.DataExposeUtility';start=11;end=46},@{group='preservation-runtime';type='Verse.CompressUtility';start=10;end=64},@{group='energy';type='Verse.TemperatureVacuumSaveLoad';start=21;end=133})}
 limitations=@('Core + Odyssey, not pure Core.','Developer setup and DEV power do not establish normal construction or electricity supply.','Screenshots/save endpoints are sparse; neither constant refrigeration nor continuously subzero temperature was measured.','The frozen endpoint interval gained 197.7813 rot progress; frozen zero-growth is not independently demonstrated.','Door traffic, room heat exchange, and UI rounding are possible explanations, not measured causes.','Outdoor MealSimple42001 is absent from chilled-0 onward; disappearance cause was not observed, so subsequent control comparisons are invalid.','Health deterioration and rot progress are separate. Warm control health changes do not measure rot.','Existing age from setup was retained; no claim of fresh-spawn zero age at warm-0.','The original saves and uncropped screenshots stay in ignored local research storage; portable verification checks recorded summaries, crop hashes and arithmetic, not the authenticity of an unavailable native run.')
 final_state=@{paused=$true;developer_mode=$true;god_mode=$true;cooler_target_c=-15;profile_only=$true;last_save='preservation-frozen-1.rws';normal_profile_touched=$false}
}
[IO.File]::WriteAllText((Join-Path $evidence 'native-preservation-runtime.json'),(ConvertTo-Json $record -Depth 18)+"`n",$utf8)
Write-Output "Collected $($samples.Count) samples, $($intervals.Count) intervals, $($shots.Count) crops, $($actions.Count) UI action records."
