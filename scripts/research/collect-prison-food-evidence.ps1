param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static packaged evidence only. Never execute target code or launch game/browser/GUI.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/prison-food-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/prison-food-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$foodManifestFile='docs/research/rimworld/evidence/food-policies-manifest.json'
$foodMechanismFile='docs/research/rimworld/evidence/food-policies-mechanisms.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$foodManifest=Get-Content (Join-Path $root $foodManifestFile) -Raw|ConvertFrom-Json
$foodMechanism=Get-Content (Join-Path $root $foodMechanismFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256 -or $assemblyHash -ne $foodManifest.source_sha256 -or $assemblyHash -ne $foodMechanism.assemblySha256){throw 'Static identity mismatch'}
$sources=@{}
$reused=@(foreach($m in $manifest.types){
 $file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)
 $prior=@($foodManifest.types|Where-Object type -eq $m.type)
 if($prior.Count){if($prior.Count -ne 1 -or $prior[0].sha256 -ne $m.sha256){throw "Previous derived type mismatch: $($m.type)"};[ordered]@{type=$m.type;priorFile=$prior[0].local_file;sha256=$m.sha256}}
})
$rules=@(
 @('RimWorld.WorkGiver_Warden','pawn.Map.mapPawns.SlavesAndPrisonersOfColonySpawned','The general warden scanner visits actual spawned prisoners/slaves.'),
 @('RimWorld.WorkGiver_Warden','!pawn.guest.PrisonerIsSecure','A prisoner must be secure for ordinary care.'),
 @('RimWorld.WorkGiver_Warden','!pawn.Spawned || pawn.InAggroMentalState','Unspawned or aggressively mentally broken prisoners are not ordinary supply targets.'),
 @('RimWorld.WorkGiver_Warden','prisoner.IsForbidden(warden)','The warden must be allowed to interact with the prisoner.'),
 @('RimWorld.WorkGiver_Warden','!warden.CanReserveAndReach(pawn, PathEndMode.OnCell, warden.NormalMaxDanger(), 1','Selection needs an actual reachable and exclusively reservable prisoner.'),
 @('RimWorld.Pawn_GuestTracker','if (Released)','Release status makes a prisoner insecure in the security property.'),
 @('RimWorld.Pawn_GuestTracker','if (pawn.HostFaction == null)','A secure prisoner needs a host faction.'),
 @('RimWorld.Pawn_GuestTracker','if (PrisonBreakUtility.IsPrisonBreaking(pawn))','An active prison break makes the spawned prisoner insecure.'),
 @('RimWorld.Pawn_GuestTracker','interactionMode != PrisonerInteractionModeDefOf.Execution','Execution mode disables food supply.'),
 @('RimWorld.Pawn_GuestTracker','interactionMode == PrisonerInteractionModeDefOf.Release','Release mode has a special supply condition.'),
 @('RimWorld.Pawn_GuestTracker','return pawn.Downed;','Release mode allows food delivery only to a downed prisoner in this property.'),
 @('RimWorld.ITab_Pawn_Prisoner','public class ITab_Pawn_Prisoner : ITab_Pawn_Visitor','Actual prisoner tab implementation inherits the visitor tab.'),
 @('RimWorld.ITab_Pawn_Visitor','DoPrisonerTab(wildMan, listing_Standard);','The inherited visitor tab builds prisoner controls.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','if (!pawn2.guest.CanBeBroughtFood)','Delivery requires the guest supply-state permission.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','if (!pawn2.Position.IsInPrisonCell(pawn2.Map))','Ordinary delivery requires the prisoner to be in a prison cell.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','pawn2.needs.food.CurLevelPercentage >= pawn2.needs.food.PercentageThreshHungry + 0.02f','Delivery starts strictly below the hungry threshold plus two percentage points.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','if (WardenFeedUtility.ShouldBeFed(pawn2))','Bedside-fed prisoners are excluded from ordinary floor delivery.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','canUseInventory: true, canUsePackAnimalInventory: false','The warden may supply its own inventory but not pack-animal inventory through this giver.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','calculateWantedStackCount: true','Candidate reservation checks consider the prisoner desired quantity.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','if (foodSource.GetRoom() == pawn2.GetRoom())','If the selected food is already in the prisoner room, no delivery job is created.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','if (FoodAvailableInRoomTo(pawn2))','Existing room food can suppress a new delivery.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','JobMaker.MakeJob(JobDefOf.DeliverFood, foodSource, pawn2)','Delivery is a job with real food and prisoner targets.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','FoodUtility.WillIngestStackCountOf(pawn2, foodDef, nutrition)','Requested amount uses the prisoner nutritional deficit.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','RCellFinder.SpotToChewStandingNear(pawn2, foodSource)','Delivery destination is computed near the prisoner, using prisoner room and access context.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','NutritionAvailableForFrom(prisoner, prisoner.carryTracker.CarriedThing) > 0f','Any positive edible nutrition already in the target prisoner hands suppresses more supply.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','List<Region> regions = room.Regions;','The sufficiency calculation scans the whole room through its regions.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','ThingRequestGroup.FoodSourceNotPlantOrTree','Existing planted crops are not counted as room food here.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','!thing.def.IsIngestible || (int)thing.def.ingestible.preferability > 3','The room-food count excludes the lowest-preference ordinary ingestibles, while still considering dispenser-like sources.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','num += pawn.needs.food.NutritionWanted;','Demand sums hungry prisoners in the shared room, excluding those carrying food they will eat.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','if (num2 + 0.5f >= num)','Existing room food gets a half-nutrition tolerance when compared against total hungry demand.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','foodSource.def.IsNutritionGivingIngestible && p.WillEat(foodSource)','Room availability uses prisoner self-eating context, without a player getter.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','foodSource.GetStatValue(StatDefOf.Nutrition) * (float)foodSource.stackCount','Available ordinary nutrition is stat times actual stack count.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','p.CanReach(building_NutrientPasteDispenser.InteractionCell, PathEndMode.OnCell, Danger.Some)','An available nutrient-paste dispenser must be reachable by the prisoner.'),
 @('RimWorld.WorkGiver_Warden_DeliverFood','return 99999f;','An operable reachable paste dispenser acts as ample room supply in this estimate.'),
 @('RimWorld.WardenFeedUtility','if (!p.IsPrisonerOfColony)','Bedside warden feeding is specific to colony prisoners.'),
 @('RimWorld.WardenFeedUtility','if (!p.InBed())','Bedside feeding requires a bed.'),
 @('RimWorld.WardenFeedUtility','if (!p.Downed && !HealthAIUtility.ShouldSeekMedicalRest(p))','Downed or medically resting prisoners qualify.'),
 @('RimWorld.WorkGiver_Warden_Feed','currentRespectedRestriction.filter.AllowedDefCount == 0','An empty respected food policy prevents bedside feeding.'),
 @('RimWorld.WorkGiver_Warden_Feed','pawn2.foodRestriction.GetCurrentRespectedRestriction(pawn)','Bedside feeding respects the prisoner policy with the warden as getter.'),
 @('RimWorld.WorkGiver_Warden_Feed','JobMaker.MakeJob(JobDefOf.FeedPatient, foodSource, pawn2)','Bedside prisoner feeding creates a FeedPatient job instead of floor delivery.'),
 @('RimWorld.WorkGiver_FeedPatient','WardenFeedUtility.ShouldBeFed(pawn2) && !pawn.IsColonyMech','Ordinary patient-feeding work yields to the warden branch, except for colony mechs.'),
 @('RimWorld.FoodUtility','eater.WillEat(thing, holder, careIfNotAcceptableForTitle: true, allowVenerated)','Inventory food is filtered for the actual eater with its holder as getter.'),
 @('RimWorld.FoodUtility','!eater.WillEat(t, getter, careIfNotAcceptableForTitle: true, allowVenerated)','Ground food is filtered for the prisoner eater and supplying warden.'),
 @('RimWorld.Pawn_FoodRestrictionTracker','pawn.Faction != Faction.OfPlayer && (getter == null || getter.Faction != Faction.OfPlayer)','Non-player prisoner self-eating ignores the colony food policy; player supply enforces it.'),
 @('RimWorld.Pawn_FoodRestrictionTracker','if (pawn.InMentalState)','An eater in a mental state does not respect its ordinary food policy.'),
 @('RimWorld.FoodUtility','t.IsSociallyProper(eater, eater.IsPrisonerOfColony, animalsCare)','Food selection also considers eater social room rights.'),
 @('RimWorld.SocialProperness','return intVec.GetRoom(t.Map) == p.GetRoom();','Prisoner social properness restricts relevant spawned food to the same room.'),
 @('RimWorld.SocialProperness','return !intVec.IsInPrisonCell(t.Map);','Non-prisoner social properness normally excludes food in prison cells.'),
 @('RimWorld.SocialProperness','if (!t.def.socialPropernessMatters)','Only objects marked to care about social properness use these room restrictions.'),
 @('RimWorld.RCellFinder','return SpotToStandDuringJob(pawn, Validator);','Prisoner delivery delegates standing-cell search to a real location solver.'),
 @('RimWorld.RCellFinder','Toils_Ingest.TryFindAdjacentIngestionPlaceSpot(c, ingestible.def, pawn','The normal standing location must support a nearby eating place.'),
 @('RimWorld.RCellFinder','pawn.HostFaction != null && c.GetRoom(pawn.Map) != pawn.GetRoom()','Normal destination validation keeps hosted pawns within their current room.'),
 @('RimWorld.RCellFinder','GenPlace.HaulPlaceBlockerIn(null, c, pawn.Map, checkBlueprintsAndFrames: false)','Non-desperate standing candidates avoid drop-placement blockers.'),
 @('RimWorld.RCellFinder','c.ContainsStaticFire(pawn.Map) || c.ContainsTrap(pawn.Map)','Normal region candidate validation rejects static fire and traps even in desperate mode.'),
 @('RimWorld.RCellFinder','pawn.Map.pawnDestinationReservationManager.CanReserve(c, pawn)','Location search considers destination reservations for the prisoner.'),
 @('RimWorld.RCellFinder','float maxDistance = 4f;','Standing search begins near the pawn.'),
 @('RimWorld.RCellFinder','maxDistance = 15f;','Later search stages expand distance.'),
 @('RimWorld.RCellFinder','return region.RandomCell;','The final fallback is a random cell of the original region and is weaker than the regular candidate checks.'),
 @('Verse.Room','if (Building_Bed.RoomCanBePrisonCell(this))','A room must qualify physically before prisoner beds mark it as a prison cell.'),
 @('Verse.Room','containedAndAdjacentThings[i] is Building_Bed { ForPrisoners: not false }','Prison-cell status is derived from actual prisoner beds in or beside the room.'),
 @('Verse.Room','isPrisonCell = true;','Prison status is cached and recalculated with room shape.'),
 @('RimWorld.Building_Bed','if (r.ProperRoom)','A candidate prison room must be a proper room.'),
 @('RimWorld.Building_Bed','return !r.IsHuge;','Huge rooms are excluded by the native prisoner-bed room qualification.'),
 @('RimWorld.JobDriver_FoodDeliver','pawn.Reserve(Deliveree, job, 1, -1, null, errorOnFailed)','The delivery job reserves the actual prisoner exclusively before its toils.'),
 @('RimWorld.JobDriver_FoodDeliver','Scribe_Values.Look(ref eatingFromInventory, "eatingFromInventory"','The selected inventory path persists in the job driver.'),
 @('RimWorld.JobDriver_FoodDeliver','Scribe_Values.Look(ref usingNutrientPasteDispenser, "usingNutrientPasteDispenser"','The dispenser path persists separately.'),
 @('RimWorld.JobDriver_FoodDeliver','this.FailOnDespawnedOrNull(TargetIndex.B);','A disappearing prisoner invalidates delivery.'),
 @('RimWorld.JobDriver_FoodDeliver','Toils_Misc.TakeItemFromInventoryToCarrier(pawn, TargetIndex.A)','Inventory supply transfers physical food to the carrying container.'),
 @('RimWorld.JobDriver_FoodDeliver','Toils_Ingest.ReserveFoodFromStackForIngesting(TargetIndex.A, Deliveree)','Ground supply reserves actual food portions after the initial prisoner reservation.'),
 @('RimWorld.JobDriver_FoodDeliver','Toils_Ingest.PickupIngestible(TargetIndex.A, Deliveree)','The warden actually picks up food.'),
 @('RimWorld.JobDriver_FoodDeliver','actor.pather.StartPath(curJob.targetC, PathEndMode.OnCell)','The warden walks to the stored destination cell.'),
 @('RimWorld.JobDriver_FoodDeliver','!base.pawn.IsCarryingThing(job.GetTarget(TargetIndex.A).Thing)','The delivery leg fails if the selected physical food is no longer being carried.'),
 @('RimWorld.JobDriver_FoodDeliver','if (!pawn.IsPrisonerOfColony)','Loss of prisoner status invalidates the delivery leg.'),
 @('RimWorld.JobDriver_FoodDeliver','return !pawn.guest.CanBeBroughtFood;','Guest supply permission is rechecked during the delivery leg.'),
 @('RimWorld.JobDriver_FoodDeliver','pawn.carryTracker.TryDropCarriedThing(toil2.actor.jobs.curJob.targetC.Cell, ThingPlaceMode.Direct, out var _);','At the destination the warden attempts physical placement; this is not ingestion.'),
 @('RimWorld.Toils_Misc','int count = Mathf.Min(thing.stackCount, curJob.count);','Inventory transfer is limited by actual stock and requested amount.'),
 @('RimWorld.Toils_Misc','TryTransferToContainer(thing, pawn.carryTracker.innerContainer, count)','The same physical inventory food moves into the carrying container.'),
 @('RimWorld.Toils_Ingest','int b = FoodUtility.WillIngestStackCountOf(ingester','Ground food reservation recalculates an eater-based amount.'),
 @('RimWorld.Toils_Ingest','num = Mathf.Min(target.Thing.stackCount, b);','Ground reservation amount is limited to the actual remaining stack.'),
 @('RimWorld.Toils_Ingest','!toil.actor.CanReserve(target, 10, num)','Food stacks support multiple distinct reservations only when quantity allows.'),
 @('RimWorld.Toils_Ingest','toil.actor.Reserve(target, toil.actor.CurJob, 10, num);','The food portion reservation belongs to the actual job.'),
 @('RimWorld.Toils_Ingest','int count = Mathf.Min(thing.stackCount, curJob.count);','Actual pickup limits the original job count to what remains.'),
 @('RimWorld.Toils_Ingest','actor.carryTracker.TryStartCarry(thing, count);','Pickup is a physical transfer/split.'),
 @('RimWorld.Toils_Ingest','actor.jobs.curJob.targetA = actor.carryTracker.CarriedThing;','After splitting, the job target follows the carried entity.'),
 @('Verse.Pawn_CarryTracker','count = Mathf.Min(count, AvailableStackSpace(item.def));','Carrying capacity further caps actual pickup.'),
 @('Verse.Pawn_CarryTracker','Thing thing = item.SplitOff(count);','Pickup creates a split only from existing stock.'),
 @('Verse.Pawn_CarryTracker','Scribe_Deep.Look(ref innerContainer, "innerContainer", this);','Actual carried contents persist.'),
 @('Verse.Pawn_CarryTracker','innerContainer.TryDrop(CarriedThing, dropLoc, pawn.MapHeld, mode','Dropping delegates actual placement from the carrying container.'),
 @('Verse.ThingOwner','if (GenDrop.TryDropSpawn(thing, dropLoc, map, mode, out lastResultingThing','Dropping a full carried stack removes it from the container only after real placement succeeds.'),
 @('Verse.AI.ReservationManager','if (reservation.MaxPawns != maxPawns)','Different reservation modes can conflict even when quantities seem sufficient.'),
 @('Verse.AI.ReservationManager','num2 + num4 > num','Aggregate claimed quantity cannot exceed the current stack.'),
 @('Verse.AI.ReservationManager','map.physicalInteractionReservationManager.IsReserved(target)','Physical interaction reservations also exclude competing use.'),
 @('RimWorld.JobDriver_FoodFeedPatient','pawn.Reserve(Deliveree, job, 1','Bedside feeding also locks the patient.'),
 @('RimWorld.JobDriver_FoodFeedPatient','FoodUtility.GetMaxAmountToPickup(Food, pawn, job.count)','Bedside-food pre-reservation limits to what is available after other reservations.'),
 @('RimWorld.JobDriver_FoodFeedPatient','this.FailOn(() => !FoodUtility.ShouldBeFedBySomeone(Deliveree));','Bedside feeding rechecks whether the patient still needs someone to feed them.'),
 @('RimWorld.JobDriver_FoodFeedPatient','Toils_Ingest.ChewIngestible(Deliveree, 1.5f','Bedside feeding has a physical feeding delay on the prisoner.'),
 @('RimWorld.JobDriver_FoodFeedPatient','Toils_Ingest.FinalizeIngest(Deliveree, TargetIndex.A)','Only bedside consumption finalizes ingestion and nutrition for the patient.'),
 @('Verse.AI.Pawn_JobTracker','pawn.ClearReservationsForJob(curJob);','Ordinary job cleanup releases job reservations.'),
 @('Verse.AI.Pawn_JobTracker','carryThingAfterJobOverride ?? job.def.carryThingAfterJob','Post-job carrying depends on an explicit override or the job definition.'),
 @('Verse.AI.Pawn_JobTracker','pawn.carryTracker.TryDropCarriedThing(pawn.Position, ThingPlaceMode.Near, out var _);','Ordinary cleanup attempts a real nearby drop rather than deleting carried food.'),
 @('RimWorld.JobGiver_GetFood','(int)pawn.needs.food.CurCategory < 3 && FoodUtility.ShouldBeFedBySomeone(pawn)','A patient normally defers self-feeding while not starving; starvation removes this specific priority suppression.'),
 @('RimWorld.JobGiver_GetFood','FoodUtility.TryFindBestFoodSourceFor(pawn, pawn, desperate','Prisoner self-feeding uses the same getter/eater hunger job as other humanoids.'),
 @('RimWorld.JobDriver_Ingest','Toils_Ingest.FinalizeIngest(pawn, TargetIndex.A)','A delivered ration must later be consumed through an ingest job to grant nutrition.')
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
 (Bounded 'RimWorld.Pawn_GuestTracker' 'public class Pawn_GuestTracker' '' @('allowFood','AllowFood','getsFood','GetsFood') @('CanBeBroughtFood','PrisonerInteractionModeDefOf.Execution','PrisonerInteractionModeDefOf.Release') 'The installed guest tracker has no field/property with these food-toggle names; supply permission is mode-derived.'),
 (Bounded 'RimWorld.ITab_Pawn_Visitor' 'public abstract class ITab_Pawn_Visitor' '' @('allowFood','AllowFood','CanBeBroughtFood','foodRestriction','FoodRestriction','FoodPolicy') @('DoPrisonerTab','SetExclusiveInteraction') 'The inherited prisoner tab does not expose a food permission or food-policy control through these tokens; no global UI absence claim.'),
 (Bounded 'RimWorld.PrisonerInteractionModeDef' 'public class PrisonerInteractionModeDef' '' @('allowFood','AllowFood','CanBeBroughtFood') @('mustBeAwake','isNonExclusiveInteraction') 'The local prisoner interaction definition class has no separate food-supply toggle.'),
 (Bounded 'RimWorld.Pawn_GuestTracker' 'public bool CanBeBroughtFood' 'public bool IsPrisoner' @('foodRestriction','CanReserve','Nutrition','allowFood') @('Execution','Release','pawn.Downed') 'Supply permission is distinct from nutrition, policies and physical eligibility.'),
 (Bounded 'RimWorld.WorkGiver_Warden_DeliverFood' 'public override Job JobOnThing' 'private static bool FoodAvailableInRoomTo' @('CurLevel +=','FinalizeIngest','foodSource.Destroy') @('ShouldTakeCareOfPrisoner','CanBeBroughtFood','IsInPrisonCell','WardenFeedUtility.ShouldBeFed','foodSource.GetRoom() == pawn2.GetRoom()','FoodAvailableInRoomTo','SpotToChewStandingNear') 'The giver selects a physical supply task after room and hunger checks; it does not feed nutrition immediately.'),
 (Bounded 'RimWorld.WorkGiver_Warden_DeliverFood' 'private static bool FoodAvailableInRoomTo' '' @('IngestibleNow','IsForbidden','CanReserve','IsNotFresh','CurrentFoodPolicy','GetCurrentRespectedRestriction') @('NutritionAvailableForFrom','NutritionWanted','num2 + 0.5f >= num','p.WillEat(foodSource)','p.CanReach(building_NutrientPasteDispenser') 'Room sufficiency is an approximate count. It lacks ordinary food freshness, reservation and path checks; only dispenser access is checked directly here.'),
 (Bounded 'RimWorld.JobDriver_FoodDeliver' 'public override bool TryMakePreToilReservations' 'protected override IEnumerable<Toil> MakeNewToils' @('Reserve(Food','TargetThingA','targetC') @('pawn.Reserve(Deliveree, job, 1') 'Initial reservation locks the prisoner only; food is reserved later and this method does not lock the landing cell.'),
 (Bounded 'RimWorld.JobDriver_FoodDeliver' 'protected override IEnumerable<Toil> MakeNewToils' '' @('FinalizeIngest','Ingested(','CurLevel','GetCurrentRespectedRestriction','FoodAvailableInRoomTo','GetRoom()','IsInPrisonCell','WardenFeedUtility.ShouldBeFed') @('ReserveFoodFromStackForIngesting','StartPath(curJob.targetC','IsCarryingThing','IsPrisonerOfColony','CanBeBroughtFood','TryDropCarriedThing') 'Active delivery validates disappearance, carrying, prisoner status and supply permission, but does not directly re-evaluate policy, hunger, room topology, room quantity or bedside eligibility.'),
 (Bounded 'RimWorld.JobDriver_FoodFeedPatient' 'protected override IEnumerable<Toil> MakeNewToils' '' @('FoodAvailableInRoomTo','GetCurrentRespectedRestriction','CurrentFoodPolicy') @('ShouldBeFedBySomeone','ChewIngestible(Deliveree','FinalizeIngest(Deliveree') 'Bedside feeding checks medical eligibility and actually ingests on the patient; it does not use room-supply suppression or re-read food policy here.'),
 (Bounded 'RimWorld.Toils_Ingest' 'public static Toil ReserveFoodFromStackForIngesting' 'public static bool TryFindAdjacentIngestionPlaceSpot' @('curJob.count =','targetC') @('WillIngestStackCountOf','Mathf.Min(target.Thing.stackCount, b)','CanReserve(target, 10, num)','Reserve(target, toil.actor.CurJob, 10, num)') 'Food reservation recalculates quantity but does not replace the job original count in this method.'),
 (Bounded 'RimWorld.Toils_Ingest' 'public static Toil PickupIngestible' 'public static Toil CarryIngestibleToChewSpot' @('WillIngestStackCountOf','NutritionWanted','ReserveFoodFromStackForIngesting') @('Mathf.Min(thing.stackCount, curJob.count)','TryStartCarry','targetA = actor.carryTracker.CarriedThing') 'Pickup uses actual stock and the original job count, then points targetA at the carried split.'),
 (Bounded 'RimWorld.RCellFinder' 'public static IntVec3 SpotToStandDuringJobInRegion' 'public static IntVec3 SpotToStandDuringJob(Pawn' @('curJob.targetC') @('c.GetRoom(pawn.Map) != pawn.GetRoom()','if (!desperate)','ContainsStaticFire','ContainsTrap','pawnDestinationReservationManager.CanReserve') 'Regular location validation uses the prisoner current room and excludes hazards; it does not track an already-issued delivery destination.'),
 (Bounded 'RimWorld.RCellFinder' 'public static IntVec3 SpotToStandDuringJob(Pawn' 'public static bool TryFindMarriageSite' @('prisoner','JobDefOf.DeliverFood') @('for (int i = 0; i < 30; i++)','SpotToStandDuringJobInRegion','IntVec3 randomCell = region.RandomCell','extraValidator(randomCell)','return region.RandomCell') 'Generic staged search has a weaker final random-region fallback, including separately sampled validation and returned cells.'),
 (Bounded 'RimWorld.Pawn_FoodRestrictionTracker' 'public FoodPolicy GetCurrentRespectedRestriction' 'public bool BabyFoodAllowed' @('Starving','allowFood','CanBeBroughtFood') @('pawn.Faction != Faction.OfPlayer','getter.Faction != Faction.OfPlayer','pawn.InMentalState') 'Prisoner self-eating policy exception is independent of permission for wardens to supply food.'),
 (Bounded 'RimWorld.SocialProperness' 'public static bool IsSociallyProper(this Thing t, Pawn p, bool' 'public static bool BloodfeedingPrisonerInRoom' @('foodRestriction','CanBeBroughtFood') @('socialPropernessMatters','if (!t.Spawned)','if (forPrisoner)','intVec.GetRoom(t.Map) == p.GetRoom()') 'Social room ownership is independent of the colony food policy and supply-state switch.'),
 (Bounded 'Verse.AI.Pawn_JobTracker' 'private void CleanupCurrentJob' 'public JobQueue CaptureAndClearJobQueue' @('DestroyCarriedThing','ClearAndDestroyContents') @('ClearReservationsForJob','carryThingAfterJobOverride','TryDropCarriedThing') 'Job cleanup releases claims and attempts a physical drop unless configured to keep carrying; it does not normally delete held food.')
 (Bounded 'Verse.ThingOwner' 'public bool TryDrop(Thing thing, IntVec3 dropLoc, Map map, ThingPlaceMode mode, out Thing lastResultingThing' 'public bool TryDropAll' @('Destroy(') @('if (GenDrop.TryDropSpawn','Remove(thing)','return false') 'Failed physical placement retains the carried stack; container removal occurs only inside the successful drop branch.')
)
$xmlCache=@{}
function XmlDoc([string]$relative){if(!$xmlCache.ContainsKey($relative)){$xmlCache[$relative]=[xml][IO.File]::ReadAllText((Join-Path $GameRoot $relative))};$xmlCache[$relative]}
$specs=@(
 @('Data/Core/Defs/WorkGiverDefs/WorkGivers.xml','/Defs/WorkGiverDef[defName="FeedPrisoner"]',@('giverClass','workType','priorityInType','requiredCapacities'),'Bedside feeding is warden work with priority eighty.'),
 @('Data/Core/Defs/WorkGiverDefs/WorkGivers.xml','/Defs/WorkGiverDef[defName="DeliverFoodToPrisoner"]',@('giverClass','workType','priorityInType','requiredCapacities'),'Floor delivery is separate warden work with priority seventy.'),
 @('Data/Core/Defs/JobDefs/Jobs_Work.xml','/Defs/JobDef[defName="FeedPatient"]',@('driverClass','reportString','allowOpportunisticPrefix','carryThingAfterJob'),'Bedside job maps to FoodFeedPatient.'),
 @('Data/Core/Defs/JobDefs/Jobs_Work.xml','/Defs/JobDef[defName="DeliverFood"]',@('driverClass','reportString','allowOpportunisticPrefix','carryThingAfterJob'),'Delivery job maps to FoodDeliver.'),
 @('Data/Core/Defs/JobDefs/Jobs_Misc.xml','/Defs/JobDef[defName="Ingest"]',@('driverClass','reportString','casualInterruptible','carryThingAfterJob'),'Self-eating remains a separate Ingest job.'),
 @('Data/Core/Defs/Misc/PrisonerInteractionModeDefs/PrisonerInteractionMode.xml','/Defs/PrisonerInteractionModeDef[defName="MaintainOnly"]',@('label','description','listOrder'),'Maintain-only explicitly includes feeding and basic needs, not no care.'),
 @('Data/Core/Defs/Misc/PrisonerInteractionModeDefs/PrisonerInteractionMode.xml','/Defs/PrisonerInteractionModeDef[defName="Release"]',@('label','description','listOrder'),'Release is an interaction mode read by supply permission.'),
 @('Data/Core/Defs/Misc/PrisonerInteractionModeDefs/PrisonerInteractionMode.xml','/Defs/PrisonerInteractionModeDef[defName="Execution"]',@('label','description','listOrder','mustBeAwake'),'Execution is an interaction mode read by supply permission.'),
 @('Data/Core/Defs/ThinkTreeDefs/Humanlike.xml','/Defs/ThinkTreeDef[defName="Humanlike"]//li[@Class="ThinkNode_ConditionalPrisoner"]',@('leaveJoinableLordIfIssuesJob','subNodes/li'),'The prisoner branch includes medical rest before needs, a priority-sorted GetFood and current-room wandering.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Food.xml','/Defs/ThingDef[@Name="MealBaseIngredientless"]',@('socialPropernessMatters','ingestible','stackLimit'),'Meal base participates in social room ownership and caps ordinary ingestion to one meal.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_RawPlant.xml','/Defs/ThingDef[@Name="PlantFoodRawBase"]',@('socialPropernessMatters','statBases/Nutrition','ingestible'),'Raw plant foods also participate in prison-room social ownership.'),
 @('Data/Core/Defs/ThingDefs_Items/Items_Resource_AnimalProduct.xml','/Defs/ThingDef[defName="Milk"]',@('socialPropernessMatters','statBases/Nutrition','ingestible'),'Milk has social ownership and a smaller per-unit nutrition value than meals.')
)
$defs=@(foreach($spec in $specs){
 $doc=XmlDoc $spec[0];$nodes=@($doc.SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected XML node count: $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash (Join-Path $GameRoot $spec[0]);xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
$tree=(XmlDoc 'Data/Core/Defs/ThinkTreeDefs/Humanlike.xml').SelectSingleNode('/Defs/ThinkTreeDef[defName="Humanlike"]//li[@Class="ThinkNode_ConditionalPrisoner"]')
$foodNodes=@($tree.SelectNodes('.//li[@Class="JobGiver_GetFood"]'));if($foodNodes.Count -ne 1){throw 'Unexpected prisoner hunger node count'}
$anc=@();$p=$foodNodes[0].ParentNode
while($p -and $p -ne $tree){if($p.Attributes['Class']){$anc+=,[ordered]@{class=$p.GetAttribute('Class');tag=$p.SelectSingleNode('tagToGive')?.InnerText}};$p=$p.ParentNode}
$hungerSequence=@($foodNodes[0].ParentNode.SelectNodes('li')|ForEach-Object {$_.GetAttribute('Class')})
$record=[ordered]@{
 evidence_id='RW17-PRISON-FOOD-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile)
 reusedFoodPolicies=[ordered]@{manifestFile=$foodManifestFile;manifestSha256=Hash (Join-Path $root $foodManifestFile);mechanismsFile=$foodMechanismFile;mechanismsSha256=Hash (Join-Path $root $foodMechanismFile);matchingTypes=$reused}
 rules=$records;boundedChecks=$bounded;packagedXml=$defs;prisonerHungerThinkTree=[ordered]@{ancestorsNearestFirst=$anc;siblingsInOrder=$hungerSequence}
 nativeReference=[ordered]@{
  ordinaryDeliveryConsumesFood=$false;bedsideFeedingConsumesFood=$true;foodAlreadySelectedInSameRoomSuppressesDelivery=$true
  carriedEdibleNutritionSuppressesDelivery=$true;sharedRoomSufficiencyCountsAllHungryPrisoners=$true;roomNutritionTolerance=.5
  hungryThresholdOffset=.02;wardenFeedPriority=80;wardenDeliverPriority=70;prisonerReservationMaxPawns=1;foodReservationMaxPawns=10
  sourceAllowsWardenInventory=$true;sourceAllowsPackAnimalInventory=$false;sourceAllowsCorpse=$false;sourceMayRefillDispenser=$false
  prisonerPolicyRespectedByWardenSupply=$true;prisonerPolicyRespectedBySelfEating=$false
  supplyAllowedInExecutionMode=$false;supplyAllowedInReleaseMode='only when downed';separateAllowFoodFieldInInspectedTracker=$false
  normalStandingSearchStartsWithin=4;normalStandingSearchExpandsTo=15;standingSearchAttempts=30;weakRandomFallbackExists=$true
  deliveryLegRechecksPrisonerStatus=$true;deliveryLegRechecksSupplyPermission=$true;deliveryLegDirectlyRechecksRoomOrPolicy=$false
  roomSufficiencyDirectlyChecksOrdinaryFoodFreshness=$false;roomSufficiencyDirectlyChecksOrdinaryFoodReachability=$false
  bedsideFeedTimeMultiplier=1.5
 }
 webDesignChoices=@('Finish real supply, same-room self-eating and bedside feeding before tuning hunger or nutrition.','A separate allowFood switch would be a Web extension: disable new supply and bedside feeding without confiscating food or disabling prisoner self-eating.','Retain eater-versus-getter policy semantics from the previous milestone.','Use current room topology and actual physical item placement; a food count or instant hunger refill is not delivery.','Stricter reevaluation of food policy, cell reachability, room ownership or patient state while walking is a Web consistency improvement beyond the bounded native driver.','A strict safe landing-cell solver differs from the generic native random fallback.','Room supply estimation may intentionally check current freshness and prisoner reachability to avoid stale unusable food suppressing every delivery; this improves the coarse native sufficiency estimate.','Projected claims for other incoming deliveries and integration with shared hauling/cooking reservations should avoid duplicate supply without inventing an atomic native room reservation.','Keep physically carried rations on interruption, and make source stack, carried split and dropped ration conserve identity/provenance/quantity through saves.','Original medical feeding, paste dispensers, multi-map rooms and DLC systems remain distinct from a limited Web prisoner supply implementation.')
 limits=@('Derived C# and packaged Core XML are static evidence, not original source or runtime interaction proof.','No game, browser, preview, GUI input or screenshot was launched.','Named absence checks are confined to the recorded types/methods; no assertion about every mod or other game version.','Selected XML fields are not a fully inherited or mod-patched effective Def database.','The food-policy milestone is reused only with identical assembly identity and matching derived type hashes.','Numbers are native reference values, not a demand to retune Web balance.','Full derived C#, assemblies and game assets remain local and unpublished.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 35).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static prison-food projection differs'};"Checked prison-food: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) XML projections, $($reused.Count) matched prior types"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));"Collected prison-food: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) XML projections, $($reused.Count) matched prior types"}
