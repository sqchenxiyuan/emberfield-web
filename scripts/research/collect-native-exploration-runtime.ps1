param([string]$PlanPath = '')
# Read-only source collection. Does not launch the game, inject code, or edit saves.
# Final collection requires an explicitly completed local plan and an exited game.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtimeRelative = '.local-research/runtime/exploration-20261104'
$profileRelative = '.local-research/runtime/profile-exploration-20261104'
$runtime = Join-Path $root $runtimeRelative
$profile = Join-Path $root $profileRelative
$evidence = Join-Path $root 'docs/research/rimworld/evidence'
$shots = Join-Path $evidence 'exploration-runtime'
if (!$PlanPath) { $PlanPath = Join-Path $runtime 'collection-plan.json' }
function Digest([string]$file) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
function ByteDigest([byte[]]$bytes) { [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant() }
function TextDigest([string]$value) { ByteDigest ([Text.Encoding]::UTF8.GetBytes($value)) }
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
    if (!$full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Path leaves expected directory: $relative" }
    $full
}
function Projection($doc, [string]$role, [string]$xpath, [string[]]$fields = @()) {
    $selected = $doc.SelectNodes($xpath)
    $nodes = @(foreach ($node in $selected) {
        if ($fields.Count) {
            $copy = $node.CloneNode($false)
            foreach ($child in $node.ChildNodes) { if ($child.LocalName -in $fields) { [void]$copy.AppendChild($child.CloneNode($true)) } }
            $copy.OuterXml
        } else { $node.OuterXml }
    })
    [ordered]@{ role=$role; xpath=$xpath; count=$selected.Count; fields=@($fields); nodes=$nodes; node_sha256=@($nodes | ForEach-Object { TextDigest $_ }) }
}
function DecodeBlob($doc, [string]$role, [string]$parentXPath, [string]$label, [int]$expectedLength) {
    $xpath = "$parentXPath/${label}Deflate"; $node = $doc.SelectSingleNode($xpath); $compression = 'raw-deflate'
    if (!$node) { $xpath = "$parentXPath/$label"; $node = $doc.SelectSingleNode($xpath); $compression = 'none' }
    if (!$node) { throw "Missing serialized blob $label" }
    $encoded = [Convert]::FromBase64String(($node.InnerText -replace '\s',''))
    if ($compression -eq 'raw-deflate') {
        $inputStream = [IO.MemoryStream]::new($encoded, $false)
        $inflater = [IO.Compression.DeflateStream]::new($inputStream, [IO.Compression.CompressionMode]::Decompress)
        $outputStream = [IO.MemoryStream]::new()
        try { $inflater.CopyTo($outputStream); $decoded = $outputStream.ToArray() }
        finally { $inflater.Dispose(); $outputStream.Dispose(); $inputStream.Dispose() }
    } else { $decoded = $encoded }
    if ($decoded.Length -ne $expectedLength) { throw "Unexpected decoded length for ${role}: $($decoded.Length)" }
    [pscustomobject]@{ data=$decoded; record=[ordered]@{ role=$role; xpath=$xpath; node_xml=$node.OuterXml; node_sha256=(TextDigest $node.OuterXml); compression=$compression; encoded_bytes=$encoded.Length; encoded_sha256=(ByteDigest $encoded); decoded_bytes=$decoded.Length; decoded_sha256=(ByteDigest $decoded) } }
}
function IsFogged([byte[]]$bytes, [int]$index) { ($bytes[[int][Math]::Floor($index / 8)] -band (1 -shl ($index % 8))) -ne 0 }
function UshortAt([byte[]]$bytes, [int]$index) { [int]$bytes[2*$index] -bor ([int]$bytes[2*$index+1] -shl 8) }
function Field($node, [string]$xpath) { $selected = $node.SelectSingleNode($xpath); if ($selected) { $selected.InnerText } else { $null } }
function WriteJson([string]$file, $value) { [IO.File]::WriteAllText($file, ($value | ConvertTo-Json -Depth 40).Replace("`r`n","`n")+"`n", [Text.UTF8Encoding]::new($false)) }

$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json -DateKind String
if ($plan.completed -ne $true) { throw 'Collection plan is not marked completed; final collection deferred.' }
$exitPath = Join-Path $runtime 'exit-record.json'
if (!(Test-Path -LiteralPath $exitPath)) { throw 'Exit record missing; final collection deferred.' }
$running = @(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe' OR Name='RimWorldWin64.exe'")
if ($running.Count) { throw 'RimWorld is still running; no final evidence will be written.' }
$launchPath = Join-Path $runtime 'launch-record.json'
$launch = Get-Content -LiteralPath $launchPath -Raw | ConvertFrom-Json -DateKind String
$exitRecord = Get-Content -LiteralPath $exitPath -Raw | ConvertFrom-Json -DateKind String
if (@($exitRecord.remainingRimWorldProcesses).Count -or $exitRecord.targetProcessAbsent -ne $true) { throw 'Exit record does not establish process exit.' }
if ([int]$exitRecord.processId -ne [int]$launch.pid) { throw 'Launch/exit PID mismatch.' }
if ($exitRecord.terminationUsed -ne $false) { throw 'Expected ordinary native exit, not termination.' }
if (!$plan.save_stages.Count) { throw 'No saved stages selected.' }
$stageIds = @($plan.save_stages.id)
if (($stageIds | Select-Object -Unique).Count -ne $stageIds.Count) { throw 'Duplicate stage id.' }

$mapXPath = '/savegame/game/maps/li[uniqueID="0"]'
$colonistIds = @('Human958','Human961','Human965')
$route = @(196..200 | ForEach-Object { [ordered]@{ x=89; y=0; z=$_; index=(89+250*$_) } })
$previousFog = $null; $baselineFog = $null
$saves = @(foreach ($stage in $plan.save_stages) {
    $file = Within (Join-Path $profile 'Saves') $stage.file
    $beforeHash = Digest $file; $doc = ReadXml $file
    $map = $doc.SelectSingleNode($mapXPath)
    if (!$map -or $doc.SelectNodes('/savegame/game/maps/li').Count -ne 1) { throw 'Expected exactly one map with uniqueID 0.' }
    if ((Field $map 'mapInfo/size') -ne '(250, 1, 250)') { throw 'Unexpected map dimensions.' }
    $tick = [int](Field $doc '/savegame/game/tickManager/ticksGame')
    $fog = DecodeBlob $doc 'fog' "$mapXPath/fogGrid" 'fogGrid' 7813
    $things = DecodeBlob $doc 'compressed_things' $mapXPath 'compressedThingMap' 125000
    if (!$baselineFog) { $baselineFog = $fog.data.Clone() }
    $newlyKnown = [Collections.Generic.List[int]]::new(); $newlyFogged = [Collections.Generic.List[int]]::new()
    $knownSinceBaseline = [Collections.Generic.List[int]]::new(); $fogCount = 0
    for ($i=0; $i -lt 62500; $i++) {
        $isFog = IsFogged $fog.data $i
        if ($isFog) { $fogCount++ }
        if (!$isFog -and (IsFogged $baselineFog $i)) { $knownSinceBaseline.Add($i) }
        if ($previousFog) {
            $wasFog = IsFogged $previousFog $i
            if ($wasFog -and !$isFog) { $newlyKnown.Add($i) }
            if (!$wasFog -and $isFog) { $newlyFogged.Add($i) }
        }
    }
    $projections = @(
        (Projection $doc 'meta' '/savegame/meta'),
        (Projection $doc 'tick' '/savegame/game/tickManager/ticksGame'),
        (Projection $doc 'map_size' "$mapXPath/mapInfo/size"),
        (Projection $doc 'mine_designations' "$mapXPath/designationManager/allDesignations/li[def='Mine']"),
        (Projection $doc 'letter_stack' '/savegame/game/letterStack'),
        (Projection $doc 'letters' '/savegame/game/history/archive/archivables/li[contains(@Class,"Letter")]')
    )
    $mineNodes = $doc.SelectNodes("$mapXPath/designationManager/allDesignations/li[def='Mine']")
    $designations = @(foreach ($d in $mineNodes) { [ordered]@{ def=(Field $d 'def'); target=(Field $d 'target') } })
    $cells = @(foreach ($cell in $route) {
        $pos = "($($cell.x), 0, $($cell.z))"
        $xpath = "$mapXPath/things/thing[pos='$pos']"
        $p = Projection $doc "route_$($cell.z)" $xpath @('def','id','map','pos','health','spawnedTick','despawnedTick','stackCount','beenRevealed')
        $projections += $p
        $explicit = @($doc.SelectNodes($xpath))
        $explicitRocks = @($explicit | Where-Object { $_.GetAttribute('Class') -eq 'Mineable' -or (Field $_ 'def') -eq 'Granite' })
        $hash = UshortAt $things.data $cell.index
        if ($hash -eq 14420 -and $explicitRocks.Count) { throw "Duplicate rock representation at $pos" }
        $rock = if ($hash -eq 14420) { [ordered]@{ storage='compressed'; def='Granite'; id=$null; health=$null } }
        elseif ($explicitRocks.Count -eq 1) { [ordered]@{ storage='explicit'; def=(Field $explicitRocks[0] 'def'); id=(Field $explicitRocks[0] 'id'); health=(Field $explicitRocks[0] 'health') } }
        elseif ($explicitRocks.Count -gt 1) { throw "Multiple route rocks at $pos" }
        else { $null }
        $ids = @($explicit | ForEach-Object { Field $_ 'id' })
        $marked = @($designations | Where-Object { $_.target -eq $pos -or ($_.target -like 'Thing_*' -and $_.target.Substring(6) -in $ids) }).Count -gt 0
        [ordered]@{ pos=@($cell.x,0,$cell.z); index=$cell.index; fogged=(IsFogged $fog.data $cell.index); compressed_short_hash=$hash; explicit_thing_ids=$ids; rock=$rock; mine_designated=$marked; projection_role="route_$($cell.z)" }
    })
    $workers = @(foreach ($colonistId in $colonistIds) {
        $workerXPath = "$mapXPath/things/thing[id='$colonistId']"
        $projections += (Projection $doc "worker_$colonistId" $workerXPath @('def','id','name','pos','jobs','pather'))
        $worker = $doc.SelectSingleNode($workerXPath)
        if (!$worker) { throw "Colonist $colonistId missing from map." }
        $driver = $worker.SelectSingleNode('jobs/curDriver')
        [ordered]@{ id=(Field $worker 'id'); nick=(Field $worker 'name/nick'); pos=(Field $worker 'pos'); job=(Field $worker 'jobs/curJob/def'); job_load_id=(Field $worker 'jobs/curJob/loadID'); job_target_a=(Field $worker 'jobs/curJob/targetA'); player_forced=(Field $worker 'jobs/curJob/playerForced'); driver_class=if($driver -and $driver.HasAttribute('Class')){$driver.GetAttribute('Class')}else{$null} }
    })
    $letters = @(foreach ($l in $doc.SelectNodes('/savegame/game/history/archive/archivables/li[contains(@Class,"Letter")]')) { [ordered]@{ class=$l.GetAttribute('Class'); def=(Field $l 'def'); label=(Field $l 'label'); arrival_tick=(Field $l 'arrivalTick'); text=(Field $l 'text'); targets=@($l.SelectNodes('lookTargets/targets/li') | ForEach-Object { $_.InnerText }) } })
    if ((Digest $file) -ne $beforeHash) { throw "Save changed while being collected: $file" }
    $previousFog = $fog.data.Clone()
    [ordered]@{ id=$stage.id; role=$stage.role; description=$stage.description; reload_of=$stage.reload_of; file="$profileRelative/Saves/$($stage.file)"; sha256=$beforeHash; bytes=(Get-Item -LiteralPath $file).Length; tick=$tick; map_id=0; size=@(250,1,250); blobs=@($fog.record,$things.record); projections=$projections; fog=[ordered]@{ count=$fogCount; known_count=(62500-$fogCount); newly_known_indices=@($newlyKnown); newly_fogged_indices=@($newlyFogged); known_since_baseline_indices=@($knownSinceBaseline) }; route=$cells; mine_designations=$designations; workers=$workers; letters=$letters }
})

New-Item -ItemType Directory -Path $shots -Force | Out-Null
Add-Type -AssemblyName System.Drawing
$images = @(foreach ($spec in $plan.images) {
    $src = Within $runtime $spec.source; $dst = Within $shots $spec.file
    $bitmap = [Drawing.Bitmap]::new($src)
    try {
        $dimensions = @($bitmap.Width,$bitmap.Height); $r = @($spec.crop)
        if ($r.Count -ne 4 -or $r[0] -lt 0 -or $r[1] -lt 0 -or $r[2] -le 0 -or $r[3] -le 0 -or $r[0]+$r[2] -gt $bitmap.Width -or $r[1]+$r[3] -gt $bitmap.Height) { throw 'Invalid screenshot crop.' }
        $rect = [Drawing.Rectangle]::new([int]$r[0],[int]$r[1],[int]$r[2],[int]$r[3])
        $crop = $bitmap.Clone($rect,$bitmap.PixelFormat)
        try { $crop.Save($dst,[Drawing.Imaging.ImageFormat]::Png) } finally { $crop.Dispose() }
    } finally { $bitmap.Dispose() }
    [ordered]@{ id=$spec.id; caption=$spec.caption; source_file="$runtimeRelative/$($spec.source)"; source_sha256=(Digest $src); source_dimensions=$dimensions; crop=$r; file="exploration-runtime/$($spec.file)"; sha256=(Digest $dst) }
})
$actions = @(foreach ($file in Get-ChildItem -LiteralPath $runtime -Filter '*.png.actions.jsonl' | Sort-Object Name) {
    foreach ($line in Get-Content -LiteralPath $file.FullName) {
        if (!$line.Trim()) { continue }
        $a = $line | ConvertFrom-Json -DateKind String; $image = [IO.Path]::GetFileName([string]$a.image)
        $action = [ordered]@{ source_file="$runtimeRelative/$($file.Name)"; source_sha256=(Digest $file.FullName); image_name=$image; image_sha256=(Digest (Within $runtime $image)) }
        foreach ($key in @('started_utc','finished_utc','pid','action','x','y','end_x','end_y','text','virtual_key','control','duration_ms','wheel_delta','wait_ms','park_x','park_y','run_start_utc','target_click_start_utc','pause_start_utc')) { $action[$key] = $a.$key }
        $action
    }
})
$provenancePath = Join-Path $root '.local-research/exploration-runtime-probe/provenance.json'
$provenance = Get-Content -LiteralPath $provenancePath -Raw | ConvertFrom-Json -DateKind String
$sourcePointers = @(foreach ($p in $provenance.sourcePointers) {
    if ((Digest $p.file) -ne $p.sha256) { throw "Decoder source hash changed: $($p.file)" }
    [ordered]@{ file=[IO.Path]::GetRelativePath($root,$p.file).Replace('\','/'); sha256=$p.sha256; lines=$p.lines; ranges=$p.ranges; claim=$p.claim }
})
$manifest = [ordered]@{ kind='static-derived-decoder-provenance'; source_sha256=$provenance.target.sha256; engine_sha256=$provenance.decompiler.sha256; engine_version=$provenance.decompiler.version; source_pointers=$sourcePointers; collector_sha256=(Digest $PSCommandPath); verifier_sha256=(Digest (Join-Path $PSScriptRoot 'verify-native-exploration-runtime.mjs')); input_helper_file='scripts/research/exploration-runtime-input.ps1'; input_helper_sha256=(Digest (Join-Path $PSScriptRoot 'exploration-runtime-input.ps1')); note='Derived C# and full saves remain local. Public evidence retains serialized XML nodes and their hashes; native UI confirms entry Granite. No game assembly is executed by these tools. The retained input helper uses LF line endings; the native run used the same input behavior before newline normalization.' }
WriteJson (Join-Path $shots 'decode-manifest.json') $manifest
$modsPath = Join-Path $profile 'Config/ModsConfig.xml'; $mods = ReadXml $modsPath
$result = [ordered]@{
    evidence_id='RW17-NATIVE-EXPLORATION'; schema_version=1; kind='native-runtime-observed'; version='1.7.4980 rev60'; date_local='2026-11-04'
    scope='One ordinary mining/reveal trial selected by disclosed offline save inspection; portable checks validate retained evidence, not a replay.'
    preparation=[ordered]@{ edited_saves=$false; developer_action_this_trial=$false; offline_scene_selection=$true; method=$plan.preparation; baseline_contains_earlier_developer_preparation=$true }
    launch=[ordered]@{ pid=$launch.pid; started_utc=$launch.started_utc; executable=$launch.executable; profile=$profileRelative; record_file="$runtimeRelative/launch-record.json"; record_sha256=(Digest $launchPath); baseline_source=[IO.Path]::GetRelativePath($root,$launch.baseline_source).Replace('\','/'); baseline_source_sha256=$launch.baseline_sha256; baseline_copy_sha256=$saves[0].sha256; prefs_sha256=$launch.prefs_sha256; mods_sha256=$launch.mods_sha256; assembly_sha256=$launch.assembly_sha256; active_mods=@($mods.ModsConfigData.activeMods.li) }
    decoder=[ordered]@{ manifest_file='exploration-runtime/decode-manifest.json'; manifest_sha256=(Digest (Join-Path $shots 'decode-manifest.json')); cell_index='x + z * 250'; fog='raw Deflate when Deflate label is present; base64; LSB-first bits'; compressed_things='raw Deflate when Deflate label is present; base64; little-endian uint16 shortHash per cell'; route_granite_short_hash=14420; route_granite_identity='Static short hash plus native entry selection screenshot: Granite 900/900. Compression holds pristine rocks, damaged/referenced rocks may instead appear in things XML.' }
    targets=[ordered]@{ map_id=0; initial_miner='Human965'; initial_miner_nick='Grump'; colonist_ids=$colonistIds; mine_route=@($route | ForEach-Object { ,@($_.x,0,$_.z) }); original_unknown_air=@(89,0,200); approach=@(89,0,195); scene='Outdoor clearing; not a roofed cave.' }
    saves=$saves; images=$images; actions=$actions; observations=@($plan.observations); limitations=@($plan.limitations)
    shutdown=[ordered]@{ record_file="$runtimeRelative/exit-record.json"; record_sha256=(Digest $exitPath); record=$exitRecord; rimworld_processes_after_exit=@($running) }
}
WriteJson (Join-Path $evidence 'native-exploration-runtime.json') $result
Write-Output "$($saves.Count) saves, $($images.Count) crops, $($actions.Count) actions. Final evidence collected after verified exit."
