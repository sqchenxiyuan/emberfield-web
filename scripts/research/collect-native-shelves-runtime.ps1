param([string]$PlanPath = '')
# Read-only source collection. No launch, input, game assembly execution, or save edits.
# Public output requires an explicitly completed plan and independent process-exit evidence.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtimeRelative = '.local-research/runtime/shelves-20261104'
$profileRelative = '.local-research/runtime/profile-shelves-20261104'
$runtime = Join-Path $root $runtimeRelative
$profile = Join-Path $root $profileRelative
$evidence = Join-Path $root 'docs/research/rimworld/evidence'
$shots = Join-Path $evidence 'shelves-runtime'
if (!$PlanPath) { $PlanPath = Join-Path $runtime 'collection-plan.json' }
function Digest([string]$file) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
function TextDigest([string]$value) { [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($value))).ToLowerInvariant() }
function ReadXml([string]$file) {
    $doc = [Xml.XmlDocument]::new(); $doc.XmlResolver = $null
    $settings = [Xml.XmlReaderSettings]::new(); $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $reader = [Xml.XmlReader]::Create($file, $settings)
    try { $doc.Load($reader) } finally { $reader.Dispose() }
    return ,$doc
}
function Within([string]$directory, [string]$relative) {
    $full = [IO.Path]::GetFullPath((Join-Path $directory $relative))
    $prefix = [IO.Path]::GetFullPath($directory).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
    if (!$full.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw "Path leaves expected directory: $relative" }
    $full
}
function Field($node,[string]$xpath) { $n = $node.SelectSingleNode($xpath); if ($n) { $n.InnerText } else { $null } }
function NodeXml($node,[string]$xpath) { $n = $node.SelectSingleNode($xpath); if ($n) { $n.OuterXml } else { $null } }
function WriteJson([string]$file,$value) { [IO.File]::WriteAllText($file,($value|ConvertTo-Json -Depth 50).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false)) }
function Projection($doc,[string]$role,[string]$xpath,[string[]]$fields=@()) {
    $nodes = @(foreach ($node in $doc.SelectNodes($xpath)) {
        if ($fields.Count) {
            $copy = $node.CloneNode($false)
            foreach ($child in $node.ChildNodes) { if ($child.LocalName -in $fields) { [void]$copy.AppendChild($child.CloneNode($true)) } }
            $copy.OuterXml
        } else { $node.OuterXml }
    })
    [ordered]@{ role=$role; xpath=$xpath; count=$nodes.Count; fields=@($fields); nodes=$nodes; node_sha256=@($nodes|ForEach-Object { TextDigest $_ }) }
}
function WalkPhysical($node,[string]$path,[string]$owner,[string]$location,$entries) {
    if ($node.SelectSingleNode('def') -and $node.SelectSingleNode('id')) {
        [void]$entries.Add([pscustomobject]@{ node=$node; path=$path; root_id=$owner; location=$location })
    }
    $indices = @{}
    foreach ($child in $node.ChildNodes) {
        if ($child.NodeType -ne [Xml.XmlNodeType]::Element) { continue }
        $name=$child.LocalName; $indices[$name]=1+[int]$indices[$name]
        if ($path -eq '.' -and $name -notin @('carryTracker','inventory','innerContainer','resourceContainer')) { continue }
        $nextLocation=if($path -eq '.'){$name}else{$location}
        WalkPhysical $child "$path/$name[$($indices[$name])]" $owner $nextLocation $entries
    }
}
function Summarize($nodes,[string[]]$trackedDefs,[string[]]$colonistIds,[object[]]$watchedCells) {
    $entries=[Collections.Generic.List[object]]::new()
    foreach($node in $nodes) { WalkPhysical $node '.' (Field $node 'id') 'ground' $entries }
    $batches=@(foreach($entry in $entries) {
        $n=$entry.node; $def=Field $n 'def'
        if($def -notin $trackedDefs){continue}
        $raw=Field $n 'stackCount'; $amount=if($null -eq $raw){1}else{[int]$raw}
        [ordered]@{ id=(Field $n 'id'); def=$def; amount=$amount; stack_count_serialized=$raw; root_id=$entry.root_id; path=$entry.path; location=$entry.location; pos=(Field $n 'pos'); map=(Field $n 'map'); health=(Field $n 'health'); forbidden=(Field $n 'forbidden'); rot_progress=(Field $n 'rotProg') }
    })
    $totals=[ordered]@{}
    foreach($def in $trackedDefs){$sum=0;foreach($batch in $batches){if($batch.def -eq $def){$sum+=$batch.amount}};$totals[$def]=$sum}
    $shelves=@(foreach($entry in $entries){
        $n=$entry.node; $def=Field $n 'def'
        if($def -notin @('Shelf','ShelfSmall')){continue}
        $settings=NodeXml $n 'settings'
        [ordered]@{ id=(Field $n 'id'); def=$def; root_id=$entry.root_id; path=$entry.path; location=$entry.location; pos=(Field $n 'pos'); map=(Field $n 'map'); rot=(Field $n 'rot'); stuff=(Field $n 'stuff'); health=(Field $n 'health'); spawned_tick=(Field $n 'spawnedTick'); despawned_tick=(Field $n 'despawnedTick'); quality=(Field $n 'quality'); storage_group=(Field $n 'storageGroup'); settings_xml=$settings; settings_sha256=if($settings){TextDigest $settings}else{$null} }
    })
    $plans=@(foreach($n in $nodes){
        $def=Field $n 'def'
        if($def -notlike 'Blueprint_*' -and $def -notlike 'Frame_*'){continue}
        [ordered]@{ id=(Field $n 'id'); def=$def; class=$n.GetAttribute('Class'); pos=(Field $n 'pos'); stuff_to_use=(Field $n 'stuffToUse'); work_done=(Field $n 'workDone'); thing_to_install=(Field $n 'thingToInstall'); settings_xml=(NodeXml $n 'settings') }
    })
    $workers=@(foreach($id in $colonistIds){
        $n=@($nodes|Where-Object { (Field $_ 'id') -eq $id })
        if($n.Count -ne 1){throw "Expected one colonist projection: $id"};$n=$n[0]
        $driver=$n.SelectSingleNode('jobs/curDriver')
        [ordered]@{ id=$id; nick=(Field $n 'name/nick'); pos=(Field $n 'pos'); job=(Field $n 'jobs/curJob/def'); job_load_id=(Field $n 'jobs/curJob/loadID'); job_target_a=(Field $n 'jobs/curJob/targetA'); job_target_b=(Field $n 'jobs/curJob/targetB'); job_count=(Field $n 'jobs/curJob/count'); driver_class=if($driver){$driver.GetAttribute('Class')}else{$null}; carried_ids=@($entries|Where-Object {$_.root_id -eq $id -and $_.location -eq 'carryTracker'}|ForEach-Object {Field $_.node 'id'}) }
    })
    $cells=@(foreach($cell in $watchedCells){
        $pos="($($cell[0]), $($cell[1]), $($cell[2]))"
        [ordered]@{ pos=@($cell); occupants=@(foreach($n in $nodes){if((Field $n 'pos') -eq $pos){[ordered]@{id=(Field $n 'id');def=(Field $n 'def')}}}); tracked_stacks=@($batches|Where-Object {$_.location -eq 'ground' -and $_.pos -eq $pos}|ForEach-Object {$_.id}) }
    })
    [ordered]@{batches=$batches;totals=$totals;shelves=$shelves;plans=$plans;workers=$workers;cells=$cells}
}

