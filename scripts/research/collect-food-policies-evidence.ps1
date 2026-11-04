param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static packaged evidence only. Never load target code or launch the game/browser/GUI.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/food-policies-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/food-policies-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$sources=@{}
foreach($m in $manifest.types){$file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)}
$rules=@(
 @('RimWorld.Policy','public int id;','Policy identity is separate from its editable label.'),
 @('RimWorld.FoodPolicy','public ThingFilter filter = new ThingFilter();','Food policy is a shared item filter.'),
 @('RimWorld.FoodPolicy','return filter.Allows(thing);','Instance eligibility delegates to ThingFilter.'),
 @('RimWorld.FoodPolicy','filter.CopyAllowancesFrom(foodPolicy.filter);','Copying a policy copies its allowances.'),
 @('RimWorld.FoodPolicy','Scribe_Deep.Look(ref filter, "filter");','The policy filter persists.'),
 @('RimWorld.FoodRestrictionDatabase','return foodRestrictions[0];','The first policy is the default.'),
 @('RimWorld.FoodRestrictionDatabase','foodRestrictions[0] = policy;','Changing default swaps database entries.'),
 @('RimWorld.FoodRestrictionDatabase','PawnsFinder.AllMapsCaravansAndTravellingTransporters_Alive','Deletion checks live map, caravan and transporter assignments.'),
 @('RimWorld.FoodRestrictionDatabase','return new AcceptanceReport("FoodRestrictionInUse".Translate(item));','A policy assigned to an active pawn cannot be deleted.'),
 @('RimWorld.FoodRestrictionDatabase','item2.foodRestriction.CurrentFoodPolicy = null;','Other world or temporary references are cleared on successful deletion.'),
 @('RimWorld.FoodRestrictionDatabase','foodRestrictions.Max((FoodPolicy o) => o.id) + 1','New IDs use current maximum plus one.'),
 @('RimWorld.FoodRestrictionDatabase','x.GetStatValueAbstract(StatDefOf.Nutrition) > 0f','New policies start by allowing definitions with positive abstract nutrition.'),
 @('RimWorld.FoodRestrictionDatabase','MakeNewFoodRestriction().label = "FoodRestrictionLavish".Translate();','Lavish is the first starting policy; it initially permits all food in the base filter.'),
 @('RimWorld.FoodRestrictionDatabase','(int)allDef.ingestible.preferability >= 10 && allDef != ThingDefOf.InsectJelly','Fine preset excludes lavish-or-higher preference except insect jelly.'),
 @('RimWorld.FoodRestrictionDatabase','(int)allDef2.ingestible.preferability >= 9 && allDef2 != ThingDefOf.InsectJelly','Simple excludes fine-or-higher preference except insect jelly.'),
 @('RimWorld.FoodRestrictionDatabase','foodPolicy2.filter.SetAllow(ThingDefOf.MealSurvivalPack, allow: false);','Simple additionally excludes packaged survival meals.'),
 @('RimWorld.FoodRestrictionDatabase','(int)allDef3.ingestible.preferability >= 8 && allDef3 != ThingDefOf.MealNutrientPaste && allDef3 != ThingDefOf.InsectJelly','Paste excludes simple-or-higher with explicit exceptions.'),
 @('RimWorld.FoodRestrictionDatabase','(int)allDef4.ingestible.preferability >= 7','Raw excludes awful-meal-or-higher food preference.'),
 @('RimWorld.FoodRestrictionDatabase','foodPolicy4.filter.SetAllow(ThingDefOf.Chocolate, allow: false);','Raw also excludes chocolate.'),
 @('RimWorld.FoodRestrictionDatabase','foodPolicy5.filter.SetDisallowAll();','Nothing is an empty filter, not a starvation fallback mode.'),
 @('RimWorld.FoodRestrictionDatabase','if (!ModsConfig.IdeologyActive)','Vegetarian, carnivore, cannibal and insect-meat presets require Ideology.'),
 @('RimWorld.FoodRestrictionDatabase','foodPolicy.filter.SetAllow(ThingDefOf.HemogenPack, allow: false);','Biotech hemogen packs are excluded explicitly.'),
 @('RimWorld.Pawn_FoodRestrictionTracker','curPolicy = Current.Game.foodRestrictionDatabase.DefaultFoodRestriction();','A null stored reference resolves the database default lazily.'),
 @('RimWorld.Pawn_FoodRestrictionTracker','curPolicy = value;','Assignment sets a reference; the setter itself has no job interruption.'),
 @('RimWorld.Pawn_FoodRestrictionTracker','pawn.RaceProps.Humanlike && !pawn.Destroyed','Ordinary food policy configuration is restricted to non-destroyed humanlikes.'),
 @('RimWorld.Pawn_FoodRestrictionTracker','return pawn.HostFaction == Faction.OfPlayer;','Player-hosted prisoners or guests can be configured even when their faction is not player.'),
 @('RimWorld.Pawn_FoodRestrictionTracker','pawn.Faction != Faction.OfPlayer && (getter == null || getter.Faction != Faction.OfPlayer)','A non-player eater respects the colony policy only when a player-faction getter supplies the food.'),
 @('RimWorld.Pawn_FoodRestrictionTracker','if (pawn.InMentalState)','The eater ignores its policy while in a mental state.'),
 @('RimWorld.Pawn_FoodRestrictionTracker','Scribe_References.Look(ref curPolicy, "curRestriction");','Pawn holds a persisted shared policy reference.'),
 @('RimWorld.Pawn_FoodRestrictionTracker','ITab_Pawn_Feeding.BabyConsumableFoods.Contains(food)','Babies have a separate per-food permission path.'),
 @('RimWorld.PawnComponentsUtility','pawn.foodRestriction = new Pawn_FoodRestrictionTracker(pawn);','Food trackers are created under a humanlike conditional, not for ordinary colony animals.'),
 @('RimWorld.FoodUtility','if (!p.FoodIsSuitable(food))','Species, food need and developmental suitability are checked before ordinary policy allowance.'),
 @('RimWorld.FoodUtility','p.foodRestriction.GetCurrentRespectedRestriction(getter)','The policy belongs to eater p, while getter controls the relevant exception.'),
 @('RimWorld.FoodUtility','!currentRespectedRestriction.Allows(food) && Dialog_ManageFoodPolicies.FoodGlobalFilter.Allows(food)','Definition-level policy veto is limited by the global food filter.'),
 @('RimWorld.FoodUtility','p.foodRestriction != null && !p.IsSubhuman && !DevelopmentalStageExtensions.Baby(p.DevelopmentalStage)','Instance-level policy additionally excludes subhuman and baby paths.'),
 @('RimWorld.FoodUtility','currentRespectedRestriction != null && !currentRespectedRestriction.Allows(food)','Instance-level policy is checked for the actual food, including applicable special filters.'),
 @('RimWorld.FoodUtility','(allowIfStarving && p.needs.food.Starving)','Starvation can relax title-based acceptability; this is distinct from policy permissions.'),
 @('RimWorld.FoodUtility','thing = BestFoodInInventory(getter, eater,','Food search considers the getter inventory for the eater.'),
 @('RimWorld.FoodUtility','eater.WillEat(thing, holder, careIfNotAcceptableForTitle: true, allowVenerated)','Inventory food still passes the eater policy; inventory ownership is not an automatic exemption.'),
 @('RimWorld.FoodUtility','CompRottable compRottable = thing.TryGetComp<CompRottable>();','Inventory search can prioritize food approaching rot.'),
 @('RimWorld.FoodUtility','compRottable.TicksUntilRotAtCurrentTemp < 30000','Fresh inventory food close to rot is favored early.'),
 @('RimWorld.FoodUtility','num2 -= 32f;','Inventory comparison includes an explicit score penalty against ground food.'),
 @('RimWorld.FoodUtility','canUsePackAnimalInventory & canManipulateTools','Supported pack-animal inventory is a gated fallback source.'),
 @('RimWorld.FoodUtility','else if (desperate)','Desperation lowers the food preference floor.'),
 @('RimWorld.FoodUtility','minPref = FoodPreferability.DesperateOnly;','Desperate search can consider low-preference food while retaining the validator.'),
 @('RimWorld.FoodUtility','!eater.WillEat(t, getter, careIfNotAcceptableForTitle: true, allowVenerated)','Map candidates also use the eater policy and getter context.'),
 @('RimWorld.FoodUtility','(!desperate && t.IsNotFresh())','Desperation relaxes this freshness gate, not every suitability gate.'),
 @('RimWorld.FoodUtility','(!allowForbidden && t.IsForbidden(getter))','Forbidden and area checks concern the getter.'),
 @('RimWorld.FoodUtility','if (!ignoreReservations && !getter.CanReserve(t, 10, stackCount))','Selection checks reservability for the intended quantity.'),
 @('RimWorld.FoodUtility','SpawnedFoodSearchInnerScan(eater, getter.Position','Humanlike selection uses the eater preference but getter origin and traversal.'),
 @('RimWorld.FoodUtility','!eater.WillEat(harvestedThingDef, getter','Harvest fallback validates the resulting food definition.'),
 @('RimWorld.FoodUtility','t.IsSociallyProper(eater, eater.IsPrisonerOfColony, animalsCare)','Social ownership and prisoner-room suitability are additional candidate gates.'),
 @('RimWorld.FoodUtility','float num = 300f;','Food optimality starts from a base score.'),
 @('RimWorld.FoodUtility','num -= dist;','Distance reduces food optimality.'),
 @('RimWorld.FoodUtility','FoodOptimalityEffectFromMoodCurve.Evaluate','Mood consequences contribute to food choice.'),
 @('RimWorld.FoodUtility','num += foodDef.ingestible.optimalityOffsetHumanlikes;','Definition preference offsets contribute for humanlike eaters.'),
 @('RimWorld.FoodUtility','int num = StackCountForNutrition(ingester.needs.food.NutritionWanted, singleFoodNutrition);','Quantity follows eater nutritional deficit, not getter deficit.'),
 @('RimWorld.FoodUtility','num = Mathf.Min(num, def.ingestible.maxNumToIngestAtOnce);','Per-food ingestion cap limits requested stack count.'),
 @('RimWorld.FoodUtility','Mathf.RoundToInt(wantedNutrition / singleFoodNutrition)','Requested pickup count rounds the nutritional deficit to an integer.'),
 @('Verse.RaceProperties','DietCategory.Omnivorous => 0.3f','The installed native omnivore wants-to-eat threshold is thirty percent.'),
 @('RimWorld.Need_Food','FoodLevelPercentageWantEat * 0.8f','Hungry threshold is eighty percent of the wants-to-eat threshold.'),
 @('RimWorld.Need_Food','FoodLevelPercentageWantEat * 0.4f','Urgently hungry threshold is forty percent of wants-to-eat.'),
 @('RimWorld.JobGiver_GetFood','food.CurLevelPercentage < pawn.RaceProps.FoodLevelPercentageWantEat','Ordinary automatic hunger work has a desire-to-eat threshold.'),
 @('RimWorld.JobGiver_GetFood','FoodUtility.TryFindBestFoodSourceFor(pawn, pawn, desperate','Self-feeding uses the same pawn as getter and eater.'),
 @('RimWorld.JobGiver_GetFood','HungerCategory.Starving','Starvation determines desperate search, rather than clearing the policy.'),
 @('RimWorld.JobGiver_GetFood','firstHediffOfDef.Severity > 0.4f','Humanlike corpse selection additionally needs severe malnutrition in this giver.'),
 @('RimWorld.WorkGiver_FeedPatient','patient.needs.food.CurCategory == HungerCategory.Starving','Patient hunger drives desperate food search.'),
 @('RimWorld.WorkGiver_FeedPatient','pawn2.foodRestriction.GetCurrentRespectedRestriction(pawn)','Doctor feeding consults the patient policy with the doctor as getter.'),
 @('RimWorld.WorkGiver_FeedPatient','currentRespectedRestriction.filter.AllowedDefCount == 0','An empty respected policy explicitly prevents feeding work.'),
 @('RimWorld.WorkGiver_FeedPatient','FoodUtility.GetNutrition(pawn2, foodSource, foodDef)','Patient-specific nutrition determines the feeding amount.'),
 @('RimWorld.FeedPatientUtility','if (!HealthAIUtility.ShouldSeekMedicalRest(p))','Ordinary patient feeding requires a medical-rest reason.'),
 @('RimWorld.FeedPatientUtility','p.needs.food.CurLevelPercentage <= p.needs.food.PercentageThreshHungry + 0.02f','Patient feeding starts around the hungry threshold.'),
 @('RimWorld.WorkGiver_Warden_Feed','pawn2.foodRestriction.GetCurrentRespectedRestriction(pawn)','Bedridden prisoner feeding consults the prisoner policy with the warden as getter.'),
 @('RimWorld.WorkGiver_Warden_Feed','JobMaker.MakeJob(JobDefOf.FeedPatient, foodSource, pawn2)','Prisoner bedside feeding uses the actual FeedPatient driver.'),
 @('RimWorld.WardenFeedUtility','if (!p.InBed())','Bedside prisoner feeding requires a bed.'),
 @('RimWorld.WardenFeedUtility','if (!p.Downed && !HealthAIUtility.ShouldSeekMedicalRest(p))','Downed or medically resting prisoners qualify for bedside feeding.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','if (!pawn2.Position.IsInPrisonCell(pawn2.Map))','Ordinary delivery requires a prison cell.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','FoodUtility.TryFindBestFoodSourceFor(pawn, pawn2','Prisoner delivery searches with the prisoner as eater.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','if (FoodAvailableInRoomTo(pawn2))','Existing edible food in the room can suppress another delivery.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','p.WillEat(foodSource)','Food-available calculation checks prisoner self-eating without a player getter; policy exceptions therefore differ from delivery selection.'),
 @('RimWorld.Pawn_GuestTracker','interactionMode != PrisonerInteractionModeDefOf.Execution','Execution order suppresses ordinary food supply.'),
 @('RimWorld.Pawn_GuestTracker','return pawn.Downed;','A release order allows bringing food only while the prisoner is downed in this property.'),
 @('RimWorld.JobDriver_Ingest','pawn.Reserve(ingestibleSource, job, 10, maxAmountToPickup','Self-eating reserves a quantity of the actual food stack.'),
 @('RimWorld.JobDriver_Ingest','Toils_Misc.TakeItemFromInventoryToCarrier','Inventory food physically moves into the carrier before ingestion.'),
 @('RimWorld.JobDriver_Ingest','Toils_Ingest.PickupIngestible(TargetIndex.A, pawn)','Self-eating physically picks up food when applicable.'),
 @('RimWorld.JobDriver_Ingest','if (!pawn.Drafted)','Drafted pawns skip carrying food to a normal dining spot; this is not a policy exemption.'),
 @('RimWorld.JobDriver_Ingest','Toils_Ingest.FinalizeIngest(pawn, TargetIndex.A)','The eating job finalizes actual consumption.'),
 @('RimWorld.JobDriver_FoodFeedPatient','pawn.Reserve(Deliveree, job, 1','Feeding reserves the actual patient.'),
 @('RimWorld.JobDriver_FoodFeedPatient','Toils_Ingest.PickupIngestible(TargetIndex.A, Deliveree)','The feeder picks up food sized for the patient.'),
 @('RimWorld.JobDriver_FoodFeedPatient','Toils_Ingest.ChewIngestible(Deliveree, 1.5f, TargetIndex.A)','The patient receives nutrition through a real feeding delay.'),
 @('RimWorld.JobDriver_FoodFeedPatient','Toils_Ingest.FinalizeIngest(Deliveree, TargetIndex.A)','Feeding finalizes consumption on the patient, not the doctor.'),
 @('RimWorld.JobDriver_FoodDeliver','pawn.carryTracker.TryDropCarriedThing','Delivery physically drops the carried food in the prisoner room.'),
 @('RimWorld.Toils_Ingest','float num2 = thing.Ingested(ingester, num);','Finalization consumes the real item through Thing.Ingested.'),
 @('RimWorld.Toils_Ingest','ingester.needs.food.CurLevel += num2;','Actual returned nutrition increases the eater food need.'),
 @('Verse.Thing','numTaken = Mathf.CeilToInt(nutritionWanted / num);','Actual ingestion amount computation uses ceiling, distinct from pickup-count rounding.'),
 @('Verse.Thing','SplitOff(numTaken);','Consumption splits the used portion from a larger physical stack.'),
 @('RimWorld.FloatMenuOptionProvider_Ingest','protected override bool Drafted => true;','Manual consume menu is available while drafted.'),
 @('RimWorld.FloatMenuOptionProvider_Ingest','clickedThing.SetForbidden(value: false);','Accepted manual consumption clears the selected item forbidden flag.'),
 @('RimWorld.FloatMenuOptionProvider_Ingest','context.FirstSelectedPawn.jobs.TryTakeOrderedJob(job, JobTag.Misc);','Manual consumption creates an ordered ingest job.'),
 @('Verse.AI.Pawn_JobTracker','job.playerForced = true;','Taking an ordered job marks that actual job player-forced.'),
 @('Verse.AI.Pawn_JobTracker','if (pawn.Drafted || newJob.playerForced)','Starting a drafted or ordered job enables the shared forbidden override.'),
 @('Verse.AI.Pawn_JobTracker','newJob.ignoreForbidden = true;','The started ordered job carries ignoreForbidden.'),
 @('Verse.AI.ToilFailConditions','if (actor.jobs.curJob.ignoreForbidden)','The shared forbidden fail condition allows an ordered job to continue before cell/item forbidden checks.'),
 @('Verse.AI.ToilFailConditions','cell.IsForbidden(actor)','Without override, the same fail condition checks the target cell and therefore its allowed area.'),
 @('Verse.AI.ToilFailConditions','f.FailOnForbidden(ind);','Combined despawn/null/forbidden helpers delegate to the override-aware forbidden gate.'),
 @('RimWorld.ForbidUtility','if (!c.InAllowedArea(pawn))','Forbidden target cells incorporate allowed-area membership.'),
 @('RimWorld.Pawn_PlayerSettings','pawn.jobs.curJob.AnyTargetOutsideArea(value)','Changing an active nonempty area can interrupt an existing job with an outside target.'),
 @('Verse.PathUtility','Area area = pawn.playerSettings.EffectiveAreaRestrictionInPawnCurrentMap;','Path area selection is a separate query from an ordered job target exception.'),
 @('RimWorld.ForbidUtility','if (!bypassDraftedCheck && pawn.Drafted)','Drafted status affects forbidden checks separately from the food policy tracker.'),
 @('Verse.ThingFilter','return allowedDefs.Contains(def);','Definition allowance is membership, not recursive ingredient allowance.'),
 @('Verse.ThingFilter','disallowedSpecialFilters[i].Worker.Matches(t)','Instance filters can inspect special properties, including meal ingredients via specialized workers.'),
 @('RimWorld.CompIngredients','public List<ThingDef> ingredients = new List<ThingDef>();','Meals retain ingredient definition provenance.'),
 @('RimWorld.CompIngredients','Scribe_Collections.Look(ref ingredients, "ingredients", LookMode.Def);','Ingredient provenance persists.'),
 @('RimWorld.CompIngredients','compIngredients.ingredients.Add(ingredients[i]);','Splitting copies ingredient provenance to the physical split piece.'),
 @('RimWorld.FoodUtility','if (GetFoodKind(compIngredients.ingredients[i]) == FoodKind.Meat)','Any meat ingredient classifies the instance as meat.'),
 @('RimWorld.FoodUtility','if (compIngredients.ingredients[i].IsAnimalProduct)','Milk or eggs affect dietary classification separately from meat.'),
 @('RimWorld.FoodUtility','if (!def.IsProcessedFood)','Processed foods have special dietary acceptability behavior; do not equate cooking with this definition flag.'),
 @('RimWorld.SpecialThingFilterWorker_Cannibal','FoodUtility.IsHumanlikeCorpseOrHumanlikeMeatOrIngredient(t)','Cannibal special filtering considers human-meat ingredients.'),
 @('RimWorld.SpecialThingFilterWorker_InsectMeat','FoodUtility.IsInsectCorpseOrInsectMeatIngredient(t)','Insect special filtering considers insect-meat ingredients.'),
 @('RimWorld.SpecialThingFilterWorker_Carnivore','!FoodUtility.AcceptableVegetarian(t) && FoodUtility.AcceptableCarnivore(t)','Carnivore special filtering uses dietary instance classification.'),
 @('RimWorld.Dialog_ManageFoodPolicies','forceHideHitPointsConfig: true','Food manager hides hit-point range configuration.'),
 @('RimWorld.Dialog_ManageFoodPolicies','yield return SpecialThingFilterDefOf.AllowFresh;','Freshness exclusion is hidden in the native manager.'),
 @('RimWorld.PawnColumnWorker_FoodRestriction','pawn.foodRestriction.CurrentFoodPolicy = foodRestriction;','The assignment table edits a shared policy reference.')
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
 (Bounded 'RimWorld.Pawn_FoodRestrictionTracker' 'public FoodPolicy GetCurrentRespectedRestriction' 'public bool BabyFoodAllowed' @('Starving','CurCategory','Drafted','NutritionWanted') @('Configurable','pawn.Faction != Faction.OfPlayer','getter.Faction != Faction.OfPlayer','pawn.InMentalState','return CurrentFoodPolicy') 'There is no starvation or drafted override in the respected-policy method; mental state and player getter exceptions are explicit.'),
 (Bounded 'RimWorld.Pawn_FoodRestrictionTracker' 'public FoodPolicy CurrentFoodPolicy' 'public bool Configurable' @('EndCurrentJob','Notify','WillEat') @('curPolicy = value','DefaultFoodRestriction') 'Assigning a policy does not directly interrupt food jobs in this setter.'),
 (Bounded 'RimWorld.FoodPolicy' 'public class FoodPolicy' '' @('ingredients','settingsChangedCallback','EndCurrentJob') @('filter.Allows(thing)','CopyAllowancesFrom') 'Policy itself delegates filters; it does not recursively check all ingredient defs or wire an interruption callback.'),
 (Bounded 'Verse.ThingFilter' 'public virtual bool Allows(Thing t)' 'public bool Allows(SpecialThingFilterDef sf)' @('CompIngredients','ingredients','WillEat') @('Allows(t.def)','disallowedSpecialFilters[i].Worker.Matches(t)','allowedDefs.Contains(def)') 'Ordinary filter checks final def plus special item-state filters, not every ingredient against allowedDefs.'),
 (Bounded 'RimWorld.FoodUtility' 'public static Thing BestFoodInInventory' 'public static int GetMaxAmountToPickup' @('IsInAnyStorage','IsForbidden','CanReserve') @('eater.WillEat(thing, holder','thing.IngestibleNow') 'Inventory eligibility retains eater policy; this method has no ground storage, forbidden or reservation gate.'),
 (Bounded 'RimWorld.FoodUtility' 'public static Thing BestFoodSourceOnMap' 'private static int GetMaxRegionsToScan' @('IsInAnyStorage','GetSlotGroup','IsBurning') @('else if (desperate)','eater.WillEat(t, getter','(!desperate && t.IsNotFresh())','getter.CanReserve','TraverseParms.For(getter)') 'Desperation lowers preference/freshness gates while retaining policy, reservations and traversal; ground food need not be stored. No direct burning gate in this method.'),
 (Bounded 'RimWorld.FloatMenuOptionProvider_Ingest' 'protected override FloatMenuOption GetSingleOptionFor' '' @('CurrentFoodPolicy','GetCurrentRespectedRestriction','WillEat(','filter.Allows','IsForbidden(','InAllowedArea(') @('FoodIsSuitable','CanReach','SetForbidden(value: false)','TryTakeOrderedJob') 'Manual ingest provider does not reject an allowed-area or policy mismatch, while species suitability and physical access still apply.'),
 (Bounded 'Verse.AI.ToilFailConditions' 'public static T FailOnForbidden<T>' 'public static T FailOnDespawnedNullOrForbidden<T>' @('playerForced') @('actor.jobs.curJob.ignoreForbidden','return JobCondition.Ongoing','cell.IsForbidden(actor)','thing.IsForbidden(actor)') 'Forbidden failure reads the actual job ignoreForbidden flag; StartJob maps playerForced to this flag. The early return precedes area and item rejection.'),
 (Bounded 'Verse.PathUtility' 'public static Area GetAllowedArea(Pawn pawn)' 'public static bool IsDestroyable' @('playerForced','ignoreForbidden') @('!pawn.Drafted','CaresAboutForbidden','EffectiveAreaRestrictionInPawnCurrentMap') 'An undrafted ordered job does not disable this separate path-area query; target permission is not proof of removing all area path preference.'),
 (Bounded 'RimWorld.Pawn_PlayerSettings' 'public Area AreaRestrictionInPawnCurrentMap' 'public bool RespectsAllowedArea' @('playerForced','ignoreForbidden') @('!pawn.Drafted','value.TrueCount > 0','AnyTargetOutsideArea(value)','EndCurrentJob(JobCondition.InterruptForced)') 'Reassigning a nonempty effective area can interrupt an undrafted outside-target job even if the old job was ordered.'),
 (Bounded 'RimWorld.JobDriver_Ingest' 'protected override IEnumerable<Toil> MakeNewToils' 'private IEnumerable<Toil> PrepareToIngestToils(' @('CurrentFoodPolicy','GetCurrentRespectedRestriction','WillEat(','filter.Allows') @('IngestibleNow','ChewIngestible','FinalizeIngest') 'The active eating driver checks food validity but does not re-read policy here.'),
 (Bounded 'RimWorld.JobDriver_FoodFeedPatient' 'protected override IEnumerable<Toil> MakeNewToils' '' @('CurrentFoodPolicy','GetCurrentRespectedRestriction','WillEat(','filter.Allows') @('ShouldBeFedBySomeone','PickupIngestible','ChewIngestible(Deliveree','FinalizeIngest(Deliveree') 'The active bedside-feeding job rechecks patient eligibility but not policy in this method.'),
 (Bounded 'RimWorld.JobDriver_FoodDeliver' 'protected override IEnumerable<Toil> MakeNewToils' '' @('CurrentFoodPolicy','GetCurrentRespectedRestriction','WillEat(','filter.Allows','Ingested(') @('ReserveFoodFromStackForIngesting','PickupIngestible','CanBeBroughtFood','TryDropCarriedThing') 'Delivery moves and drops food; it does not directly feed nutrition or re-read the food policy in this method.'),
 (Bounded 'RimWorld.Toils_Ingest' 'public static Toil FinalizeIngest' '' @('CurrentFoodPolicy','GetCurrentRespectedRestriction','WillEat(','filter.Allows') @('thing.Ingested(ingester, num)','ingester.needs.food.CurLevel += num2') 'The final ingest toil consumes the actual item and credits nutrition without a direct policy check.'),
 (Bounded 'Verse.Thing' 'public float Ingested(Pawn ingester, float nutritionWanted)' 'protected virtual void PrePostIngested' @('CurrentFoodPolicy','GetCurrentRespectedRestriction','WillEat(','filter.Allows') @('if (!IngestibleNow)','IngestedCalculateAmounts','SplitOff(numTaken)','return nutritionIngested') 'The base consumption method checks physical ingestibility and returns actual nutrition, without directly rechecking policy; component hooks remain separate.'),
 (Bounded 'RimWorld.FoodRestrictionDatabase' 'public AcceptanceReport TryDelete' 'public FoodPolicy MakeNewFoodRestriction' @('Destroy(','EndCurrentJob','foodRestrictions.Count == 1') @('FoodRestrictionInUse','CurrentFoodPolicy = null','foodRestrictions.Remove(foodPolicy)') 'Deletion handles references; rejecting deletion of the final unassigned policy would be a Web adaptation, not this native method.'),
 (Bounded 'RimWorld.WorkGiver_Warden_DeliverFood' 'private static bool FoodAvailableInRoomTo' '' @('GetCurrentRespectedRestriction','CurrentFoodPolicy') @('NutritionAvailableForFrom','p.WillEat(foodSource)') 'Existing-food sufficiency uses the prisoner self-eating context, distinct from warden delivery policy enforcement.')
)
$xmlCache=@{}
function XmlDoc([string]$relative){if(!$xmlCache.ContainsKey($relative)){$xmlCache[$relative]=[xml][IO.File]::ReadAllText((Join-Path $GameRoot $relative))};$xmlCache[$relative]}
$foodFields=@('statBases/Nutrition','ingestible','thingCategories','socialPropernessMatters','comps','ingredient','stackLimit')
$specs=@(
 @('Data/Core/Defs/ThingDefs_Items/Items_Food.xml','/Defs/ThingDef[@Name="MealBaseIngredientless"]',$foodFields,'Meal base has nutrition-related handling, forbiddable, social properness and a one-item ingestion cap.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Food.xml','/Defs/ThingDef[defName="MealSimple"]',$foodFields,'Simple meal final definition and parent linkage.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Food.xml','/Defs/ThingDef[defName="MealFine"]',$foodFields,'Fine meal adds retained ingredient provenance.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Food.xml','/Defs/ThingDef[defName="MealLavish"]',$foodFields,'Lavish meal uses its own preferability and inherited component state.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Food.xml','/Defs/ThingDef[defName="MealSurvivalPack"]',$foodFields,'Survival pack is a separate final def explicitly excluded by Simple preset.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Food.xml','/Defs/ThingDef[defName="MealNutrientPaste"]',$foodFields,'Nutrient paste is separately filterable and may be produced by a dispenser.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_RawPlant.xml','/Defs/ThingDef[defName="RawRice"]',$foodFields,'Rice retains the raw plant-food parent policy/preference context.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[defName="Milk"]',$foodFields,'Milk is raw-tasty animal product; dietary animal product is not equivalent to meat.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[defName="EggChickenUnfertilized"]',$foodFields,'Chicken eggs have inherited raw-product nutrition and food flags.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[defName="InsectJelly"]',$foodFields,'Insect jelly has explicit preset exceptions.'),
 @('Data/Core/Defs/Misc/SpecialThingFilterDefs/SpecialThingFilters.xml','/Defs/SpecialThingFilterDef[defName="AllowFresh"]',@('parentCategory','allowedByDefault','workerClass'),'Fresh filter is Core-packaged but hidden by the food-policy UI.'),
 @('Data/Core/Defs/Misc/SpecialThingFilterDefs/SpecialThingFilters.xml','/Defs/SpecialThingFilterDef[defName="AllowRotten"]',@('parentCategory','allowedByDefault','workerClass'),'Rot permission is separate from desperate search and ingestibility.'),
 @('Data/Core/Defs/JobDefs/Jobs_Work.xml','/Defs/JobDef[defName="DeliverFood"]',@('driverClass','reportString','allowOpportunisticPrefix'),'Prisoner delivery maps to JobDriver_FoodDeliver, not an instantaneous feeding action.'),
 @('Data/Core/Defs/WorkGiverDefs/WorkGivers.xml','/Defs/WorkGiverDef[defName="FeedPrisoner"]',@('giverClass','workType','priorityInType','requiredCapacities'),'Bedside prisoner feeding is warden work.'),
 @('Data/Core/Defs/WorkGiverDefs/WorkGivers.xml','/Defs/WorkGiverDef[defName="DeliverFoodToPrisoner"]',@('giverClass','workType','priorityInType','requiredCapacities'),'Prisoner delivery is separate warden work.'),
 @('Data/Core/Defs/ThinkTreeDefs/Humanlike.xml','/Defs/ThinkTreeDef[defName="Humanlike"]',@('.//li[@Class="JobGiver_GetFood"]'),'Humanlike think-tree has explicit hunger work entries; projected nodes retain local settings.')
)
$defs=@(foreach($spec in $specs){
 $doc=XmlDoc $spec[0];$nodes=@($doc.SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected XML node count: $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash (Join-Path $GameRoot $spec[0]);xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
$foodFiles=@('Data/Core/Defs/ThingDefs_Items/Items_Food.xml','Data/Core/Defs/ThingDefs_Items/Items_Resource_RawPlant.xml','Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','Data/Core/Defs/ThingDefs_Items/Items_Resource_Base.xml')
$profiles=@(foreach($name in @('MealSimple','MealFine','MealLavish','MealSurvivalPack','MealNutrientPaste','RawRice','Milk','EggChickenUnfertilized')){
 $chain=@();$xpath='/Defs/ThingDef[defName="'+$name+'"]';$depth=0;$nutrition=$null;$preference=$null;$foodType=$null
 do{
  $found=@(foreach($rel in $foodFiles){foreach($n in (XmlDoc $rel).SelectNodes($xpath)){[pscustomobject]@{file=$rel;node=$n}}})
  if($found.Count -ne 1){throw "Unexpected parent chain match: $name $xpath"}
  $node=$found[0].node
  if($null -eq $nutrition -and $node.SelectSingleNode('statBases/Nutrition')){$nutrition=[double]$node.SelectSingleNode('statBases/Nutrition').InnerText}
  if($null -eq $preference -and $node.SelectSingleNode('ingestible/preferability')){$preference=$node.SelectSingleNode('ingestible/preferability').InnerText}
  if($null -eq $foodType -and $node.SelectSingleNode('ingestible/foodType')){$foodType=$node.SelectSingleNode('ingestible/foodType').InnerText}
  $fields=@(foreach($field in $foodFields){[ordered]@{xpath=$field;xml=@($node.SelectNodes($field)|ForEach-Object OuterXml)}})
  $chain+=,[ordered]@{file=$found[0].file;sha256=Hash (Join-Path $GameRoot $found[0].file);xpath=$xpath;parentName=$node.GetAttribute('ParentName');fields=$fields}
  $parent=$node.GetAttribute('ParentName');$xpath='/Defs/ThingDef[@Name="'+$parent+'"]';$depth++;if($depth -gt 15){throw 'Unexpected food parent cycle'}
 }while($parent)
 if($null -eq $nutrition -or $null -eq $preference -or $null -eq $foodType){throw "Incomplete selected scalar inheritance: $name"}
 [ordered]@{def=$name;selectedInheritedScalars=[ordered]@{nutrition=$nutrition;preferability=$preference;foodType=$foodType};chain=$chain}
})
$packageDirs=@(Get-ChildItem -LiteralPath (Join-Path $GameRoot 'Data') -Directory | Sort-Object Name | ForEach-Object Name)
$record=[ordered]@{
 evidence_id='RW17-FOOD-POLICIES-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile)
 rules=$records;boundedChecks=$bounded;packagedXml=$defs;definitionProfiles=$profiles;localDataDirectories=$packageDirs
 nativeReference=[ordered]@{
  basePresetLabels=@('Lavish','Fine','Simple','Paste','Raw','Nothing');defaultPreset='first database entry, initially Lavish'
  ideologyPresets=@('Vegetarian','Carnivore','Cannibal','Insect meat');policyScope='humanlike player or player-hosted eater; nonplayer eater requires player getter'
  mentalEaterIgnoresPolicy=$true;starvationOverridesPolicy=$false;draftedOverridesPolicyInTracker=$false
  prisonerSelfEatingRespectsColonyPolicy=$false;playerWardenSupplyRespectsPrisonerPolicy=$true;patientFeedingUsesEaterPolicy=$true;inventoryUsesEaterPolicy=$true
  automaticCandidateRequiresStorage=$false;emptyPolicyPreventsOrdinaryFeeding=$true;manualOrderedIngestConsultsPolicy=$false
  manualOrderedIngestBypassesForbiddenTargetGate=$true;manualOrderDisablesSeparatePathAreaQuery=$false;areaReassignmentHasExplicitPlayerForcedExemption=$false
  selectedDriverMethodsDirectlyRecheckPolicy=$false;ordinaryDefFilterRecursivelyChecksIngredients=$false
  mealDietarySpecialFiltersInspectIngredients=$true;patientFeedDurationMultiplier=1.5;patientHungerThresholdOffset=.02
  omnivoreWantEat=.3;omnivoreHungry=.24;omnivoreUrgentlyHungry=.12;inventoryPreferSoonRottingWithinTicks=30000;inventoryComparisonPenalty=32;foodScoreBase=300;corpseMalnutritionThreshold=.4
 }
 webDesignChoices=@('Prioritize shared food policy, candidate filtering, real fetching/eating/feeding and persistence before balancing hunger or score weights.','Keep food policy on the eater; use getter only for physical access and relevant faction exceptions.','Do not silently ignore an empty policy because the pawn is starving.','Food-policy permissions are distinct from ingredient filters used by cooking bills and from stockpile storage filters.','If adding recursive ingredient restrictions or diet presets, retain real meal provenance and label the feature separately from final-kind permissions.','Cancellation or reselection of an in-progress eating/feeding job after a policy edit is a Web consistency adaptation beyond the observed native driver checks.','The Web manualFoodOrder is a one-job override; accepting it only for actionable pawns with food below 100 is a Web guard against zero-consumption or invalid work, not the native menu rule.','Blocking deletion of the last unassigned policy and bounding the count are Web UI/persistence choices.','Mapping old Web saves to an all-allowed default preserves existing food permissions; this is not a native migration rule.','Colony animals use species diet and physical feeding rules; ordinary human food policies are not animal feed policies.')
 limits=@('Static derived C# and packaged Core XML are not original source or runtime interaction proof.','REA metadata is reused only for the exact same assembly identity; hashed ILSpy types support the recorded method claims.','No game, browser, preview, GUI input or screenshot was launched.','XML inheritance projection resolves only named scalar fields across complete selected Core parent chains; it is not a mod-patched effective Def database.','Installed Data directories do not establish enabled expansions; Ideology code in assembly does not prove its XML or runtime is available.','Bounded absence claims apply only to the recorded methods and tokens, not every caller, extension or runtime hook.','Native constants are reference values, not measured Web balance or complete behavioral parity.','Full derived C#, assemblies and game assets remain local and unpublished.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 35).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static food-policies projection differs'};"Checked food-policies: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) XML projections, $($profiles.Count) inherited profiles"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));"Collected food-policies: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) XML projections, $($profiles.Count) inherited profiles"}
