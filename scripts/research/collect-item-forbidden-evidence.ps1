param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Read-only static replay: never launches the target or sends GUI input.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/item-forbidden-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/item-forbidden-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$sources=@{}
foreach($m in $manifest.types){$file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)}
$rules=@(
 @('RimWorld.CompForbiddable','Scribe_Values.Look(ref forbiddenInt, "forbidden", defaultValue: false)','Per-thing saved flag; missing saved value defaults false.'),
 @('RimWorld.CompForbiddable','if (Props.forbidOnMake)','Def configuration can make newly-created things forbidden.'),
 @('RimWorld.CompForbiddable','Notify_Forbidden(parent)','Changing the flag updates haulable and mergeable lists.'),
 @('RimWorld.CompForbiddable','OverlayTypes.Forbidden','Forbidden state displays an overlay.'),
 @('RimWorld.CompForbiddable','piece.SetForbidden(forbiddenInt)','Split pieces inherit the source forbidden flag.'),
 @('RimWorld.ForbidUtility','if (faction != Faction.OfPlayer)','The faction flag query is player-faction-specific; it is not a universal NPC lock.'),
 @('RimWorld.ForbidUtility','t.IsForbidden(pawn.Faction) || t.IsForbidden(pawn.HostFaction)','Pawn-aware forbidden checks combine item flag with allowed-area and special-state rules.'),
 @('RimWorld.ForbidUtility','pawn.Drafted','Drafted, mental-state and other listed special contexts can bypass pawn-aware checks.'),
 @('RimWorld.ForbidUtility','pawn.HostFaction != null','Ordinary prisoners on a player-home map bypass pawn-aware forbiddance via the host-faction condition; not every guest context is identical.'),
 @('Verse.AI.HaulAIUtility','if (t.IsForbidden(p))','Ordinary hauling rejects forbidden items, including this forced-work scan.'),
 @('RimWorld.ListerHaulables','t.IsForbidden(Faction.OfPlayer)','Forbidden items are excluded from automatic haul candidate registration.'),
 @('RimWorld.ListerMergeables','t.IsForbidden(Faction.OfPlayer)','Forbidden items are excluded from automatic merge candidate registration.'),
 @('RimWorld.FoodUtility','!allowForbidden && t.IsForbidden(getter)','Ordinary map food selection excludes forbidden food unless explicit exceptional selection allows it.'),
 @('RimWorld.JobGiver_GetFood','allowForbidden: false','Ordinary hunger food searches pass allowForbidden false; player-owned animals obey item flags, wild animals normally have no player faction, and ordinary home prisoners bypass through CaresAboutForbidden.'),
 @('RimWorld.JobGiver_EatRandom','Predicate<Thing> validator','Animal curiosity food selection is a separate low-frequency path, with no explicit forbidden check in this selector; not a runtime proof of every downstream outcome.'),
 @('RimWorld.HealthAIUtility','!m.IsForbidden(healer)','Medicine selection checks forbidden status in addition to care policy and reservation.'),
 @('RimWorld.WorkGiver_ConstructDeliverResources','if (th.IsForbidden(pawn))','Construction material candidates exclude forbidden resources.'),
 @('RimWorld.WorkGiver_DoBill','Predicate<Thing> baseValidator','Production material candidates exclude forbidden resources.'),
 @('RimWorld.WorkGiver_DoBill','!bill_ProductionWithUft.BoundUft.IsForbidden(pawn)','Resuming bound unfinished products checks their forbidden state.'),
 @('RimWorld.FloatMenuOptionProvider_WorkGivers','target.Thing.IsForbidden(pawn)','Ordinary prioritized work rejects a forbidden target instead of silently clearing it.'),
 @('RimWorld.FloatMenuOptionProvider_Equip','clickedThing.SetForbidden(value: false)','Explicit Equip clears the item flag before issuing its ordered job.'),
 @('RimWorld.FloatMenuOptionProvider_Wear','apparel.SetForbidden(value: false)','Explicit Wear clears the item flag before issuing its ordered job.'),
 @('Verse.AI.Pawn_JobTracker','newJob.ignoreForbidden = true','Accepted player-forced or drafted jobs set ignoreForbidden; this does not undo earlier provider rejection.'),
 @('RimWorld.WorkGiver_ConstructDeliverResources','miniToInstallOrBuildingToReinstall.IsForbidden(pawn)','Installation work rejects a forbidden source item/building.'),
 @('RimWorld.Designator_Install','GenConstruct.PlaceBlueprintForReinstall','Reinstall designation places a blueprint; it is not an Equip/Wear-style flag-clearing action.'),
 @('Verse.ThingWithComps','comps[i].PreAbsorbStack(other, count)','Stack absorption invokes component hooks before the base count transfer.'),
 @('Verse.ThingWithComps','comps[i].AllowStackWith(other)','Stack compatibility checks all components; CompForbiddable itself does not override this hook.'),
 @('Verse.Thing','stackCount += num','Raw absorption retains the destination object and transfers source quantity; forbidden flag is not combined here.'),
 @('Verse.ThingUtility','return Mathf.Min(other.stackCount, thing.def.stackLimit - thing.stackCount)','The raw absorption count helper considers quantity/stack limit, not forbidden state.'),
 @('RimWorld.Pawn_TraderTracker','IEnumerable<Thing> enumerable = pawn.Map.listerThings.AllThings.Where','Caravan sale eligibility uses sellability, fog, home/storage and reachability; forbidden is not an exclusion.'),
 @('RimWorld.TradeUtility','t.def.category == ThingCategory.Item && PlayerSellableNow(t, trader)','Orbital sale eligibility inside powered beacon cells does not exclude the item forbidden flag.'),
 @('RimWorld.Pawn_TraderTracker','thing.PreTraded(TradeAction.PlayerBuys, playerNegotiator, this.pawn)','Ordinary caravan item purchase splits the source then calls trade hooks and placement; no generic forbidden clearing in this method.'),
 @('RimWorld.Pawn_TraderTracker','this.pawn.GetLord()?.extraForbiddenThings.Add(thing)','This is the trader Lord own exclusion set, not CompForbiddable.Forbidden for the player.'),
 @('Verse.GenPlace','thing2.TryAbsorbStack(thing, respectStackLimit: true)','A purchased item may merge into an existing receiving stack; the receiver flag then governs that stack.'),
 @('Verse.GenSpawn','newThing.SpawnSetup(map, respawningAfterLoad)','Ordinary placement spawns the same item; CompForbiddable.PostSpawnSetup only restores its overlay.'),
 @('Verse.RecipeWorkerCounter','bill.Map.resourceCounter.GetCount','The common until-count fast path counts stored resources plus eligible carried goods, including forbidden goods.'),
 @('RimWorld.ResourceCounter','foreach (Thing heldThing in allGroupsListForReading[i].HeldThings)','Resource counting has storage and freshness/fog conditions; usable-by-worker count is a separate question.')
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
 [ordered]@{type=$type;start=$start;end=$end;startLine=1+$s.Substring(0,$a).Split("`n").Count-1;endLine=$s.Substring(0,$b).Split("`n").Count;sliceSha256=TextHash $slice;absentTokens=$tokens;interpretation=$meaning}
}
$bounded=@(
 BoundedAbsence 'RimWorld.CompForbiddable' 'public class CompForbiddable' '' @('override bool AllowStackWith','override void PreAbsorbStack','override void PrePreTraded') 'This component has no custom compatibility/absorption/trade hook; its inherited hooks do not clear flags.'
 BoundedAbsence 'RimWorld.TradeUtility' 'public static bool PlayerSellableNow' 'public static void SpawnDropPod' @('IsForbidden','SetForbidden') 'This exact sale eligibility method does not exclude forbidden items.'
 BoundedAbsence 'RimWorld.Pawn_TraderTracker' 'public IEnumerable<Thing> ColonyThingsWillingToBuy' 'public void GiveSoldThingToTrader' @('IsForbidden','SetForbidden') 'This exact caravan candidate enumeration does not exclude forbidden items.'
 BoundedAbsence 'Verse.RecipeWorkerCounter' 'public bool CountValidThing(Thing thing' 'public virtual string ProductsDescription' @('IsForbidden','SetForbidden') 'The default counter validity filter includes forbidden products; other stock/filter conditions still apply.'
 BoundedAbsence 'RimWorld.ResourceCounter' 'private bool ShouldCount' '' @('IsForbidden','SetForbidden') 'Stored-resource validity checks freshness and fog, not the forbidden flag.'
 BoundedAbsence 'RimWorld.GenConstruct' 'public static Blueprint_Install PlaceBlueprintForInstall' 'public static bool CanBuildOnTerrain' @('SetForbidden') 'Install/reinstall blueprint creation does not clear the source flag in these methods.'
 BoundedAbsence 'Verse.ThingUtility' 'public static int TryAbsorbStackNumToTake' 'public static int RoundedResourceStackCount' @('IsForbidden','SetForbidden') 'The raw stack transfer count does not depend on forbidden state.'
 BoundedAbsence 'RimWorld.JobGiver_EatRandom' 'public class JobGiver_EatRandom' '' @('IsForbidden','SetForbidden') 'Curiosity food selector differs from ordinary hunger selection; downstream behavior and all special states are not claimed tested.'
 BoundedAbsence 'RimWorld.Pawn_TraderTracker' 'public void GiveSoldThingToPlayer' 'private void AddPawnToStock' @('SetForbidden') 'Ordinary caravan purchase does not explicitly reset the item flag.'
 BoundedAbsence 'Verse.GenPlace' 'public static class GenPlace' '' @('SetForbidden') 'Ordinary placement/merging does not explicitly reset item flags in this class.'
 BoundedAbsence 'Verse.GenSpawn' 'public static Thing Spawn(Thing newThing, IntVec3 loc, Map map, Rot4 rot' 'public static void SpawnBuildingAsPossible' @('newThing.SetForbidden') 'The ordinary spawn method does not reset the incoming item flag; refund/move-aside helpers are separate paths.'
)
$defSpecs=@(
 @('Data/Core/Defs/ThinkTreeDefs/Animal.xml','/Defs/ThinkTreeDef[defName="Animal"]//li[treeDef="SatisfyBasicNeeds"]','Animal ordinary behavior delegates hunger/rest to SatisfyBasicNeeds.'),
 @('Data/Core/Defs/ThinkTreeDefs/Animal.xml','/Defs/ThinkTreeDef[defName="Animal"]//li[@Class="JobGiver_EatRandom"]','Animal behavior also has a distinct curiosity-eating selector.'),
 @('Data/Core/Defs/ThinkTreeDefs/SubTrees_Misc.xml','/Defs/ThinkTreeDef[defName="SatisfyBasicNeeds"]//li[@Class="JobGiver_GetFood"]','Shared ordinary needs use JobGiver_GetFood.'),
 @('Data/Core/Defs/ThinkTreeDefs/Humanlike.xml','/Defs/ThinkTreeDef[defName="Humanlike"]//li[@Class="ThinkNode_ConditionalPrisoner"]//li[@Class="JobGiver_GetFood"]','Prisoner ordinary needs also use JobGiver_GetFood; the difference comes from ForbidUtility context.')
)
$defs=@(foreach($spec in $defSpecs){$file=Join-Path $GameRoot $spec[0];$doc=[Xml.XmlDocument]::new();$doc.XmlResolver=$null;$doc.Load($file);$nodes=@($doc.SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected Def node count: $($spec[1])"};[ordered]@{file=$spec[0];sha256=Hash $file;xpath=$spec[1];xml=$nodes[0].OuterXml;interpretation=$spec[2]}})
$record=[ordered]@{evidence_id='RW17-ITEM-FORBIDDEN-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash;reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile);manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile);rules=$records;boundedChecks=$bounded;packagedThinkTreeDefs=$defs;limits=@('Derived C# is not original source or runtime proof.','Matching retained REA metadata is reused for artifact identity only.','No v45 forbidden gameplay scenario was run; user paused further program interaction during initial launch/load preparation.','No blanket immediate job-cancellation claim: the component setter updates lists/overlays; individual jobs and forced-job exceptions need their own review.','Raw stack absorption retains the receiver flag, but all other stack compatibility components and caller-specific behavior still apply.','Default product counting and ordinary caravan/orbital sale eligibility are covered; ordinary caravan item buyback does not clear flags. Other purchase providers, every specialized recipe and mods are not exhaustively audited.','Food statements concern ordinary hunger selection; curiosity, mental states, faction changes, feeding by another pawn and every downstream ingestion path are not a complete runtime matrix.');collectorSha256=Hash $PSCommandPath}
$json=($record|ConvertTo-Json -Depth 18).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static projection differs'};'Checked item-forbidden static rules and bounded exclusions'}else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));'Collected item-forbidden static rules'}