$plan=Get-Content -LiteralPath $PlanPath -Raw|ConvertFrom-Json -DateKind String
if($plan.completed -ne $true){throw 'Collection plan is not marked completed; final collection deferred.'}
$exitPath=Join-Path $runtime 'exit-record.json'
if(!(Test-Path -LiteralPath $exitPath)){throw 'Exit record missing; final collection deferred.'}
$running=@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe' OR Name='RimWorldWin64.exe'")
if($running.Count){throw 'RimWorld is still running; no final evidence will be written.'}
$launchPath=Join-Path $runtime 'launch-record.json'
$launch=Get-Content -LiteralPath $launchPath -Raw|ConvertFrom-Json -DateKind String
$exitRecord=Get-Content -LiteralPath $exitPath -Raw|ConvertFrom-Json -DateKind String
if(@($exitRecord.remainingRimWorldProcesses).Count -or $exitRecord.targetProcessAbsent -ne $true -or [int]$exitRecord.processId -ne [int]$launch.pid -or $exitRecord.terminationUsed -ne $false){throw 'Ordinary exit record does not establish this process exited.'}
if(!$plan.save_stages.Count -or @($plan.save_stages.id|Select-Object -Unique).Count -ne $plan.save_stages.Count){throw 'Missing or duplicate saved stages.'}
if(!$plan.tracked_defs.Count -or @($plan.tracked_defs|Where-Object {$_ -notmatch '^[A-Za-z0-9_]+$'}).Count){throw 'Invalid tracked Def names.'}
if(!$plan.watched_cells.Count){throw 'No watched cells selected.'}
$mapXPath='/savegame/game/maps/li[uniqueID="0"]'
$physicalFields=@('def','id','map','pos','rot','health','stackCount','tickDelta','spawnedTick','despawnedTick','stuff','stuffToUse','forbidden','quality','rotProg','settings','storageGroup','innerContainer','resourceContainer','thingToInstall','workDone','name','jobs','pather','carryTracker','inventory')
$predicates=@($plan.tracked_defs|ForEach-Object {"def='$_'"})
$resourcePredicate=$predicates -join ' or '
$selectors=@($resourcePredicate,"def='Shelf'","def='ShelfSmall'","starts-with(def,'Blueprint_')","starts-with(def,'Frame_')",".//*[($resourcePredicate) or def='Shelf' or def='ShelfSmall']")
$selectors+=@($plan.colonist_ids|ForEach-Object {if($_ -notmatch '^Human\d+$'){throw 'Invalid colonist id'};"id='$_'"})
foreach($cell in $plan.watched_cells){if($cell.Count -ne 3 -or @($cell|Where-Object {$_ -isnot [long] -and $_ -isnot [int]}).Count){throw 'Invalid watched cell'};$selectors+="pos='($($cell[0]), $($cell[1]), $($cell[2]))'"}
$rootsXPath="$mapXPath/things/thing[$($selectors -join ' or ')]"
$saves=@(foreach($stage in $plan.save_stages){
    $file=Within (Join-Path $profile 'Saves') $stage.file;$beforeHash=Digest $file;$doc=ReadXml $file
    if($doc.SelectNodes('/savegame/game/maps/li').Count -ne 1 -or (Field $doc "$mapXPath/mapInfo/size") -ne '(250, 1, 250)'){throw 'Expected one 250x250 map0.'}
    $projections=@((Projection $doc 'meta' '/savegame/meta'),(Projection $doc 'tick' '/savegame/game/tickManager/ticksGame'),(Projection $doc 'map_size' "$mapXPath/mapInfo/size"),(Projection $doc 'physical_roots' $rootsXPath $physicalFields),(Projection $doc 'designations' "$mapXPath/designationManager/allDesignations"),(Projection $doc 'storage_groups' "$mapXPath/storageGroups"))
    $projected=@(foreach($raw in $projections[3].nodes){$n=[xml]$raw;$n.DocumentElement})
    $summary=Summarize $projected @($plan.tracked_defs) @($plan.colonist_ids) @($plan.watched_cells)
    if((Digest $file) -ne $beforeHash){throw "Save changed during collection: $file"}
    [ordered]@{id=$stage.id;role=$stage.role;description=$stage.description;expect=$stage.expect;reload_of=$stage.reload_of;file="$profileRelative/Saves/$($stage.file)";sha256=$beforeHash;bytes=(Get-Item -LiteralPath $file).Length;tick=[int](Field $doc '/savegame/game/tickManager/ticksGame');projections=$projections;summary=$summary}
})
New-Item -ItemType Directory -Path $shots -Force|Out-Null
Add-Type -AssemblyName System.Drawing
$images=@(foreach($spec in $plan.images){
    $src=Within $runtime $spec.source;$dst=Within $shots $spec.file;$bitmap=[Drawing.Bitmap]::new($src)
    try{
        $dimensions=@($bitmap.Width,$bitmap.Height);$r=@($spec.crop)
        if($r.Count -ne 4 -or $r[0] -lt 0 -or $r[1] -lt 0 -or $r[2] -le 0 -or $r[3] -le 0 -or $r[0]+$r[2] -gt $bitmap.Width -or $r[1]+$r[3] -gt $bitmap.Height){throw 'Invalid screenshot crop.'}
        $crop=$bitmap.Clone([Drawing.Rectangle]::new([int]$r[0],[int]$r[1],[int]$r[2],[int]$r[3]),$bitmap.PixelFormat)
        try{$crop.Save($dst,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose()}
    }finally{$bitmap.Dispose()}
    [ordered]@{id=$spec.id;caption=$spec.caption;source_file="$runtimeRelative/$($spec.source)";source_sha256=(Digest $src);source_dimensions=$dimensions;crop=$r;file="shelves-runtime/$($spec.file)";sha256=(Digest $dst)}
})
$actions=@(foreach($file in Get-ChildItem -LiteralPath $runtime -Filter '*.png.actions.jsonl'|Sort-Object Name){foreach($line in Get-Content -LiteralPath $file.FullName){
    if(!$line.Trim()){continue};$a=$line|ConvertFrom-Json -DateKind String;$image=[IO.Path]::GetFileName([string]$a.image)
    $action=[ordered]@{source_file="$runtimeRelative/$($file.Name)";source_sha256=(Digest $file.FullName);image_name=$image;image_sha256=(Digest (Within $runtime $image))}
    foreach($key in @('started_utc','finished_utc','pid','action','x','y','end_x','end_y','text','virtual_key','control','duration_ms','wheel_delta','wait_ms','park_x','park_y','run_start_utc','target_click_start_utc','pause_start_utc')){$action[$key]=$a.$key};$action
}})
$mods=ReadXml (Join-Path $profile 'Config/ModsConfig.xml')
$result=[ordered]@{
    evidence_id='RW17-NATIVE-SHELVES';schema_version=1;kind='native-runtime-observed';version='1.7.4980 rev60';date_local='2026-11-04'
    scope='Selected ordinary native shelf trial. Exact XML projections preserve separate map stacks, carrier containers, installed buildings and packed inner buildings. Checks validate recorded evidence, not a replay.'
    preparation=[ordered]@{edited_saves=$false;developer_action_this_trial=$false;code_injection=$false;baseline_contains_earlier_developer_preparation=$true;method=$plan.preparation}
    launch=[ordered]@{pid=$launch.pid;started_utc=$launch.started_utc;executable=$launch.executable;profile=$profileRelative;record_file="$runtimeRelative/launch-record.json";record_sha256=(Digest $launchPath);baseline_source=[IO.Path]::GetRelativePath($root,$launch.baseline_source).Replace('\','/');baseline_source_sha256=$launch.baseline_sha256;baseline_copy_sha256=$saves[0].sha256;prefs_sha256=$launch.prefs_sha256;mods_sha256=$launch.mods_sha256;assembly_sha256=$launch.assembly_sha256;active_mods=@($mods.ModsConfigData.activeMods.li)}
    tools=[ordered]@{collector_file='scripts/research/collect-native-shelves-runtime.ps1';collector_sha256=(Digest $PSCommandPath);verifier_file='scripts/research/verify-native-shelves-runtime.mjs';verifier_sha256=(Digest (Join-Path $PSScriptRoot 'verify-native-shelves-runtime.mjs'));input_helper_file='scripts/research/shelves-runtime-input.ps1';input_helper_sha256=(Digest (Join-Path $PSScriptRoot 'shelves-runtime-input.ps1'));note='Retained helper and collector/verifier use LF; no game assembly is executed by evidence tools.'}
    targets=[ordered]@{map_id=0;map_size=@(250,1,250);tracked_defs=@($plan.tracked_defs);colonist_ids=@($plan.colonist_ids);watched_cells=@($plan.watched_cells);initial_shelf_cell=@($plan.initial_shelf_cell);target_shelf_id=$plan.target_shelf_id}
    saves=$saves;comparisons=@($plan.comparisons);images=$images;actions=$actions;observations=@($plan.observations);limitations=@($plan.limitations)
    shutdown=[ordered]@{record_file="$runtimeRelative/exit-record.json";record_sha256=(Digest $exitPath);record=$exitRecord;rimworld_processes_after_exit=@($running)}
}
WriteJson (Join-Path $evidence 'native-shelves-runtime.json') $result
Write-Output "$($saves.Count) saves, $($images.Count) crops, $($actions.Count) actions. Final evidence collected after verified exit."
