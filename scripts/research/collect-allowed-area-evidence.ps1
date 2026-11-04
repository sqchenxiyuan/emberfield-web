param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Read-only static replay. Does not load target code or start the game.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/allowed-area-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
$manifest=Get-Content (Join-Path $root 'docs/research/rimworld/evidence/allowed-area-manifest.json') -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root 'docs/research/rimworld/evidence/production-bills-rea-managed.json') -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static evidence identity mismatch'}
$rules=@(
 @('RimWorld.ForbidUtility','TrueCount > 0','Empty assigned areas are unrestricted; nonempty areas filter cells.'),
 @('RimWorld.ForbidUtility','pawn.Drafted','Drafted, mental-state and other special agents bypass forbidden checks.'),
 @('RimWorld.Pawn_PlayerSettings','curJob.AnyTargetOutsideArea','Assigning an effective nonempty area interrupts a non-drafted job with any outside target.'),
 @('RimWorld.Pawn_PlayerSettings','Notify_AreaRemoved','Deleting an area clears matching pawn references.'),
 @('RimWorld.JobGiver_SeekAllowedArea','HasJobWithSpawnedAllowedTarget','Outside pawns keep jobs with a spawned allowed target; otherwise seek a reachable allowed cell.'),
 @('Verse.PathUtility','area.TrueCount <= 0','Path requests discard empty areas.'),
 @('Verse.PathGridJob','num += 600','Outside cells add path cost; they are not made impassable.'),
 @('RimWorld.WorkGiver_DoBill','Predicate<Thing> baseValidator','Production ingredients are filtered through IsForbidden for the worker.'),
 @('RimWorld.WorkGiver_ConstructDeliverResources','th.IsForbidden(pawn)','Construction resource selection respects forbidden things.'),
 @('RimWorld.StoreUtility','c.IsForbidden(carrier)','Storage destinations respect carrier area.'),
 @('RimWorld.FoodUtility','!allowForbidden && t.IsForbidden(getter)','Ordinary map food selection filters forbidden things; explicit exceptional modes exist.'),
 @('RimWorld.RestUtility','!sleeper.Downed && building_Bed.IsForbidden(sleeper)','Bed checks have downed and ignoreForbidden exceptions.'),
 @('RimWorld.FloatMenuOptionProvider_WorkGivers','CannotPrioritizeForbiddenOutsideAllowedArea','Ordinary prioritized work rejects outside targets.'),
 @('RimWorld.FloatMenuOptionProvider_Equip','TryTakeOrderedJob','Explicit equip issues an ordered job without an area rejection in this provider.'),
 @('Verse.AI.Pawn_JobTracker','pawn.Drafted || newJob.playerForced','Player-forced jobs set ignoreForbidden after the issuing provider has accepted the job.'),
 @('Verse.Area','Notify_AreaDelta','Painting dirties renderer, path map data and region area cache.'),
 @('Verse.AreaManager','Count() < 10','Vanilla mutable allowed-area limit is ten.'),
 @('Verse.DataExposeUtility','int numBytes = (elements + 7) / 8','Saved BoolGrid is packed low-bit-first and compressed by the byte-array serializer.')
)
$records=@(foreach($rule in $rules){
 $m=@($manifest.types|Where-Object type -eq $rule[0]);if($m.Count -ne 1){throw 'Missing type'}
 $file=Join-Path $root $m[0].local_file;if((Hash $file) -ne $m[0].sha256){throw 'Derived file hash changed'}
 $lines=[IO.File]::ReadAllLines($file);$hits=@(for($i=0;$i -lt $lines.Length;$i++){if($lines[$i].Contains($rule[1])){[ordered]@{line=$i+1;text=$lines[$i].Trim()}}})
 if(!$hits.Count){throw "Rule anchor not found: $($rule[0]) / $($rule[1])"}
 [ordered]@{type=$rule[0];file=$m[0].local_file;sha256=$m[0].sha256;anchor=$rule[1];hits=$hits;interpretation=$rule[2]}
})
$xmlRelative='Data/Core/Defs/ThinkTreeDefs/Humanlike.xml';$xmlFile=Join-Path $GameRoot $xmlRelative
$tree=[Xml.XmlDocument]::new();$tree.XmlResolver=$null;$tree.Load($xmlFile)
$colonist=$tree.SelectSingleNode('//li[@Class="ThinkNode_ConditionalColonist"][subNodes/li[@Class="JobGiver_SeekAllowedArea"]]')
if(!$colonist){throw 'Expected colonist branch missing'}
$order=@($colonist.SelectNodes('subNodes/li')|ForEach-Object {$_.GetAttribute('Class')})
if($order[0] -ne 'JobGiver_SeekAllowedArea'){throw 'Ordinary branch order changed'}
$record=[ordered]@{evidence_id='RW17-ALLOWED-AREA-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash;reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json';reaSha256=Hash (Join-Path $root 'docs/research/rimworld/evidence/production-bills-rea-managed.json');manifestFile='docs/research/rimworld/evidence/allowed-area-manifest.json';manifestSha256=Hash (Join-Path $root 'docs/research/rimworld/evidence/allowed-area-manifest.json');rules=$records;ordinaryColonistBranch=[ordered]@{file=$xmlRelative;sha256=Hash $xmlFile;directChildOrder=$order};limits=@('ILSpy-derived C# is not original source or execution evidence.','REA identity and metadata reused only for the exact matching assembly.','The ordinary colonist branch follows earlier special-state branches; this is not an absolute priority over all needs.','Specific food, bed, drafted, mental-state and special-faction exceptions are not exhaustively runtime tested.','No movement-time numerical calibration.');collectorSha256=Hash $PSCommandPath}
$json=($record|ConvertTo-Json -Depth 16).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static retained projection differs'};'Checked allowed-area static rules and think-tree order'}else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));'Collected allowed-area static rules'}
