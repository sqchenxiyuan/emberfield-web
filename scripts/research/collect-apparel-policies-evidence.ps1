param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static packaged evidence only. Never load target code or launch the game/browser/GUI.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/apparel-policies-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/apparel-policies-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$sources=@{}
foreach($m in $manifest.types){$file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)}
$rules=@(
 @('RimWorld.Policy','public int id;','Policies have identity independently of their editable label.'),
 @('RimWorld.Policy','Scribe_Values.Look(ref label, "label");','Policy labels persist.'),
 @('RimWorld.ApparelPolicy','public ThingFilter filter = new ThingFilter();','Apparel policy is a shared item filter, not an equipment recipe.'),
 @('RimWorld.ApparelPolicy','filter.CopyAllowancesFrom(apparelPolicy.filter);','Copying policy copies allowances.'),
 @('RimWorld.ApparelPolicy','Scribe_Deep.Look(ref filter, "filter");','Filter state persists inside the policy.'),
 @('RimWorld.OutfitDatabase','return outfits[0];','Default is the first database entry; it is not a special immutable policy.'),
 @('RimWorld.OutfitDatabase','outfits[0] = policy;','Setting default reorders the database.'),
 @('RimWorld.OutfitDatabase','PawnsFinder.AllMapsCaravansAndTravellingTransporters_Alive','Deletion checks live map, caravan and travelling transporter assignments.'),
 @('RimWorld.OutfitDatabase','return new AcceptanceReport("OutfitInUse".Translate(item));','An assigned policy cannot be deleted while in active use.'),
 @('RimWorld.OutfitDatabase','item2.outfits.CurrentApparelPolicy = null;','Other world/temporary references are reset before successful deletion.'),
 @('RimWorld.OutfitDatabase','outfits.Max((ApparelPolicy o) => o.id) + 1','New IDs use current maximum plus one, not a globally monotonic counter.'),
 @('RimWorld.OutfitDatabase','apparelPolicy.filter.SetAllow(ThingCategoryDefOf.Apparel, allow: true);','New policy initially allows apparel.'),
 @('RimWorld.OutfitDatabase','MakeNewOutfit().label = "OutfitAnything".Translate();','Anything is first/default in the starting set.'),
 @('RimWorld.OutfitDatabase','allDef.apparel.defaultOutfitTags.Contains("Worker")','Worker presets follow apparel tags plus utility apparel.'),
 @('RimWorld.OutfitDatabase','allDef2.apparel.defaultOutfitTags.Contains("Soldier")','Soldier presets follow apparel tags plus utility apparel.'),
 @('RimWorld.OutfitDatabase','!allDef3.apparel.bodyPartGroups.Contains(BodyPartGroupDefOf.Legs)','Nudist preset is not an empty filter; torso/leg coverage and Nudist tag determine eligibility.'),
 @('RimWorld.OutfitDatabase','SetAllow(SpecialThingFilterDefOf.AllowDeadmansApparel, allow: false);','Non-Anything starting presets explicitly reject corpse-tainted clothing.'),
 @('RimWorld.OutfitDatabase','if (ModsConfig.IdeologyActive)','Slave preset is DLC-gated.'),
 @('RimWorld.OutfitDatabase','if (!ModsConfig.OdysseyActive)','Spacefarer preset is DLC-gated.'),
 @('RimWorld.Pawn_OutfitTracker','curApparelPolicy = Current.Game.outfitDatabase.DefaultOutfit();','An unassigned pawn resolves the current default lazily.'),
 @('RimWorld.Pawn_OutfitTracker','pawn.mindState.Notify_OutfitChanged();','Changing the assigned policy notifies the mind state.'),
 @('RimWorld.Pawn_OutfitTracker','Scribe_References.Look(ref curApparelPolicy, "curOutfit");','Pawn holds a shared policy reference, not a copied filter.'),
 @('RimWorld.Pawn_OutfitTracker','Scribe_Deep.Look(ref forcedHandler, "overrideHandler");','Per-pawn forced-item handler persists separately.'),
 @('Verse.AI.Pawn_MindState','nextApparelOptimizeTick = Find.TickManager.TicksGame;','Policy reassignment permits optimization at the current tick; it does not itself start a job.'),
 @('Verse.AI.Pawn_MindState','Scribe_Values.Look(ref nextApparelOptimizeTick, "nextApparelOptimizeTick", -99999);','Optimization cooldown persists.'),
 @('RimWorld.OutfitForcedHandler','return !forcedAps.Contains(ap);','Forced protection addresses a concrete apparel instance.'),
 @('RimWorld.OutfitForcedHandler','forcedAps.Clear();','Clear-forced empties the override list; it does not strip equipment.'),
 @('RimWorld.OutfitForcedHandler','Scribe_Collections.Look(ref forcedAps, "forcedAps", LookMode.Reference);','Forced flags are saved as apparel references.'),
 @('RimWorld.PawnColumnWorker_Outfit','pawn.outfits.forcedHandler.Reset();','Assignment UI exposes clearing all forced apparel.'),
 @('RimWorld.JobGiver_OptimizeApparel','Rand.Range(6000, 9000)','Unproductive optimization scans schedule a randomized later scan.'),
 @('RimWorld.JobGiver_OptimizeApparel','if (pawn.Faction != Faction.OfPlayer)','Optimizer is intended for the player faction.'),
 @('RimWorld.JobGiver_OptimizeApparel','if (pawn.IsQuestLodger())','Quest lodgers do not use this optimizer.'),
 @('RimWorld.JobGiver_OptimizeApparel','Find.TickManager.TicksGame < pawn.mindState.nextApparelOptimizeTick','Future optimization deadline suppresses scans in ordinary mode.'),
 @('RimWorld.JobGiver_OptimizeApparel','ModsConfig.IdeologyActive && TryCreateRecolorJob','Ideology recoloring is checked ahead of ordinary stripping/selection.'),
 @('RimWorld.JobGiver_OptimizeApparel','pawn.MapHeld.Biome.inVacuum && pawn.Position.GetVacuum(pawn.MapHeld) >= 0.5f','Vacuum exposure can protect vacuum-resistant worn apparel against policy stripping.'),
 @('RimWorld.JobGiver_OptimizeApparel','!currentApparelPolicy.filter.Allows(apparel) && pawn.outfits.forcedHandler.AllowedToAutomaticallyDrop(apparel) && !pawn.apparel.IsLocked(apparel)','Policy-disallowed worn apparel is removed only if neither forced nor locked.'),
 @('RimWorld.JobGiver_OptimizeApparel','job2.haulDroppedApparel = true;','Policy-driven stripping requests subsequent storage hauling.'),
 @('RimWorld.JobGiver_OptimizeApparel','lookInHaulSources: true','Candidates include supported haul-source inventories.'),
 @('RimWorld.JobGiver_OptimizeApparel','!apparel2.IsInAnyStorage()','Automatic wear rejects loose items not in storage.'),
 @('RimWorld.JobGiver_OptimizeApparel','apparel2.IsForbidden(pawn) || apparel2.IsBurning()','Automatic wear rejects forbidden and burning apparel.'),
 @('RimWorld.JobGiver_OptimizeApparel','apparel2.def.apparel.gender != Gender.None && apparel2.def.apparel.gender != pawn.gender','Automatic candidate gender check is explicit.'),
 @('RimWorld.JobGiver_OptimizeApparel','num3 < 0.05f || num3 < num2','A candidate must meet the minimum gain and current best gain; exact ties can replace the earlier candidate.'),
 @('RimWorld.JobGiver_OptimizeApparel','CompBiocodable.IsBiocoded(apparel2) && !CompBiocodable.IsBiocodedFor(apparel2, pawn)','Biocoded apparel for another pawn is rejected.'),
 @('RimWorld.JobGiver_OptimizeApparel','!ApparelUtility.HasPartsToWear(pawn, apparel2.def)','Candidate requires an eligible remaining body part.'),
 @('RimWorld.JobGiver_OptimizeApparel','if (!apparelSource.ApparelSourceEnabled)','A source container can disable automatic access.'),
 @('RimWorld.JobGiver_OptimizeApparel','pawn.CanReserveAndReach(target, PathEndMode.OnCell, pawn.NormalMaxDanger())','Selection checks both reservation and reachable danger level.'),
 @('RimWorld.JobGiver_OptimizeApparel','apparel2.def.apparel.developmentalStageFilter.Has(pawn.DevelopmentalStage)','Age-stage compatibility is a separate gate.'),
 @('RimWorld.JobGiver_OptimizeApparel','return JobMaker.MakeJob(JobDefOf.Wear, thing);','A selected item creates an actual wear job.'),
 @('RimWorld.JobGiver_OptimizeApparel','ap.def == ThingDefOf.Apparel_ShieldBelt && pawn.equipment.Primary != null','Projectile users avoid automatic shield-belt choice.'),
 @('RimWorld.JobGiver_OptimizeApparel','ap.def.apparel.ignoredByNonViolent && pawn.WorkTagIsDisabled(WorkTags.Violent)','Nonviolent pawns avoid apparel explicitly marked unsuitable.'),
 @('RimWorld.JobGiver_OptimizeApparel','!pawn.outfits.forcedHandler.AllowedToAutomaticallyDrop(wornApparel[i]) || pawn.apparel.IsLocked(wornApparel[i])','Any conflicting forced/locked item blocks automatic replacement.'),
 @('RimWorld.JobGiver_OptimizeApparel','num -= wornScoresCache[i];','Gain subtracts every conflicting worn item score.'),
 @('RimWorld.JobGiver_OptimizeApparel','num *= 10f;','A no-replacement candidate receives a tenfold gain factor; other tenfold modifiers exist separately.'),
 @('RimWorld.JobGiver_OptimizeApparel','float num = 0.1f + ap.def.apparel.scoreOffset;','Raw score starts with a base plus definition offset.'),
 @('RimWorld.JobGiver_OptimizeApparel','ap.GetStatValue(StatDefOf.ArmorRating_Sharp) + ap.GetStatValue(StatDefOf.ArmorRating_Blunt)','Raw score adds effective sharp and blunt armor, not heat armor.'),
 @('RimWorld.JobGiver_OptimizeApparel','HitPointsPercentScoreFactorCurve.Evaluate(x)','Durability adjusts desirability independently of the filter.'),
 @('RimWorld.JobGiver_OptimizeApparel','num += ap.GetSpecialApparelScoreOffset();','Special apparel may contribute its own score offset.'),
 @('RimWorld.JobGiver_OptimizeApparel','if (neededWarmth == NeededWarmth.Warm)','Only the Warm state adds the ordinary insulation multiplier here.'),
 @('RimWorld.JobGiver_OptimizeApparel','StatDefOf.Insulation_Cold','Warm-state score uses cold insulation.'),
 @('RimWorld.JobGiver_OptimizeApparel','ap.WornByCorpse && (pawn == null || ThoughtUtility.CanGetThought','Tainted penalty depends on whether the wearer can receive the relevant thought.'),
 @('RimWorld.JobGiver_OptimizeApparel','num -= 0.5f;','Tainted and disliked human-leather branches apply a half-point deduction, then further reduce positive remainder.'),
 @('RimWorld.JobGiver_OptimizeApparel','num *= 25f;','Required apparel receives a strong role/title requirement bonus.'),
 @('RimWorld.JobGiver_OptimizeApparel','num *= 0.25f;','Insufficient royal apparel quality has a score penalty in addition to policy filtering.'),
 @('RimWorld.PawnApparelGenerator','float num = GenTemperature.AverageTemperatureAtTileForTwelfth(tile, twelfth);','Needed warmth uses tile seasonal average for a twelfth, not room/current ambient temperature.'),
 @('RimWorld.PawnApparelGenerator','num < pawn.def.GetStatValueAbstract(StatDefOf.ComfyTemperatureMin) - 4f','Warm uses the species abstract comfortable minimum minus four.'),
 @('RimWorld.PawnApparelGenerator','num > pawn.def.GetStatValueAbstract(StatDefOf.ComfyTemperatureMin) + 4f','Cool also compares against the minimum plus four, not the maximum.'),
 @('Verse.SimpleCurve','return points[0].y;','Curve evaluation clamps below the first x.'),
 @('Verse.SimpleCurve','return points[points.Count - 1].y;','Curve evaluation clamps above the final x.'),
 @('Verse.SimpleCurve','return Mathf.Lerp(curvePoint.y, curvePoint2.y, t);','Interior curve segments use linear interpolation.'),
 @('Verse.ThingFilter','private FloatRange allowedHitPointsPercents = FloatRange.ZeroToOne;','Default durability range is zero through one, expressed as a fraction.'),
 @('Verse.ThingFilter','private QualityRange allowedQualities = QualityRange.All;','Default quality range covers every quality level.'),
 @('Verse.ThingFilter','f = GenMath.RoundedHundredth(f);','Filter durability rounds HP/maxHP to a hundredth before comparison.'),
 @('Verse.GenMath','return Mathf.Round(f * 100f) / 100f;','Hundredth rounding delegates to Unity Mathf.Round; its runtime implementation is outside this assembly.'),
 @('Verse.FloatRange','if (f >= min - 1E-05f)','Range epsilon is one hundred-thousandth at the lower bound.'),
 @('Verse.FloatRange','return f <= max + 1E-05f;','Range epsilon is one hundred-thousandth at the upper bound.'),
 @('Verse.ThingFilter','allowedHitPointsPercents.IncludesEpsilon(Mathf.Clamp01(f))','Durability filter uses clamping and epsilon-inclusive bounds.'),
 @('Verse.ThingFilter','t.TryGetQuality(out var qc) && !allowedQualities.Includes(qc)','Quality filtering applies when the item participates in the quality filter and has quality.'),
 @('Verse.ThingFilter','disallowedSpecialFilters[i].Worker.Matches(t)','Special filters can reject individual item states, such as corpse taint.'),
 @('RimWorld.QualityRange','return (int)p <= (int)max;','Quality ranges include both minimum and maximum.'),
 @('RimWorld.SpecialThingFilterWorker_DeadmansApparel','return apparel.WornByCorpse;','Tainted filter uses the item taint state.'),
 @('RimWorld.ForbidUtility','t.PositionHeld.IsForbidden(pawn)','Item forbidden check incorporates the held position and allowed-area rules.'),
 @('RimWorld.ForbidUtility','if (!c.InAllowedArea(pawn))','For ordinary caring pawns, destinations outside their allowed area are forbidden.'),
 @('RimWorld.ForbidUtility','effectiveAreaRestrictionInPawnCurrentMap.TrueCount > 0','An empty native allowed area does not restrict destinations here.'),
 @('RimWorld.FloatMenuOptionProvider_Wear','context.FirstSelectedPawn.apparel.WouldReplaceLockedApparel(apparel)','Manual force-wear rejects locked conflicts.'),
 @('RimWorld.FloatMenuOptionProvider_Wear','apparel.SetForbidden(value: false);','Accepted manual wear clears the item forbidden flag.'),
 @('Verse.AI.Pawn_JobTracker','job.playerForced = true;','Taking an ordered job marks it player-forced.'),
 @('RimWorld.JobDriver_Wear','pawn.Reserve(Apparel, job, 1, -1, null, errorOnFailed)','Wear driver reserves the actual apparel or its source.'),
 @('RimWorld.JobDriver_Wear','duration = (int)(Apparel.GetStatValue(StatDefOf.EquipDelay) * 60f);','New clothing equip delay converts seconds into native ticks.'),
 @('RimWorld.JobDriver_Wear','duration += (int)(wornApparel[num].GetStatValue(StatDefOf.EquipDelay) * 60f);','Conflicting old clothing removal delays add to total wear duration.'),
 @('RimWorld.JobDriver_Wear','Toils_Goto.GotoThing(TargetIndex.A, PathEndMode.ClosestTouch)','Wear requires walking to the actual item.'),
 @('RimWorld.JobDriver_Wear','this.FailOnBurningImmobile(TargetIndex.A);','Burning target can invalidate the in-progress job.'),
 @('RimWorld.JobDriver_Wear','toil.FailOnDespawnedNullOrForbidden','Target disappearance or newly forbidden status can invalidate progress.'),
 @('RimWorld.JobDriver_Wear','pawn.apparel.TryDrop(wornApparel[num], out var _, pawn.PositionHeld, forbid)','Conflicting clothing is physically dropped during the wear delay.'),
 @('RimWorld.JobDriver_Wear','Scribe_Values.Look(ref unequipBuffer, "unequipBuffer", 0);','Wear progress/removal buffer persists.'),
 @('RimWorld.JobDriver_Wear','pawn.outfits != null && job.playerForced','Only a completed player-forced wear job sets the forced override.'),
 @('RimWorld.JobDriver_Wear','pawn.outfits.forcedHandler.SetForced(apparel, forced: true);','The forced override belongs to the newly worn instance.'),
 @('RimWorld.JobDriver_RemoveApparel','Toils_General.Wait(duration)','Explicit removal also takes equip-delay time.'),
 @('RimWorld.JobDriver_RemoveApparel','!pawn.apparel.WornApparel.Contains(Apparel)','Removal checks that the intended item is still worn.'),
 @('RimWorld.JobDriver_RemoveApparel','resultingAp.SetForbidden(value: false, warnOnFail: false);','Automatic removal allows the dropped item before trying storage hauling.'),
 @('RimWorld.JobDriver_RemoveApparel','StoreUtility.TryFindBestBetterStoreCellFor','Hauling the removed item requires a real suitable storage destination.'),
 @('RimWorld.JobDriver_RemoveApparel','Toils_Haul.StartCarryThing(TargetIndex.A)','Post-removal hauling physically carries the same dropped item.'),
 @('RimWorld.Pawn_ApparelTracker','wornApparel.TryAdd(newApparel, canMergeWithExistingStacks: false);','Wear transfers the specific entity into apparel ownership without merging.'),
 @('RimWorld.Pawn_ApparelTracker','pawn.outfits.forcedHandler.SetForced(apparel, forced: false);','Removing apparel clears its forced override.'),
 @('RimWorld.ApparelProperties','public float scoreOffset;','Definition score offset defaults to zero unless XML or other configuration supplies it.'),
 @('RimWorld.Apparel','num += allComps[i].CompGetSpecialApparelScoreOffset();','Special score is the sum of component contributions; absence of a definition offset does not prove every component offset is zero.'),
 @('RimWorld.Dialog_ManageApparelPolicies','ThingFilterUI.DoThingFilterConfigWindow','Policy manager edits a shared filter with apparel as the parent category.')
)
$records=@(foreach($r in $rules){
 $text=$sources[$r[0]];$matches=@();$lines=$text.Split("`n")
 for($i=0;$i -lt $lines.Length;$i++){if($lines[$i].Contains($r[1])){$matches+=,[ordered]@{line=$i+1;text=$lines[$i].Trim()}}}
 if(!$matches.Count){throw "Missing anchor $($r[0]): $($r[1])"}
 [ordered]@{type=$r[0];needle=$r[1];locations=$matches;interpretation=$r[2]}
})
function Bounded([string]$type,[string]$start,[string]$end,[string[]]$absent,[string[]]$present,[string]$meaning){
 $s=$sources[$type];$a=$s.IndexOf($start,[StringComparison]::Ordinal);if($a -lt 0){throw "Missing start $start"}
 $b=if($end){$s.IndexOf($end,$a+$start.Length,[StringComparison]::Ordinal)}else{$s.Length};if($b -le $a){throw "Missing end $end"}
 $body=$s.Substring($a,$b-$a)
 foreach($t in $absent){if($body.Contains($t)){throw "Unexpected bounded token $type $t"}}
 foreach($t in $present){if(!$body.Contains($t)){throw "Missing bounded token $type $t"}}
 [ordered]@{type=$type;start=$start;end=$end;lineStart=$s.Substring(0,$a).Split("`n").Count;lineEnd=$s.Substring(0,$b).Split("`n").Count;sha256=TextHash $body;absent=$absent;present=$present;interpretation=$meaning}
}
$bounded=@(
 (Bounded 'RimWorld.PawnApparelGenerator' 'public static NeededWarmth CalculateNeededWarmth' 'private static float ApparelToxicEnvironmentToAddress' @('AmbientTemperature','ComfyTemperatureMax','GetRoom') @('AverageTemperatureAtTileForTwelfth','ComfyTemperatureMin) - 4f','ComfyTemperatureMin) + 4f') 'Warmth classification uses the abstract race minimum and seasonal average; no room or effective worn-gear temperature in this method.'),
 (Bounded 'RimWorld.JobGiver_OptimizeApparel' 'public static float ApparelScoreRaw' '' @('Insulation_Heat','NeededWarmth.Cool','AmbientTemperature','ArmorRating_Heat','MarketValue','MoveSpeed') @('ArmorRating_Sharp','ArmorRating_Blunt','Insulation_Cold','HitPointsPercentScoreFactorCurve') 'These named direct terms are absent from the raw scoring method; indirect special offsets are not ruled out.'),
 (Bounded 'RimWorld.JobGiver_OptimizeApparel' 'public static float ApparelScoreGain' 'public static float ApparelScoreRaw' @('currentApparelPolicy','IsInAnyStorage') @('CanWearTogether','AllowedToAutomaticallyDrop','num -= wornScoresCache[i]','if (!flag)','num *= 10f') 'Gain handles conflict opportunity cost and forced protection; candidate policy/storage checks live in TryGiveJob.'),
 (Bounded 'RimWorld.OutfitForcedHandler' 'public void Reset()' 'public bool AllowedToAutomaticallyDrop' @('TryDrop','Notify_OutfitChanged','nextApparelOptimizeTick') @('forcedAps.Clear()') 'Clearing forced state neither strips clothes nor directly resets the optimization deadline in this method.'),
 (Bounded 'RimWorld.ApparelPolicy' 'public class ApparelPolicy' '' @('settingsChangedCallback','Notify_OutfitChanged','nextApparelOptimizeTick') @('new ThingFilter()','CopyAllowancesFrom') 'This policy class does not wire an immediate pawn rescan callback; no global absence claim.'),
 (Bounded 'RimWorld.Dialog_ManageApparelPolicies' 'protected override void DoContentsRect' 'private IEnumerable<SpecialThingFilterDef> HiddenSpecialThingFilters' @('Notify_OutfitChanged','nextApparelOptimizeTick') @('SelectedPolicy.filter') 'The apparel filter edit body itself does not reset pawn deadlines.'),
 (Bounded 'RimWorld.FloatMenuOptionProvider_Wear' 'protected override FloatMenuOption GetSingleOptionFor' '' @('CurrentApparelPolicy','AllowedToAutomaticallyDrop','IsInAnyStorage','IsForced(') @('WouldReplaceLockedApparel','CanReach','IsBurning','TryTakeOrderedJob') 'Manual wear does not consult policy, storage membership or ordinary forced protection in this provider; physical/locked gates remain.'),
 (Bounded 'RimWorld.JobDriver_Wear' 'protected override IEnumerable<Toil> MakeNewToils' 'private SoundDef GetCurrentWearSound' @('CurrentApparelPolicy','filter.Allows','AllowedToAutomaticallyDrop') @('FailOnDespawnedNullOrForbidden','pawn.apparel.Wear(apparel)','job.playerForced','SetForced(apparel, forced: true)') 'Wear driver rechecks target validity but not policy/forced filter during this method; a Web policy-change cancel is an intentional adaptation.'),
 (Bounded 'RimWorld.JobDriver_Wear' 'private void TryUnequipSomething' '' @('Destroy(','unequipBuffer -=','unequipBuffer = 0','SetForced(') @('unequipBuffer >= num2','TryDrop','EndJobWith(JobCondition.Errored)') 'Conflicts are dropped rather than destroyed. The buffer is not decremented here, so the implementation is not a literal sequential-delay simulation.'),
 (Bounded 'RimWorld.JobDriver_RemoveApparel' 'protected override IEnumerable<Toil> MakeNewToils' '' @('Destroy(','Generate','MakeThing(') @('TryDrop','TryFindBestBetterStoreCellFor','StartCarryThing') 'Removal and optional hauling reuse the real item, without manufacturing or deleting replacements.'),
 (Bounded 'Verse.SimpleCurve' 'public float Evaluate(float x)' 'public float EvaluateInverted' @('LerpUnclamped') @('x <= points[0].x','x >= points[points.Count - 1].x','Mathf.Lerp') 'Scoring curves interpolate inside and clamp outside their endpoints.'),
 (Bounded 'RimWorld.OutfitDatabase' 'public AcceptanceReport TryDelete' 'public ApparelPolicy MakeNewOutfit' @('Destroy','RemoveAll') @('AllMapsCaravansAndTravellingTransporters_Alive','OutfitInUse','CurrentApparelPolicy = null','outfits.Remove(apparelPolicy)') 'Deleting a policy is reference management, not clothing removal.')
)
$docs=@{}
function XmlDoc([string]$rel){if(!$docs.ContainsKey($rel)){$d=[Xml.XmlDocument]::new();$d.XmlResolver=$null;$d.Load((Join-Path $GameRoot $rel));$docs[$rel]=$d};return ,$docs[$rel]}
$apparelFields=@('defName','statBases/EquipDelay','statBases/ArmorRating_Sharp','statBases/ArmorRating_Blunt','statBases/Insulation_Cold','statBases/StuffEffectMultiplierArmor','statBases/StuffEffectMultiplierInsulation_Cold','statBases/StuffEffectMultiplierInsulation_Heat','apparel/layers','apparel/bodyPartGroups','apparel/defaultOutfitTags','apparel/scoreOffset','thingCategories','comps')
$specs=@(
 @('Data/Core/Defs/ThingDefs_Races/Races_Humanlike.xml','/Defs/ThingDef[defName="Human"]',@('statBases/ComfyTemperatureMin','statBases/ComfyTemperatureMax'),'Human abstract comfortable minimum is sixteen; warmth thresholds become twelve and twenty.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[@Name="ApparelNoQualityBase"]',$apparelFields,'Shared apparel parent; selected fields are not inheritance-expanded.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[@Name="ApparelBase"]',$apparelFields,'Quality apparel parent adds the quality component.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[defName="Apparel_BasicShirt"]',$apparelFields,'Shirt coverage, layers, default policy tags and equip time.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[defName="Apparel_Pants"]',$apparelFields,'Pants coverage, layers and default policy tags.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[defName="Apparel_Parka"]',$apparelFields,'Parka provides material-scaled insulation and its own wear delay.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[defName="Apparel_Duster"]',$apparelFields,'Duster has distinct insulation multipliers and preset tags.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[defName="Apparel_FlakVest"]',$apparelFields,'Flak vest supplies direct armor values and a five-second equip delay.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[defName="Apparel_PlateArmor"]',$apparelFields,'Plate armor spans multiple layers and its replacement cost includes every conflict.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Headgear.xml','/Defs/ThingDef[defName="Apparel_Tuque"]',$apparelFields,'Tuque head coverage and preset tags.'),
 @('Data/Core/Defs/ThingDefs_Misc/Apparel_Headgear.xml','/Defs/ThingDef[defName="Apparel_SimpleHelmet"]',$apparelFields,'Simple helmet head coverage and preset tags.'),
 @('Data/Core/Defs/Stats/Stats_Apparel.xml','/Defs/StatDef[@Name="ArmorRatingBase"]',@('defaultBaseValue','minValue','maxValue','parts'),'Quality influences effective armor before the optimizer reads the armor stat.'),
 @('Data/Core/Defs/Misc/SpecialThingFilterDefs/SpecialThingFilters.xml','/Defs/SpecialThingFilterDef[defName="AllowDeadmansApparel"]',@('parentCategory','allowedByDefault','workerClass'),'Tainted apparel is allowed by the special-filter default, unless a policy disables it.'),
 @('Data/Core/Defs/Misc/SpecialThingFilterDefs/SpecialThingFilters.xml','/Defs/SpecialThingFilterDef[defName="AllowNonDeadmansApparel"]',@('parentCategory','allowedByDefault','workerClass'),'Clean clothing is separately filterable but hidden in the apparel manager.'),
 @('Data/Core/Defs/JobDefs/Jobs_Misc.xml','/Defs/JobDef[defName="Wear"]',@('driverClass','reportString','allowOpportunisticPrefix'),'Wear job points to the physical wear driver.'),
 @('Data/Core/Defs/JobDefs/Jobs_Misc.xml','/Defs/JobDef[defName="RemoveApparel"]',@('driverClass','reportString','allowOpportunisticPrefix'),'Removal has its own job driver.'),
 @('Data/Core/Defs/ThinkTreeDefs/Humanlike.xml','/Defs/ThinkTreeDef[defName="Humanlike"]',@('.//li[@Class="JobGiver_OptimizeApparel"]'),'Automatic apparel selection is an ordinary think-tree task, not an independent equipment tick.')
)
$defs=@(foreach($spec in $specs){
 $doc=XmlDoc $spec[0];$nodes=@($doc.SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected XML node count: $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash (Join-Path $GameRoot $spec[0]);xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
$think=(XmlDoc 'Data/Core/Defs/ThinkTreeDefs/Humanlike.xml').SelectSingleNode('/Defs/ThinkTreeDef[defName="Humanlike"]//li[@Class="JobGiver_OptimizeApparel"]')
$anc=@();$p=$think.ParentNode;while($p -and $p.Name -ne 'ThinkTreeDef'){if($p.Attributes['Class']){$anc+=,[ordered]@{class=$p.GetAttribute('Class');invert=$p.SelectSingleNode('invert')?.InnerText;tag=$p.SelectSingleNode('tagToGive')?.InnerText}};$p=$p.ParentNode}
$sequence=@(foreach($n in $think.ParentNode.ParentNode.ParentNode.SelectNodes('./li')){[ordered]@{class=$n.GetAttribute('Class');tag=$n.SelectSingleNode('tagToGive')?.InnerText;emergency=$n.SelectSingleNode('emergency')?.InnerText;subtree=$n.SelectSingleNode('treeDef')?.InnerText;children=@($n.SelectNodes('./subNodes/li')|ForEach-Object {$_.GetAttribute('Class')})}})
$apparelFiles=@('Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','Data/Core/Defs/ThingDefs_Misc/Apparel_Headgear.xml')
$definitionProfiles=@(foreach($name in @('Apparel_Tuque','Apparel_Parka','Apparel_Duster','Apparel_BasicShirt','Apparel_Pants','Apparel_SimpleHelmet','Apparel_PlateArmor')){
 $chain=@();$xpath='/Defs/ThingDef[defName="'+$name+'"]';$depth=0
 do{
  $found=@(foreach($rel in $apparelFiles){foreach($n in (XmlDoc $rel).SelectNodes($xpath)){[pscustomobject]@{file=$rel;node=$n}}})
  if($found.Count -ne 1){throw "Unexpected parent chain match: $name $xpath"}
  $node=$found[0].node;$offset=$node.SelectSingleNode('apparel/scoreOffset')
  if($offset){throw "Score offset now supplied in selected apparel chain: $name"}
  $chain+=,[ordered]@{file=$found[0].file;sha256=Hash (Join-Path $GameRoot $found[0].file);xpath=$xpath;parentName=$node.GetAttribute('ParentName');scoreOffsetNodeCount=0;defaultOutfitTags=@($node.SelectNodes('apparel/defaultOutfitTags/li')|ForEach-Object InnerText)}
  $parent=$node.GetAttribute('ParentName');$xpath='/Defs/ThingDef[@Name="'+$parent+'"]';$depth++;if($depth -gt 15){throw 'Unexpected apparel parent cycle'}
 }while($parent)
 [ordered]@{def=$name;definitionScoreOffset=0;source='Unspecified across complete selected Core parent chain; ApparelProperties float default';chain=$chain}
})
$record=[ordered]@{
 evidence_id='RW17-APPAREL-POLICIES-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile)
 rules=$records;boundedChecks=$bounded;packagedXml=$defs;definitionProfiles=$definitionProfiles;optimizerThinkTree=[ordered]@{ancestorsNearestFirst=$anc;siblingsInOrder=$sequence}
 nativeReference=[ordered]@{
  basePresetLabels=@('Anything','Worker','Soldier','Nudist');additionalPresets=[ordered]@{Ideology='Slave';Odyssey='Spacefarer'}
  unproductiveScanDelayTicks=@(6000,9000);minimumScoreGain=.05;gainFactorWithoutConflicts=10
  rawBase=.1;ordinaryArmorTerms=@('ArmorRating_Sharp','ArmorRating_Blunt')
  durabilityScoreCurve=@(@(0,0),@(.2,.2),@(.22,.3),@(.5,.3),@(.52,1));warmColdInsulationFactorCurve=@(@(0,1),@(30,8));curveEndsClamp=$true
  warmthSeason='current Twelfth average at tile';warmthThresholdRelativeToAbstractComfortMinimum=@(-4,4);humanComfort=@(16,26);humanWarmBelow=12;humanCoolAbove=20;coolStateAddsOrdinaryHeatInsulationScore=$false
  durabilityFilterUnit='HP / maxHP rounded to a hundredth by Mathf.Round, clamped to 0..1';durabilityFilterEpsilon=.00001;qualityRange='Awful through Legendary, inclusive'
  automaticCandidateRequiresStorage=$true;automaticCandidateRequiresReserveAndReach=$true;forcedBlocksAutomaticDrop=$true;forcedBlocksExplicitManualReplacement=$false;lockedBlocksManualReplacement=$true
  reassignmentResetsOptimizeDeadline=$true;clearForcedDirectlyResetsDeadline=$false;wearCompletionSetsForcedOnlyIfPlayerOrdered=$true
  equipDelayNativeTicksPerSecond=60;wearDurationIncludesConflictingRemovalDelays=$true;automaticRemoveRequestsHauling=$true
 }
 webDesignChoices=@('Prioritize a complete shared-policy, physical selection/wear/removal, forced protection and persistence loop before tuning rates.','Reuse seasonal climate for warmth classification if available; room-temperature ranking is a distinct design adaptation.','A fixed deterministic retry interval and tie-breaker differ from native random scan timing and list-order ties.','Immediate rescans after shared filter edits or clear-forced are usability adaptations beyond the directly observed setters.','Rejecting or cancelling an active wear job after policy edits is a Web consistency choice; the native wear driver does not re-evaluate the policy in the bounded method.','Legacy saves defaulting to manual clothing management preserve old Web behavior; this is not a native migration rule.','Preserve the layer/body-part-group conflict graph instead of replacing it with one item per garment category.','DLC wardrobe rules, role/title bonuses, biocoding, clothing sources, taint and special apparel must remain explicit omissions until supported.')
 limits=@('Static derived C# and packaged Core XML are not original source or runtime interaction proof.','REA managed metadata is reused only for the exact same assembly identity; separately hashed ILSpy types support these method claims.','No game, browser, preview, GUI interaction or screenshot was launched.','Selected XML is not the fully inherited, mod-patched effective Def database.','Bounded absence applies only to the recorded methods and tokens, not every caller, extension or runtime hook.','Reference constants are not measured Web balance or full behavioral parity.','Full derived C#, assemblies and game assets remain local and unpublished.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 30).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static apparel-policies projection differs'};"Checked apparel-policies: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) XML projections"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));"Collected apparel-policies: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) XML projections"}
