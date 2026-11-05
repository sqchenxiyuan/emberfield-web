param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static metadata/CIL and packaged XML only. No target execution or GUI.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/animal-training-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/animal-training-manifest.json'
$reaFile='docs/research/rimworld/evidence/animal-training-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$priorFiles=@('docs/research/rimworld/evidence/prison-food-manifest.json','docs/research/rimworld/evidence/live-animal-trade-manifest.json','docs/research/rimworld/evidence/animal-environment-manifest.json')
$priors=@(foreach($file in $priorFiles){$m=Get-Content (Join-Path $root $file) -Raw|ConvertFrom-Json;if($m.source_sha256 -ne $assemblyHash){throw "Prior identity mismatch: $file"};[ordered]@{file=$file;sha256=Hash (Join-Path $root $file);types=$m.types}})
$sources=@{}
$reused=@(foreach($m in $manifest.types){
 $file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)
 $matches=@(foreach($prior in $priors){foreach($p in @($prior.types|Where-Object type -eq $m.type)){if($p.sha256 -ne $m.sha256){throw "Previous type mismatch: $($m.type)"};[ordered]@{manifest=$prior.file;localFile=$p.local_file}}})
 if($matches.Count){[ordered]@{type=$m.type;sha256=$m.sha256;prior=$matches}}
})
$rules=@(
 @('RimWorld.Pawn_TrainingTracker','private DefMap<TrainableDef, bool> wantedTrainables','Wanted training is distinct from progress and learned capability.'),
 @('RimWorld.Pawn_TrainingTracker','private DefMap<TrainableDef, int> steps','Training retains an integer step counter per definition.'),
 @('RimWorld.Pawn_TrainingTracker','private DefMap<TrainableDef, bool> learned','Learned state is stored independently of progress.'),
 @('RimWorld.Pawn_TrainingTracker','Scribe_Values.Look(ref countDecayFrom','Decay timing persists across saves.'),
 @('RimWorld.Pawn_TrainingTracker','!HasLearned(prerequisites[i]) || CanBeTrained(prerequisites[i])','A prerequisite must be learned and fully replenished before further dependent training.'),
 @('RimWorld.Pawn_TrainingTracker','float num = pawn?.BodySize ?? pawnDef.race.baseBodySize;','Assignment uses the actual pawn body size, falling back to species size for definition-only queries.'),
 @('RimWorld.Pawn_TrainingTracker','if (num < td.minBodySize)','Small bodies cannot be assigned size-gated training.'),
 @('RimWorld.Pawn_TrainingTracker','steps[td]++;','One successful ordinary attempt adds one step.'),
 @('RimWorld.Pawn_TrainingTracker','learned[td] = true;','Reaching the required steps sets learned true.'),
 @('RimWorld.Pawn_TrainingTracker','pawn.playerSettings.Master = trainer;','Completing obedience assigns the trainer only when no master exists.'),
 @('RimWorld.Pawn_TrainingTracker','SetWantedRecursive(td.prerequisites[i], checkOn: true);','Enabling a wanted skill recursively enables prerequisite training.'),
 @('RimWorld.Pawn_TrainingTracker','SetWantedRecursive(item, checkOn: false);','Disabling a wanted prerequisite recursively disables wanted dependent skills.'),
 @('RimWorld.Pawn_TrainingTracker','countDecayFrom += 250;','Suspended or unspawned animals preserve remaining decay time in rare-tick increments.'),
 @('RimWorld.Pawn_TrainingTracker','else if (steps[TrainableDefOf.Tameness] == 0)','No tameness progress resets the decay baseline to the current tick.'),
 @('RimWorld.Pawn_TrainingTracker','pawn.RaceProps.animalType == AnimalType.Dryad','Dryads are excluded from this decay route.'),
 @('RimWorld.Pawn_TrainingTracker','select kvp.Key).Except(steps.Where','Decay excludes prerequisites of skills that still have progress, selecting from leaves.'),
 @('RimWorld.Pawn_TrainingTracker','trainableDef == TrainableDefOf.Tameness && !TrainableUtility.TamenessCanDecay(pawn)','Selecting non-decaying tameness consumes the decay opportunity without losing a step.'),
 @('RimWorld.Pawn_TrainingTracker','if (steps[trainableDef] > 0 || !learned[trainableDef])','Learned capability survives partial decay and is revoked only at zero steps.'),
 @('RimWorld.Pawn_TrainingTracker','pawn.SetFaction(null);','Losing learned tameness returns a player animal to the wild.'),
 @('RimWorld.TrainableUtility','OrderByDescending((TrainableDef td) => td.listPriority)','Training selection follows descending definition priority.'),
 @('RimWorld.TrainableUtility','new CurvePoint(0f, 12f)','Wildness zero corresponds to twelve days between decay opportunities.'),
 @('RimWorld.TrainableUtility','new CurvePoint(1f, 6f)','Wildness one corresponds to six days between decay opportunities.'),
 @('RimWorld.TrainableUtility','return pawn.GetStatValue(StatDefOf.Wildness, applyPostProcess: true, 1) > 0.101f;','Tameness can decay only above the wildness threshold, after the fence-blocked exception.'),
 @('RimWorld.TrainableUtility','animal.mindState.lastAssignedInteractTime + 15000','Training attempts are limited by a fifteen-thousand-tick assigned-interaction interval.'),
 @('RimWorld.TrainableUtility','master.IsPrisoner','A prisoner cannot be selected as an animal master through this helper.'),
 @('RimWorld.TrainableUtility','master.relations.DirectRelationExists(PawnRelationDefOf.Bond, animal)','A bond bypasses the ordinary master handling-skill threshold.'),
 @('RimWorld.WorkGiver_Train','if (pawn2.Faction != pawn.Faction)','Training work requires the same faction as the handler.'),
 @('RimWorld.WorkGiver_Train','pawn2.training.NextTrainableToTrain() == null','No remaining wanted trainable means no training job.'),
 @('RimWorld.WorkGiver_Train','TakeFoodForAnimalInteractJob(pawn, pawn2)','An unprepared handler first gets physical food into inventory.'),
 @('RimWorld.WorkGiver_Train','JobMaker.MakeJob(JobDefOf.Train, t)','Training schedules an interaction job rather than granting capability directly.'),
 @('RimWorld.WorkGiver_InteractAnimal','if (!pawn.CanReserve(animal, 1, -1, null, forced))','Only one handler reserves an animal at a time.'),
 @('RimWorld.WorkGiver_InteractAnimal','if (animal.Downed)','Downed animals cannot be trained by this interaction path.'),
 @('RimWorld.WorkGiver_InteractAnimal','if (!animal.Awake() && !canInteractWhileSleeping)','Ordinary training rejects sleeping animals.'),
 @('RimWorld.WorkGiver_InteractAnimal','!animal.CanCasuallyInteractNow','Busy animals can reject casual training interaction.'),
 @('RimWorld.WorkGiver_InteractAnimal','!tamee.WillEat(thing, pawn) || (int)thing.def.ingestible.preferability > 5 || thing.def.IsDrug','Prepared inventory food must be edible by the animal, no better than RawTasty, and not a drug.'),
 @('RimWorld.WorkGiver_InteractAnimal','if (num >= 2)','Inventory preparation requires enough for two feed portions.'),
 @('RimWorld.WorkGiver_InteractAnimal','allowPlant: false, allowDrug: false, allowCorpse: false','Map food gathering excludes standing plants, drugs and corpses.'),
 @('RimWorld.WorkGiver_InteractAnimal','JobDriver_InteractAnimal.RequiredNutritionPerFeed(tamee) * 2f * 4f','Food-gathering requests enough for four two-feed interactions.'),
 @('RimWorld.JobDriver_Train','item.FailOn(noLongerTrainable);','The interaction is invalidated if no wanted trainable remains.'),
 @('RimWorld.JobDriver_Train','yield return Toils_Interpersonal.TryTrain(TargetIndex.A);','Training success is attempted only after the inherited physical interaction sequence.'),
 @('RimWorld.JobDriver_InteractAnimal','Scribe_Values.Look(ref feedNutritionLeft','Outstanding feed nutrition survives save/load.'),
 @('RimWorld.JobDriver_InteractAnimal','return Mathf.Min(animal.needs.food.MaxLevel * 0.15f, 0.3f);','Each of two feed phases targets fifteen percent of food capacity, capped at 0.3 nutrition.'),
 @('RimWorld.JobDriver_InteractAnimal','yield return Toils_Ingest.FinalizeIngest(Animal, TargetIndex.B);','Food is actually ingested by the animal before training success is rolled.'),
 @('RimWorld.JobDriver_InteractAnimal','yield return Toils_General.PutCarriedThingInInventory();','Unused carried food is returned to inventory after feeding.'),
 @('RimWorld.JobDriver_InteractAnimal','actor.inventory.innerContainer.Take(thing, Mathf.Min(num, stackCount))','Feeding physically splits available inventory stock.'),
 @('RimWorld.JobDriver_InteractAnimal','ticksLeftThisToil = Mathf.CeilToInt(270f *','Feeding delay scales with the supplied nutrition portion.'),
 @('RimWorld.Toils_Interpersonal','pawn.mindState.lastAssignedInteractTime = Find.TickManager.TicksGame;','The interaction timestamp is updated before the final training success roll.'),
 @('RimWorld.Toils_Interpersonal','actor.GetStatValue(StatDefOf.TrainAnimalChance)','Training success starts with the handler training-chance stat.'),
 @('RimWorld.Toils_Interpersonal','GenMath.LerpDouble(0f, 1f, 1.5f, 0.5f, pawn.GetStatValue(StatDefOf.Wildness))','Wildness scales the chance from 1.5 at zero to 0.5 at one.'),
 @('RimWorld.Toils_Interpersonal','statValue *= 5f;','The bonded handler multiplier is five.'),
 @('RimWorld.Toils_Interpersonal','statValue = Mathf.Clamp01(statValue);','The final training probability is clamped between zero and one.'),
 @('RimWorld.Toils_Interpersonal','pawn.training.Train(trainableDef, actor);','Only a successful chance roll advances training.'),
 @('RimWorld.Toils_Interpersonal','"TextMote_TrainFail"','Failure is reported after food and interaction time have already been spent.'),
 @('RimWorld.Pawn_PlayerSettings','Scribe_References.Look(ref master, "master");','The animal master reference persists.'),
 @('RimWorld.Pawn_PlayerSettings','Scribe_Values.Look(ref followDrafted','Animal follow-drafted configuration persists.'),
 @('RimWorld.Pawn_PlayerSettings','Scribe_Values.Look(ref followFieldwork','Animal follow-fieldwork configuration persists.'),
 @('RimWorld.Pawn_PlayerSettings','Scribe_Values.Look(ref animalsReleased','The master pawn release-animals state persists.'),
 @('RimWorld.Pawn_PlayerSettings','value != null && !pawn.training.HasLearned(TrainableDefOf.Obedience)','A new master cannot be assigned before obedience is learned.'),
 @('RimWorld.Pawn_PlayerSettings','return Master.Faction == pawn.Faction;','An effective master must still share the player animal faction.'),
 @('RimWorld.Pawn_PlayerSettings','animalsReleased = !animalsReleased;','The master release control toggles group attack permission.'),
 @('RimWorld.Pawn_DraftController','pawn.playerSettings.animalsReleased = false;','Undrafting a master resets release permission.'),
 @('RimWorld.ThinkNode_ConditionalShouldFollowMaster','pawn.playerSettings.followDrafted && respectedMaster.Drafted','Drafted following requires the animal switch and a reachable drafted effective master.'),
 @('RimWorld.ThinkNode_ConditionalShouldFollowMaster','respectedMaster.mindState.lastJobTag == JobTag.Fieldwork','Fieldwork following checks the actual job tag, not every working master.'),
 @('RimWorld.ThinkNode_ConditionalShouldFollowMaster','carriedBy.HostileTo(respectedMaster)','A reachable hostile kidnapper carrying the master provides a special follow/defend route.'),
 @('RimWorld.JobGiver_AIFollowMaster','protected override int FollowJobExpireInterval => 200;','Master following periodically expires for reevaluation.'),
 @('RimWorld.JobGiver_AIFollowMaster','return 3f;','Ordinary following keeps within a three-cell radius.'),
 @('RimWorld.JobGiver_AIFollowMaster','return 50f;','Release-trained animals under a released master use a fifty-cell follow radius.'),
 @('RimWorld.JobGiver_AIFollowPawn','JobMaker.MakeJob(JobDefOf.FollowClose, followee)','Master following is an actual FollowClose movement job.'),
 @('Verse.AI.JobDriver_FollowClose','float radius = followRadius * 1.2f;','Following uses hysteresis so an animal does not continually restart at the exact boundary.'),
 @('Verse.AI.JobDriver_FollowClose','pawn.pather.StartPath(followee, PathEndMode.Touch);','The following animal actually paths toward the moving master.'),
 @('Verse.AI.JobDriver_FollowClose','pawn.IsHashIntervalTick(30, delta)','The active following path is periodically reconsidered.'),
 @('RimWorld.JobGiver_AIDefendMaster','return 5f;','Ordinary master defense uses a five-cell flag radius.'),
 @('RimWorld.JobGiver_AIDefendMaster','return 50f;','Released attack-trained animals defend across a fifty-cell radius.'),
 @('RimWorld.JobGiver_AIDefendPawn','attackMeleeThreatEvenIfNotHostile','Master defense may retaliate against a current melee threat even without a hostile faction relation.'),
 @('RimWorld.JobGiver_AIFightEnemy','JobMaker.MakeJob(JobDefOf.AttackMelee, enemyTarget)','The shared combat selector creates a physical melee job.'),
 @('RimWorld.JobGiver_AIFightEnemy','TargetScanFlags.NeedLOSToPawns | TargetScanFlags.NeedReachableIfCantHitFromMyPos | TargetScanFlags.NeedThreat | TargetScanFlags.NeedAutoTargetable','Normal automatic target selection considers sight, reachability and threat eligibility.'),
 @('Verse.AI.JobDriver_AttackMelee','pawn.meleeVerbs.TryMeleeAttack(thing, job.verbToUse)','The attack driver performs actual melee attacks, not just an attack label or follow animation.'),
 @('RimWorld.JobGiver_RescueNearby','HealthAIUtility.CanRescueNow(pawn, patient)','Rescue uses the shared patient eligibility checks.'),
 @('RimWorld.JobGiver_RescueNearby','RestUtility.FindBedFor(pawn2, pawn','A real compatible bed must be found for the patient.'),
 @('RimWorld.JobGiver_RescueNearby','JobMaker.MakeJob(JobDefOf.Rescue, pawn2, building_Bed)','Rescue creates a job targeting both patient and bed.'),
 @('RimWorld.HealthAIUtility','if (!forced && patient.Faction != rescuer.Faction)','Autonomous rescue requires the same faction.'),
 @('RimWorld.HealthAIUtility','GenAI.EnemyIsNear(patient, 25f)','Ordinary autonomous rescue rejects a patient near an enemy.'),
 @('RimWorld.HealthAIUtility','rescuer.CanReserveAndReach(patient, PathEndMode.OnCell, Danger.Deadly','Rescue requires reservation and reachability.'),
 @('RimWorld.JobDriver_TakeToBed','pawn.Reserve(DropBed, job, DropBed.SleepingSlotsCount, 0','Rescue reserves the bed sleeping capacity in addition to the patient.'),
 @('RimWorld.JobDriver_TakeToBed','Toil startCarrying = Toils_Haul.StartCarryThing(TargetIndex.A);','Rescue physically picks up the patient.'),
 @('RimWorld.JobDriver_TakeToBed','FailOn(() => !pawn.IsCarryingPawn(Takee))','The trip to bed must retain the same carried patient.'),
 @('RimWorld.JobDriver_TakeToBed','Toils_Bed.TuckIntoBed(DropBed, pawn, Takee, TakeeRescued)','The rescue ends by putting the patient into the real bed.'),
 @('RimWorld.JobDriver_TakeToBed','pawn.carryTracker.TryDropCarriedThing(pawn.Position, ThingPlaceMode.Direct','Interrupted take-to-bed work attempts to drop the carried entity.'),
 @('Verse.AI.ThinkNode_ChancePerHour','GetLastTryTick(pawn) + 2500','Probabilistic hauling opportunities are attempted no more than once per game hour.'),
 @('Verse.AI.ThinkNode_ChancePerHour','Rand.MTBEventOccurs(num, 2500f, 2500f)','MTB hours are a probability parameter, not a guaranteed fixed job interval.'),
 @('Verse.AI.ThinkNode_ChancePerHour','pawn.mindState.thinkData[UniqueSaveKey] = val;','Each chance node records its last attempt independently.'),
 @('RimWorld.JobGiver_Haul','pawn.Map.listerHaulables.ThingsPotentiallyNeedingHauling()','Animal hauling selects actual available haulable entities.'),
 @('RimWorld.JobGiver_Haul','pawn.carryTracker.MaxStackSpaceEver(t.def) <= 0','The animal must be able to carry the item type.'),
 @('RimWorld.JobGiver_Haul','StoreUtility.TryFindBestBetterStoreCellFor','Automatic hauling requires a storage cell with strictly better priority.'),
 @('Verse.AI.HaulAIUtility','!t.IsSociallyProper(p, forPrisoner: false, animalsCare: true)','Animals do not freely remove human food reserved for prison-room use.'),
 @('Verse.AI.JobDriver_HaulToCell','pawn.Reserve(job.GetTarget(TargetIndex.B), job, 1','Hauling reserves the actual destination cell.'),
 @('Verse.AI.JobDriver_HaulToCell','subtractNumTakenFromJobCount: true, failIfStackCountLessThanJobCount: false','Physical pickup can handle a smaller remaining source stack.'),
 @('Verse.AI.JobDriver_HaulToCell','Toils_Haul.PlaceHauledThingInCell(TargetIndex.B, carryToCell, storageMode: true)','Storage is completed by physical placement, not an inventory-total increment.'),
 @('Verse.Pawn_CarryTracker','pawn.GetStatValue(StatDefOf.CarryingCapacity) / td.VolumePerUnit','Native carrying uses carrying capacity divided by unit volume, further capped by stack limit.'),
 @('Verse.Pawn_CarryTracker','Thing thing = item.SplitOff(count);','Carried stock is split from an existing item.'),
 @('Verse.PawnGenerator','pawn.training.Train(TrainableDefOf.Tameness, null, complete: true);','Player-faction animal generation initializes tameness, not all work skills.'),
 @('Verse.Hediff_Pregnant','new PawnGenerationRequest(mother.kindDef, mother.Faction','Birth generates the same pawn kind in the mother faction.'),
 @('Verse.Pawn','training.Train(TrainableDefOf.Tameness, recruiter, complete: true);','Joining the player faction completes tameness.'),
 @('Verse.Pawn','item.playerSettings.Master = null;','Destroying a master removes references from alive mastered animals.'),
 @('Verse.Thing','Destroy(DestroyMode.KillFinalize);','The base Kill route invokes virtual destruction, reaching pawn master-reference cleanup.'),
 @('Verse.AI.Pawn_MindState','Scribe_Values.Look(ref lastAssignedInteractTime','Training interaction cooldown survives saves.'),
 @('Verse.AI.Pawn_MindState','Scribe_Collections.Look(ref thinkData','Probabilistic job attempt timing survives saves.'),
 @('RimWorld.FoodTypeFlags','OmnivoreAnimal = VegetarianAnimal | CarnivoreAnimalStrict','OmnivoreAnimal is an explicit food-mask union, without the Plant flag.'),
 @('RimWorld.FoodTypeFlags','OmnivoreRoughAnimal = OmnivoreAnimal | Plant','Grazing is a distinct added flag; the Labrador definition does not use it.'),
 @('RimWorld.StockGenerator_Animals','tradeTagsSell.Any((string x) => kind.race.tradeTags.Contains(x))','Trader generation requires a matching sell tag.'),
 @('RimWorld.StockGenerator_Animals','SeasonAndOutdoorTemperatureAcceptableFor','Trade generation can also filter species for the tile temperature.'),
 @('RimWorld.StatWorker_MinimumHandlingSkill','new CurvePoint(0f, 0f)','An ordinary zero-wildness Labrador has minimum handling skill zero.'),
 @('RimWorld.Need_Food','lifeStage.hungerRateFactor * pawnDef.race.baseHungerRate * 2.6666667E-05f','Species hunger is converted to per-tick nutrition before other hunger modifiers.'),
 @('RimWorld.StatPart_BodySize','val *= bodySize;','The body-size stat part multiplies base nutrition capacity.'),
 @('RimWorld.StatPart_LifeStageMaxFood','val *= pawn.ageTracker.CurLifeStage.foodMaxFactor;','The life-stage food factor is separate from current body size.'),
 @('RimWorld.LifeStageDef','public float foodMaxFactor = 1f;','Absent life-stage food capacity modifiers default to one.')
)
$records=@(foreach($r in $rules){
 $text=$sources[$r[0]];if(!$text){throw "Missing selected type $($r[0])"};$matches=@();$lines=$text.Split("`n")
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
 (Bounded 'RimWorld.Pawn_TrainingTracker' 'public bool HasLearned' 'public AcceptanceReport CanAssignToTrain' @('steps[','GetWanted') @('requiredTrainability','return learned[td];') 'Capability checks use learned state, not whether progress remains full or training remains wanted.'),
 (Bounded 'RimWorld.Pawn_TrainingTracker' 'public void Train(' 'public void SetWantedRecursive' @('countDecayFrom','TicksGame') @('steps[td]++','learned[td] = true','Master = trainer') 'Successful training does not restart the decay clock in this method.'),
 (Bounded 'RimWorld.Pawn_TrainingTracker' 'public void SetWantedRecursive' 'public void TrainingTrackerTickRare' @('learned[','steps[') @('SetWanted','td.prerequisites','checkOn: false') 'Changing the training wishlist does not erase learned capabilities or progress.'),
 (Bounded 'RimWorld.Pawn_TrainingTracker' 'public static AcceptanceReport CanAssignToTrain' 'public TrainableDef NextTrainableToTrain' @('CurLifeStage','Adult','DevelopmentalStage') @('pawn?.BodySize','minBodySize','requiredTrainability','untrainableTags') 'Assignment tests actual size and trainability rather than a blanket adulthood condition.'),
 (Bounded 'RimWorld.Pawn_TrainingTracker' 'public void TrainingTrackerTickRare' 'private static bool CanEverDoAttackTarget' @('Master = null','SetWantedRecursive') @('countDecayFrom += 250','Except(steps.Where','steps[trainableDef] > 0','learned[trainableDef] = false') 'Decay preserves wanted selections and does not directly erase the master reference; think-tree capability gates determine behavior.'),
 (Bounded 'RimWorld.WorkGiver_Train' 'public override Job JobOnThing' '' @('CanAssignToTrain','TrainableDefOf.Obedience','TrainableDefOf.Haul') @('NextTrainableToTrain','CanInteractWithAnimal','HasFoodToInteractAnimal','TrainedTooRecently') 'The work giver selects the next wanted skill and does not hard-code individual trainable branches or directly repeat assignment checks.'),
 (Bounded 'RimWorld.Toils_Interpersonal' 'public static Toil TryTrain' 'public static Toil Interact(' @('difficulty','Destroy(','FinalizeIngest','SetLastInteractTime') @('TrainAnimalChance','Wildness','Mathf.Clamp01','Rand.Value','TrainFail') 'The final success roll does not consume food again and does not use the TrainableDef difficulty field; earlier toils consumed food and set the cooldown.'),
 (Bounded 'RimWorld.JobGiver_RescueNearby' 'protected override Job TryGiveJob' '' @('Master','Chance','TrainedTooRecently') @('CanRescueNow','FindBedFor','JobDefOf.Rescue') 'Autonomous rescue has no master or periodic-chance requirement in this giver.'),
 (Bounded 'RimWorld.JobGiver_Haul' 'protected override Job TryGiveJob' '' @('Master','NextTrainableToTrain') @('ThingsPotentiallyNeedingHauling','HaulToStorageJob','TryFindBestBetterStoreCellFor') 'Animal hauling is autonomous; chance, capability and manipulation are upstream think-tree gates.'),
 (Bounded 'RimWorld.HealthAIUtility' 'public static bool CanRescueNow' 'public static Thing FindBestMedicine' @('Master','Haul','Rescue.steps') @('patient.Faction != rescuer.Faction','WantsToBeRescued','EnemyIsNear(patient, 25f)','CanReserveAndReach') 'Patient eligibility is independent of master selection and individual animal-training counters.'),
 (Bounded 'RimWorld.Pawn_PlayerSettings' 'public bool RespectsMaster' 'public Pawn RespectedMaster' @('HasLearned','followDrafted','Dead') @('Master == null','pawn.Faction == Faction.OfPlayer','Master.Faction == pawn.Faction') 'Effective master faction validity is separate from training gates and follow switches.'),
 (Bounded 'RimWorld.Pawn_PlayerSettings' 'public void Notify_FactionChanged' 'public void ResetMedicalCare' @('master = null','Master = null','animalsReleased = false','learned') @('ResetMedicalCare','allowedAreas.Clear') 'This faction-change callback clears area and medical settings but does not itself clear master or training.'),
 (Bounded 'Verse.Pawn' 'public override void PreTraded' 'public override void SetFaction' @('training = null','Master = null','learned[') @('TradeAction.PlayerBuys','TradeAction.PlayerSells','SetFaction(Faction.OfPlayer)','SetFaction(null)') 'Trade changes ownership through faction transitions; this bounded method does not erase training or explicitly null the master.'),
 (Bounded 'RimWorld.Pawn_TrainingTracker' 'private static bool CanEverDoAttackTarget' 'private static AcceptanceReport CanDoAttackTarget' @('TrainableDefOf.Release') @('ModsConfig.OdysseyActive','TrainableDefOf.AttackTarget') 'Odyssey direct target attacks are a distinct capability from Core Release.'),
 (Bounded 'RimWorld.ThinkNode_ConditionalCanDoConstantThinkTreeJobNow' 'protected override bool Satisfied' '' @('HasLearned','Master') @('pawn.Downed','pawn.IsBurning()','pawn.InMentalState','pawn.Drafted','pawn.Awake()') 'This node gates the constant tree, not the ordinary learned rescue and haul branches.'),
 (Bounded 'Verse.Hediff_Pregnant' 'public static void DoBirthSpawn' '' @('HasLearned','TrainableDefOf.Obedience','TrainableDefOf.Haul','playerSettings.Master','followDrafted') @('mother.kindDef, mother.Faction','PawnGenerator.GeneratePawn','AreaRestrictionInPawnCurrentMap') 'This birth path inherits species, faction and area, but does not copy parental training or master/follow settings.')
)
$xmlCache=@{}
function XmlDoc([string]$file){if(!$xmlCache.ContainsKey($file)){$xmlCache[$file]=[xml][IO.File]::ReadAllText((Join-Path $GameRoot $file))};return $xmlCache[$file]}
$specs=@(
 @('Data/Core/Defs/TrainableDefs/Trainables.xml','/Defs/TrainableDef[defName="Tameness"]',@('label','listPriority','difficulty','requiredTrainability','steps','prerequisites','minBodySize'),'Tameness is the first prerequisite and has five steps.'),
 @('Data/Core/Defs/TrainableDefs/Trainables.xml','/Defs/TrainableDef[defName="Obedience"]',@('label','listPriority','difficulty','requiredTrainability','steps','prerequisites','minBodySize'),'Guard/Obedience is intermediate and requires tameness.'),
 @('Data/Core/Defs/TrainableDefs/Trainables.xml','/Defs/TrainableDef[defName="Release"]',@('label','listPriority','difficulty','requiredTrainability','steps','prerequisites','minBodySize'),'Core attack training is intermediate and requires obedience.'),
 @('Data/Core/Defs/TrainableDefs/Trainables.xml','/Defs/TrainableDef[defName="Rescue"]',@('label','listPriority','difficulty','requiredTrainability','steps','prerequisites','minBodySize'),'Rescue is advanced, requires obedience and minimum body size 0.65.'),
 @('Data/Core/Defs/TrainableDefs/Trainables.xml','/Defs/TrainableDef[defName="Haul"]',@('label','description','listPriority','difficulty','requiredTrainability','steps','prerequisites','minBodySize'),'Haul is advanced, requires obedience and minimum body size 0.40; its description explicitly excludes direct specific-item commands.'),
 @('Data/Core/Defs/Misc/TrainabilityDefs/TrainabilityDefs.xml','/Defs/TrainabilityDef[defName="Advanced"]',@('label','intelligenceOrder'),'Advanced has intelligence order thirty.'),
 @('Data/Core/Defs/Misc/TrainabilityDefs/TrainabilityDefs.xml','/Defs/TrainabilityDef[defName="Intermediate"]',@('label','intelligenceOrder'),'Intermediate has intelligence order twenty.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_CatGroup.xml','/Defs/ThingDef[defName="LabradorRetriever"]',@('label','statBases','race/animalType','race/baseBodySize','race/baseHungerRate','race/baseHealthScale','race/foodType','race/trainability','race/lifeStageAges','tradeTags'),'The exact Core Labrador species is an advanced omnivore with no Plant food flag.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_CatGroup.xml','/Defs/PawnKindDef[defName="LabradorRetriever"]',@('label','race','combatPower','ecoSystemWeight'),'The same-named pawn kind points to the Labrador race.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml','/Defs/ThingDef[@Name="AnimalThingBase"]',@('race/thinkTreeMain','race/thinkTreeConstant','race/trainability','statBases','tradeability'),'Animal base defines ordinary and constant think trees; child definitions override trainability.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalBaby"]',@('bodySizeFactor','foodMaxFactor','hungerRateFactor','reproductive'),'Baby body and food factors are distinct.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalJuvenile"]',@('bodySizeFactor','foodMaxFactor','hungerRateFactor','reproductive'),'Juvenile size is half adult size.'),
 @('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalAdult"]',@('bodySizeFactor','foodMaxFactor','hungerRateFactor','reproductive'),'Missing adult factors use code defaults, not values invented by this XML projection.'),
 @('Data/Core/Defs/WorkGiverDefs/WorkGivers.xml','/Defs/WorkGiverDef[defName="Train"]',@('giverClass','workType','priorityInType','requiredCapacities'),'Animal training is Handling work with priority seventy.'),
 @('Data/Core/Defs/JobDefs/Jobs_Work.xml','/Defs/JobDef[defName="Train"]',@('driverClass','casualInterruptible','allowOpportunisticPrefix'),'Train maps to the full interact-animal driver.'),
 @('Data/Core/Defs/JobDefs/Jobs_Work.xml','/Defs/JobDef[defName="Rescue"]',@('driverClass','casualInterruptible','carryThingAfterJob','dropThingBeforeJob'),'Rescue maps to TakeToBed and explicitly retains carrying across transitions.'),
 @('Data/Core/Defs/JobDefs/Jobs_Work.xml','/Defs/JobDef[defName="HaulToCell"]',@('driverClass','suspendable','allowOpportunisticPrefix'),'Animal hauling uses the shared physical cell-hauling job.'),
 @('Data/Core/Defs/JobDefs/Jobs_Misc.xml','/Defs/JobDef[defName="FollowClose"]',@('driverClass','reportString','casualInterruptible'),'Master following uses FollowClose, not the similarly named Follow job.'),
 @('Data/Core/Defs/JobDefs/Jobs_Misc.xml','/Defs/JobDef[defName="AttackMelee"]',@('driverClass','casualInterruptible','alwaysShowWeapon'),'Released animals fight through the ordinary melee job.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_Social.xml','/Defs/StatDef[defName="TrainAnimalChance"]',@('defaultBaseValue','minValue','skillNeedFactors','capacityFactors'),'Training probability reflects Animals skill and Talking/Hearing/Manipulation.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_General.xml','/Defs/StatDef[defName="MinimumHandlingSkill"]',@('workerClass','defaultBaseValue','minValue','roundValue'),'Minimum handling is a derived stat, not the same as training success chance.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_General.xml','/Defs/StatDef[defName="MaxNutrition"]',@('defaultBaseValue','parts'),'Nutrition capacity includes body-size and life-stage factors.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_General.xml','/Defs/StatDef[defName="ComfyTemperatureMax"]',@('defaultBaseValue','parts'),'Forty degrees is the Core default before other modifiers.'),
 @('Data/Core/Defs/TraderKindDefs/TraderKinds_Caravan_Outlander.xml','/Defs/TraderKindDef[stockGenerators/li[@Class="StockGenerator_Animals"]/tradeTagsSell/li="AnimalPet"]',@('defName','label','stockGenerators/li[@Class="StockGenerator_Animals"]'),'This caravan trader can generate pet-tagged animals; temperature and random stock selection still apply.'),
 @('Data/Core/Defs/TraderKindDefs/TraderKinds_Base_Outlander.xml','/Defs/TraderKindDef[stockGenerators/li[@Class="StockGenerator_Animals"]/tradeTagsSell/li="AnimalPet"]',@('defName','label','stockGenerators/li[@Class="StockGenerator_Animals"]'),'This settlement trader provides another pet-tagged animal source.')
)
$defs=@(foreach($spec in $specs){
 $doc=XmlDoc $spec[0];$nodes=@($doc.SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected XML node count $($nodes.Count): $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash (Join-Path $GameRoot $spec[0]);xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
$animalXml='Data/Core/Defs/ThinkTreeDefs/Animal.xml'
$tree=(XmlDoc $animalXml).SelectSingleNode('/Defs/ThinkTreeDef[defName="Animal"]')
$behaviorPaths=@(foreach($name in @('JobGiver_AIDefendMaster','JobGiver_AIFollowMaster','JobGiver_RescueNearby','JobGiver_Haul')){
 $nodes=@($tree.SelectNodes(".//li[@Class='$name']"));if($nodes.Count -ne 1){throw "Unexpected animal behavior node count: $name"}
 $node=$nodes[0];$anc=@();$p=$node.ParentNode
 while($p -and $p -ne $tree){if($p.Attributes['Class']){$fields=@{};foreach($f in @('trainable','tagToGive','mtbHours','requiredCapacities')){if($p.SelectSingleNode($f)){$fields[$f]=$p.SelectSingleNode($f).OuterXml}};$anc+=,[ordered]@{class=$p.GetAttribute('Class');fields=$fields}};$p=$p.ParentNode}
 if(@($anc|Where-Object class -eq 'ThinkNode_ConditionalCanDoConstantThinkTreeJobNow').Count){throw 'Ordinary behavior was incorrectly attributed to the constant-tree guard'}
 [ordered]@{class=$name;node=$node.OuterXml;ancestorsNearestFirst=$anc;siblingsInOrder=@($node.ParentNode.SelectNodes('li')|ForEach-Object {$_.GetAttribute('Class')})}
})
$constant=(XmlDoc $animalXml).SelectSingleNode('/Defs/ThinkTreeDef[defName="AnimalConstant"]//li[@Class="ThinkNode_ConditionalCanDoConstantThinkTreeJobNow"]')
if(!$constant){throw 'Missing constant-tree guard'}
$record=[ordered]@{
 evidence_id='RW17-ANIMAL-TRAINING-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile)
 priorManifests=@($priors|ForEach-Object {[ordered]@{file=$_.file;sha256=$_.sha256}});matchingPriorTypes=$reused
 rules=$records;boundedChecks=$bounded;packagedXml=$defs
 animalThinkTree=[ordered]@{file=$animalXml;sha256=Hash (Join-Path $GameRoot $animalXml);ordinaryBehaviorPaths=$behaviorPaths;constantGuard=$constant.OuterXml}
 nativeReference=[ordered]@{
  species='LabradorRetriever';trainability='Advanced';bodySize=.75;wildness=0;minimumHandlingSkill=0;baseHungerRate=.4;baseHealthScale=1;moveSpeed=5
  foodType=@('OmnivoreAnimal','OvivoreAnimal');grazesPlants=$false;comfortableMin=-30;comfortableMaxCoreDefault=40
  trainables=@([ordered]@{def='Tameness';steps=5;prerequisite=$null},[ordered]@{def='Obedience';steps=3;prerequisite='Tameness'},[ordered]@{def='Release';steps=2;prerequisite='Obedience'},[ordered]@{def='Rescue';steps=2;prerequisite='Obedience';minBodySize=.65},[ordered]@{def='Haul';steps=7;prerequisite='Obedience';minBodySize=.4})
  learnedLostOnlyAtZero=$true;trainingResetsDecayClock=$false;wishlistChangeDeletesLearned=$false;minimumAttemptIntervalTicks=15000
  labradorDecayPeriodTicks=720000;labradorTamenessDecays=$false;feedCount=2;feedFraction=.15;feedNutritionCap=.3;talkDurationTicks=270;feedBaseDurationTicks=270
  rescueNeedsMaster=$false;rescueRadius=75;rescueEnemyExclusionRadius=25;rescueHasChanceGate=$false
  haulNeedsMaster=$false;haulMtbHours=1.5;haulMinimumChanceAttemptTicks=2500
  normalFollowRadius=3;releasedFollowRadius=50;normalDefendRadius=5;releasedDefendRadius=50;followJobExpiryTicks=200
  directAttackTargetIsSeparateOdysseyCapability=$true;playerAnimalGenerationCompletesTameness=$true;playerAnimalGenerationCompletesAllFourWorkSkills=$false
 }
 webDesignChoices=@('Implement real handler preparation, walking, feeding and chance-based training before balance tuning.','Keep wanted, steps and learned independent; cancelling future training must not erase existing skills.','A deterministic scheduling approximation for native random hauling must be stated as a Web adaptation.','Follow/attack depend on a valid effective master, while autonomous rescue and hauling must remain possible without one.','Use actual carried item entities and bidirectional carried-patient ownership; interrupted tasks and saves must not clone or delete contents.','Revalidate current faction, health, skill, paths, targets and reservations during Web tasks; this can be stricter than individual native drivers.','Core Release is group attack permission around the master, not the Odyssey direct-target attack ability.','Restricting training food to Web-supported raw food is an explicit content adaptation, not an original raw-grain-only rule.','Clearing stale master IDs immediately after sale or invalid assignments is a Web cleanup policy; the bounded native trade method changes faction without directly erasing the reference.','No native gameplay, browser interaction, GPU or natural colony-campaign acceptance is claimed by this static collector.')
 limits=@('Derived C# is reconstruction of this exact installed assembly, not original source.','XML projections are selected packaged Core fields, not a fully inherited or mod-patched effective Def database.','Missing tokens establish only the named bounded method/type absence.','Original numerical values are reference data; no instruction to retune Web balance.','Full decompiled types, assemblies, models and game assets remain local and unpublished.','REA metadata inspection and ILSpy reconstruction did not load or execute game code; no game, browser, preview or GUI was launched.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 45).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static animal-training projection differs'};"Checked animal-training: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) XML projections, $($reused.Count) matched prior types"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));"Collected animal-training: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) XML projections, $($reused.Count) matched prior types"}
