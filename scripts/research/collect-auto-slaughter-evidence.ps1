param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static PE-derived text and packaged XML only; no native, browser, preview or GUI launch.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/auto-slaughter-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/auto-slaughter-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$sources=@{}
foreach($m in $manifest.types){$file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)}
$rules=@(
 @('Verse.AutoSlaughterConfig','public int maxTotal = -1','Total, male/female reproductive and male/female young quotas default to unlimited (-1).'),
 @('Verse.AutoSlaughterConfig','Scribe_Values.Look(ref allowSlaughterPregnant, "allowSlaughterPregnant", defaultValue: false)','Pregnancy permission defaults false and is saved.'),
 @('Verse.AutoSlaughterConfig','Scribe_Values.Look(ref allowSlaughterBonded, "allowSlaughterBonded", defaultValue: false)','Bond permission defaults false and is saved.'),
 @('Verse.AutoSlaughterConfig','maxTotal == -1 && maxMales == -1 && maxFemales == -1 && maxMalesYoung == -1 && maxFemalesYoung == -1 && allowSlaughterPregnant','AnyLimit is not a plain five-quota test: protection toggles keep processing enabled. Unlimited quotas still select no animals.'),
 @('Verse.AutoSlaughterManager','foreach (Pawn spawnedColonyAnimal in map.mapPawns.SpawnedColonyAnimals)','Candidate universe is spawned player-faction animals on this map.'),
 @('Verse.MapPawns','List<Pawn> list = SpawnedPawnsInFaction(Faction.OfPlayer)','SpawnedColonyAnimals starts from spawned player-faction pawns and filters IsAnimal.'),
 @('Verse.AutoSlaughterManager','spawnedColonyAnimal.def != config.animal || !CanAutoSlaughterNow(spawnedColonyAnimal)','Each species filters transient auto-slaughter eligibility before quota counting.'),
 @('Verse.AutoSlaughterManager','!config.allowSlaughterBonded && spawnedColonyAnimal.relations.GetDirectRelationsCount(PawnRelationDefOf.Bond) > 0','Protected bonded animals are excluded from candidates and quota counts, irrespective of whether the bonded pawn is alive.'),
 @('Verse.AutoSlaughterManager','spawnedColonyAnimal.ageTracker.CurLifeStage.reproductive','Reproductive life-stage membership determines adult versus young, rather than body size or a universal age.'),
 @('Verse.AutoSlaughterManager','!spawnedColonyAnimal.health.hediffSet.HasHediff(HediffDefOf.Pregnant)','Any ordinary pregnancy is protected by default; this execution branch does not require Visible.'),
 @('Verse.AutoSlaughterManager','else if (config.allowSlaughterPregnant)','Allowed pregnant reproductive females enter a separate temporary pool; protected ones enter neither female nor total pool.'),
 @('Verse.AutoSlaughterManager','tmpAnimals.SortByDescending((Pawn a) => a.ageTracker.AgeBiologicalTicks)','Ordinary total candidates are ordered oldest first by biological ticks.'),
 @('Verse.AutoSlaughterManager','tmpAnimalsFemaleYoung.SortByDescending((Pawn a) => a.ageTracker.AgeBiologicalTicks)','Each of the four sex/age pools is independently ordered oldest first.'),
 @('Verse.AutoSlaughterManager','tmpAnimalsPregnant.SortByDescending((Pawn a) => a.health.hediffSet.GetFirstHediffOfDef(HediffDefOf.Pregnant).Severity)','Pregnancy pool uses descending severity, not biological age or most-recent-conception order.'),
 @('Verse.Hediff_Pregnant','return Severity','GestationProgress reads pregnancy severity; the higher-severity pregnancy is further progressed.'),
 @('Verse.AutoSlaughterManager','tmpAnimalsFemale.AddRange(tmpAnimalsPregnant)','Allowed pregnant animals are appended after ordinary adult females.'),
 @('Verse.AutoSlaughterManager','tmpAnimals.AddRange(tmpAnimalsPregnant)','Allowed pregnant animals are appended after all ordinary total candidates.'),
 @('Verse.AutoSlaughterManager','while (tmpAnimalsFemale.Count > config.maxFemales)','Adult female limit is enforced first.'),
 @('Verse.AutoSlaughterManager','while (tmpAnimalsFemaleYoung.Count > config.maxFemalesYoung)','Young female limit is enforced second.'),
 @('Verse.AutoSlaughterManager','while (tmpAnimalsMale.Count > config.maxMales)','Adult male limit is enforced third.'),
 @('Verse.AutoSlaughterManager','while (tmpAnimalsMaleYoung.Count > config.maxMalesYoung)','Young male limit is enforced fourth.'),
 @('Verse.AutoSlaughterManager','while (tmpAnimals.Count > config.maxTotal)','Total limit is enforced last, after removing candidates already selected by category limits.'),
 @('Verse.AutoSlaughterManager','tmpAnimals.Remove(item)','The category-selected candidate is removed from the total pool, preventing duplicate selection or over-reduction by total quota.'),
 @('Verse.GenCollection','list.Sort((T a, T b) => selector(b).CompareTo(selector(a)))','The one-key descending helper specifies no stable ID tiebreaker.'),
 @('Verse.GenCollection','T result = list[0]','PopFront selects the first entry and removes index zero.'),
 @('Verse.AutoSlaughterManager','if (animal.HomeFaction == Faction.OfPlayer)','Auto-slaughter requires player HomeFaction, distinct from current faction.'),
 @('Verse.AutoSlaughterManager','return !animal.RaceProps.Dryad','Dryads are excluded from auto-slaughter eligibility.'),
 @('Verse.AutoSlaughterManager','if (animal.GetLord() != null)','Animals attached to any Lord are temporarily excluded.'),
 @('Verse.AutoSlaughterManager','animal.inventory != null && animal.inventory.UnloadEverything','Animals currently unloading inventory are temporarily excluded.'),
 @('Verse.AutoSlaughterManager','if (cacheDirty)','Selection is lazily recomputed only when this manager is dirty and AnimalsToSlaughter is read.'),
 @('Verse.AutoSlaughterManager','cacheDirty = false','A completed recomputation clears the dirty state.'),
 @('Verse.AutoSlaughterManager','cacheDirty = true','Exactly four methods in this type dirty the cache: spawn, despawn, faction and config notifications.'),
 @('Verse.Pawn','Map.autoSlaughterManager.Notify_PawnSpawned()','SpawnSetup notifies the manager, including post-load spawn setup.'),
 @('Verse.Pawn','map.autoSlaughterManager.Notify_PawnDespawned()','DeSpawn notifies the old map manager when the map exists.'),
 @('Verse.Pawn','Map.autoSlaughterManager.Notify_PawnChangedFaction()','SetFaction notifies when the pawn is spawned.'),
 @('Verse.AutoSlaughterManager','Scribe_Collections.Look(ref configs, "configs", LookMode.Deep)','Configuration is persisted; the derived selected-pawn list is not serialized here.'),
 @('Verse.AutoSlaughterManager','allDef.GetStatValueAbstract(StatDefOf.Wildness) < 1f','Configuration rows are populated for tameable animal definitions, excluding dryads and corpses.'),
 @('RimWorld.PawnUtility','!pawn.Spawned || !pawn.IsAnimal','ShouldBeSlaughtered requires a spawned animal before either designation route.'),
 @('RimWorld.PawnUtility','pawn.Map.designationManager.DesignationOn(pawn, DesignationDefOf.Slaughter) != null || pawn.Map.autoSlaughterManager.AnimalsToSlaughter.Contains(pawn)','A manual designation OR derived automatic selection enters the final release-designation gate; clearing one route need not clear the other.'),
 @('RimWorld.PawnUtility','return pawn.Map.designationManager.DesignationOn(pawn, DesignationDefOf.ReleaseAnimalToWild) == null','Release-to-wild vetoes both manual and automatic slaughter. Manager candidates still count/select that animal until a separate lifecycle invalidation.'),
 @('RimWorld.WorkGiver_Slaughter','SpawnedDesignationsOfDef(DesignationDefOf.Slaughter)','PotentialWorkThingsGlobal yields manual designated animals before the automatic list; this does not prove global execution priority.'),
 @('RimWorld.WorkGiver_Slaughter','foreach (Pawn item2 in pawn.Map.autoSlaughterManager.AnimalsToSlaughter)','The same work giver also yields automatic candidates.'),
 @('RimWorld.WorkGiver_Slaughter','if (pawn.Faction != t.Faction)','Work assignment requires same current faction.'),
 @('RimWorld.WorkGiver_Slaughter','if (pawn2.InAggroMentalState)','Aggressive mental states reject the slaughter job.'),
 @('RimWorld.WorkGiver_Slaughter','!pawn.CanReserve(t, 1, -1, null, forced)','Each animal needs a reservation; quotas do not bypass ordinary job allocation.'),
 @('RimWorld.WorkGiver_Slaughter','pawn.WorkTagIsDisabled(WorkTags.Violent)','A violence-incapable handler cannot take the ordinary job.'),
 @('RimWorld.WorkGiver_Slaughter','HistoryEventDefOf.SlaughteredVeneratedAnimal','Ideology and innocent/venerated-animal history checks can reject work independently of selection.'),
 @('RimWorld.JobDriver_Slaughter','this.FailOn(() => !job.ignoreDesignations && !Victim.ShouldBeSlaughtered())','Ordinary active jobs fail when neither manual nor cached-auto eligibility remains; ignoreDesignations explicitly bypasses that condition.'),
 @('RimWorld.JobDriver_Slaughter','this.FailOnAggroMentalState(TargetIndex.A)','The job also fails if its animal becomes aggressive.'),
 @('RimWorld.JobDriver_Slaughter','Toils_Goto.GotoThing(TargetIndex.A, PathEndMode.Touch)','Worker must reach touching distance.'),
 @('RimWorld.JobDriver_Slaughter','Toils_General.WaitWith(TargetIndex.A, 180, useProgressBar: true)','The native slaughter wait is 180 logical ticks; this is not a Web balance requirement.'),
 @('Verse.AI.Toils_General','PawnUtility.ForceWait(pawn, ticks, null, maintainPosture, maintainSleep)','WaitWith forces the target pawn to wait while the worker acts.'),
 @('Verse.AI.Toils_General','toil.FailOnCannotTouch(targetInd, pathEndMode)','WaitWith fails if contact is lost; it separately checks despawn/null.'),
 @('RimWorld.JobDriver_Slaughter','ExecutionUtility.DoExecutionByCut(pawn, Victim)','After work, ordinary execution handles death; automatic quota selection itself does not generate meat.'),
 @('Verse.AI.JobDriver','if (CheckCurrentToilEndOrFail())','Global fail conditions are checked during driver updates and before toil init.'),
 @('Verse.AI.JobDriver','JobCondition jobCondition = globalFailConditions[i]()','The active driver evaluates the fail callbacks rather than treating eligibility as a one-time assignment check.'),
 @('Verse.AI.JobDriver','JobCondition.Incompletable','A true AddFailCondition ends the job as incompletable, distinct from killing the animal.'),
 @('RimWorld.Dialog_AutoSlaughter','forcePause = true','The native quota dialog pauses the simulation.'),
 @('RimWorld.Dialog_AutoSlaughter','!AutoSlaughterManager.CanEverAutoSlaughter(spawnedColonyAnimal)','UI counts use permanent eligibility, while execution candidates also exclude Lord and unloading states.'),
 @('RimWorld.Dialog_AutoSlaughter','firstHediffOfDef != null && firstHediffOfDef.Visible','The UI pregnancy count/protection requires visible pregnancy; the automatic selection algorithm does not.'),
 @('RimWorld.Dialog_AutoSlaughter','val = current','Clicking an unlimited quota sets it to the displayed current count.'),
 @('RimWorld.Dialog_AutoSlaughter','val = Mathf.Max(0, val)','Numeric quotas are clamped to zero or greater in the dialog.'),
 @('RimWorld.Dialog_AutoSlaughter','map.autoSlaughterManager.Notify_ConfigChanged()','Changing a numeric quota dirties the automatic candidate cache.'),
 @('RimWorld.Dialog_AutoSlaughter','if (allowSlaughterPregnant != config.allowSlaughterPregnant)','Pregnancy checkbox change calls RecalculateAnimals (UI counts); the reviewed handler does not notify the candidate manager.'),
 @('RimWorld.Dialog_AutoSlaughter','if (allowSlaughterBonded != config.allowSlaughterBonded)','Bond checkbox change likewise recalculates UI counts.'),
 @('RimWorld.Designator_Slaughter','Map.designationManager.AddDesignation(new Designation(t, Designation))','Manual slaughter explicitly writes a designation; manager selection does not.'),
 @('RimWorld.Designator_Slaughter','Map.designationManager.RemoveDesignation(designation)','Manual slaughter removes an existing release-to-wild designation.'),
 @('RimWorld.SlaughterDesignatorUtility','PawnRelationDefOf.Bond, (Pawn x) => !x.Dead','Manual bond warning looks for a living bonded pawn, unlike the auto-protection count.'),
 @('RimWorld.PawnColumnWorker_Slaughter','SlaughterDesignatorUtility.CheckWarnAboutBondedAnimal(pawn)','Animal-table manual designation warns about bonds; it is not vetoed by auto-slaughter protection.')
)
$records=@(foreach($rule in $rules){
 $m=@($manifest.types|Where-Object type -eq $rule[0]);if($m.Count -ne 1){throw 'Missing rule type'}
 $lines=$sources[$rule[0]].Split("`n");$hits=@(for($i=0;$i -lt $lines.Length;$i++){if($lines[$i].Contains($rule[1])){[ordered]@{line=$i+1;text=$lines[$i].Trim()}}})
 if(!$hits.Count){throw "Missing anchor $($rule[0]): $($rule[1])"}
 [ordered]@{type=$rule[0];file=$m[0].local_file;sha256=$m[0].sha256;anchor=$rule[1];hits=$hits;interpretation=$rule[2]}
})
function BoundedAbsence([string]$type,[string]$start,[string]$end,[string[]]$tokens,[string]$meaning){
 $s=$sources[$type];$a=$s.IndexOf($start,[StringComparison]::Ordinal);if($a -lt 0){throw "Missing method start $start"}
 $b=if($end){$s.IndexOf($end,$a+$start.Length,[StringComparison]::Ordinal)}else{$s.Length};if($b -le $a){throw 'Missing method end'}
 $slice=$s.Substring($a,$b-$a);foreach($token in $tokens){if($slice.Contains($token)){throw "Unexpected $token in $type / $start"}}
 [ordered]@{type=$type;start=$start;end=$end;startLine=$s.Substring(0,$a).Split("`n").Count;endLine=$s.Substring(0,$b).Split("`n").Count;sliceSha256=TextHash $slice;absentTokens=$tokens;interpretation=$meaning}
}
$bounded=@(
 BoundedAbsence 'Verse.AutoSlaughterManager' 'public List<Pawn> AnimalsToSlaughter' 'public static bool CanEverAutoSlaughter' @('Designation','Visible','thingID','loadID','Rand.','HitPoints','CanReach','CanReserve') 'Candidate derivation neither creates/reads manual designations, requires visible pregnancy, reserves/reaches a victim nor has an explicit ID tie or random choice.'
 BoundedAbsence 'Verse.AutoSlaughterManager' 'public void ExposeData()' 'private void TryPopulateMissingAnimals()' @('animalsToSlaughterCached','cacheDirty','Notify_') 'Manager serialization stores configuration but neither cached candidates nor dirty state, and has no explicit reload invalidation in this method. Spawn callbacks provide observed invalidation.'
 BoundedAbsence 'Verse.AutoSlaughterManager' 'public sealed class AutoSlaughterManager' '' @('Tick(', 'TickInterval(', 'TicksGame', 'IsHashIntervalTick') 'The reviewed manager type has no periodic tick-based recount. This is not a whole-program absence proof.'
 BoundedAbsence 'Verse.Pawn_AgeTracker' 'public class Pawn_AgeTracker' '' @('autoSlaughter','AutoSlaughter') 'No direct auto-slaughter reference appears in the reviewed age tracker; indirect callbacks are not exhausted.'
 BoundedAbsence 'Verse.Hediff_Pregnant' 'public class Hediff_Pregnant' '' @('autoSlaughter','AutoSlaughter') 'No direct auto-slaughter reference appears in the reviewed pregnancy class; birth spawn follows ordinary pawn notification.'
 BoundedAbsence 'RimWorld.Pawn_RelationsTracker' 'public class Pawn_RelationsTracker' '' @('autoSlaughter','AutoSlaughter') 'No direct auto-slaughter reference appears in this relation tracker; indirect callbacks are not exhausted.'
 BoundedAbsence 'RimWorld.Dialog_AutoSlaughter' 'private void RecalculateAnimals()' 'public override void DoWindowContents' @('Notify_ConfigChanged','cacheDirty') 'RecalculateAnimals only refreshes dialog counts/order, not the candidate manager.'
 BoundedAbsence 'RimWorld.Dialog_AutoSlaughter' 'private void DoAnimalRow' '' @('Notify_ConfigChanged','cacheDirty') 'The reviewed checkbox handlers do not explicitly dirty the candidate manager. Immediate candidate refresh on checkbox-only changes is unproven.'
 BoundedAbsence 'RimWorld.JobDriver_Slaughter' 'protected override IEnumerable<Toil> MakeNewToils' '' @('Learn(','Skill','Notify_ConfigChanged','allowSlaughterPregnant','CanAutoSlaughterNow','AddFinishAction','RemoveDesignation') 'This driver does not independently recalculate pregnancy eligibility, learn an animal skill, or remove manual designation on mere work interruption.'
 BoundedAbsence 'RimWorld.Designator_Slaughter' 'public override AcceptanceReport CanDesignateThing' 'public override void DesignateThing' @('Pregnant','Bond','CanEverAutoSlaughter','CanAutoSlaughterNow') 'Ordinary manual designation eligibility does not inherit automatic pregnancy/bond protections.'
)
# Verify cross-anchor sequencing, rather than treating independently found lines as proof of order.
$manager=$sources['Verse.AutoSlaughterManager']
$quotaOrder=@('maxFemales','maxFemalesYoung','maxMales','maxMalesYoung','maxTotal')
$positions=@(foreach($q in $quotaOrder){$needle=if($q -eq 'maxTotal'){'while (tmpAnimals.Count > config.maxTotal)'}else{'while ('+(@{maxFemales='tmpAnimalsFemale';maxFemalesYoung='tmpAnimalsFemaleYoung';maxMales='tmpAnimalsMale';maxMalesYoung='tmpAnimalsMaleYoung'}[$q])+'.Count > config.'+$q+')'};$p=$manager.IndexOf($needle,[StringComparison]::Ordinal);if($p -lt 0){throw "Missing quota loop $q"};$p})
for($i=1;$i -lt $positions.Count;$i++){if($positions[$i] -le $positions[$i-1]){throw 'Quota loop order changed'}}
if(([regex]::Matches($manager,'cacheDirty = true;')).Count -ne 4){throw 'Dirty notification count changed'}
$specs=@(
 @('Data/Core/Defs/WorkGiverDefs/WorkGivers.xml','/Defs/WorkGiverDef[defName="Slaughter"]',@('giverClass','workType','priorityInType','requiredCapacities'),'Ordinary slaughter is Handling work and has capacity requirements.'),
 @('Data/Core/Defs/JobDefs/Jobs_Work.xml','/Defs/JobDef[defName="Slaughter"]',@('driverClass','allowOpportunisticPrefix'),'The ordinary Slaughter job uses the reviewed driver.'),
 @('Data/Core/Defs/HediffDefs/Hediffs_Global_Misc.xml','/Defs/HediffDef[defName="Pregnant"]',@('hediffClass','stages','comps'),'Ordinary animal pregnancy definition; projection does not resolve the final modded Def database.'),
 @('Data/Core/Languages/English/Keyed/Dialogs_Various.xml','/LanguageData',@('AutoSlaugtherTip','AutoSlaugtherHeaderTooltipCurrentMales','AutoSlaughterHeaderTooltipCurrentMalesYoung','AutoSlaughterHeaderTooltipAllowSlaughterPregnant','AutoSlaughterHeaderTooltipAllowSlaughterBonded'),'English tooltip says most recent pregnancy first; this conflicts with the reviewed descending severity code.')
)
$docs=@{}
$defs=@(foreach($spec in $specs){
 $file=Join-Path $GameRoot $spec[0]
 if(!$docs.ContainsKey($spec[0])){$doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null;$doc.Load($file);$docs[$spec[0]]=$doc}
 $nodes=@($docs[$spec[0]].SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected XML node count: $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));if($values.Count -ne 1){throw "Missing XML field $xpath"};[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash $file;xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
$record=[ordered]@{
 evidence_id='RW17-AUTO-SLAUGHTER-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile);rules=$records;boundedChecks=$bounded;packagedXml=$defs
 quotaOrder=$quotaOrder;unlimitedNativeValue=-1;slaughterWaitNativeTicks=180;dirtyNotificationCount=4
 limits=@('Static derived C# and packaged XML are not original source or runtime gameplay proof.','Matching retained REA metadata is reused for artifact identity only.','No native game, browser, preview, GUI input or screenshot was run.','Cache-invalidation absence checks are explicitly bounded to reviewed types/methods, not a complete assembly call graph.','Dialog checkbox-only changes, pregnancy/age/bond transitions and arbitrary Lord/inventory transitions were not runtime-tested for cache freshness.','The packaged English pregnancy-order tooltip conflicts with the reviewed descending-severity algorithm; retain both facts without inventing a runtime result.','Ordinary shared slaughter job is covered, not every mental-state execution path, DLC rule or mod override.','Tie ordering has no explicit native ID tiebreaker; do not claim exact replay of equal-age ordering.','Web immediate recomputation, stable ID ties, voxel reachability, null-as-unlimited, save validation and separate manual/automatic task labels are adaptations.','Bond protection requires an actual animal bond model; a Web toggle without that model would misrepresent functionality.','Native numeric constants are recorded evidence, while Web tuning remains provisional and separate from mechanism fidelity.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 18).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static projection differs'};"Checked auto-slaughter: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) packaged XML projections"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));'Collected auto-slaughter static mechanisms'}
