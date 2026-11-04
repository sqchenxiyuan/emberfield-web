param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static projection only. No game assembly loading, runtime, browser or GUI.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence/animal-medical-mechanisms.json'
function Hash([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextHash([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
$manifestFile='docs/research/rimworld/evidence/animal-medical-manifest.json'
$reaFile='docs/research/rimworld/evidence/production-bills-rea-managed.json'
$manifest=Get-Content (Join-Path $root $manifestFile) -Raw|ConvertFrom-Json
$rea=Get-Content (Join-Path $root $reaFile) -Raw|ConvertFrom-Json
$assemblyHash=Hash (Join-Path $GameRoot 'Assembly-CSharp.dll')
if($assemblyHash -ne $manifest.source_sha256 -or $assemblyHash -ne $rea.subject.digest.sha256){throw 'Static identity mismatch'}
$sources=@{}
foreach($m in $manifest.types){$file=Join-Path $root $m.local_file;if((Hash $file) -ne $m.sha256){throw "Changed type $($m.type)"};$sources[$m.type]=[IO.File]::ReadAllText($file)}
$rules=@(
 @('RimWorld.BuildingProperties','public float bed_maxBodySize = 9999f;','Bed class default body-size cap; animal box overrides this.'),
 @('RimWorld.BuildingProperties','public bool bed_canBeMedical = true;','Beds can be marked medical by default.'),
 @('RimWorld.RestUtility','p.BodySize > bedDef.building.bed_maxBodySize','Fit uses current life-stage-adjusted body size.'),
 @('RimWorld.RestUtility','p.RaceProps.Humanlike != bedDef.building.bed_humanlike','Animal and human bed compatibility differ.'),
 @('RimWorld.Building_Bed','if (value != medicalInt && (!value || def.building.bed_canBeMedical))','Medical mode setter checks permission.'),
 @('RimWorld.Pawn_Ownership','if (newBed.IsOwner(pawn) || newBed.Medical)','Medical beds are not claimed as personal beds.'),
 @('RimWorld.Pawn_Ownership','newBed.CompAssignableToPawn.ForceAddPawn(pawn);','Ordinary bed claim assigns the same pawn reference.'),
 @('RimWorld.HealthAIUtility','if (!forced && patient.Faction != rescuer.Faction)','Automatic rescue requires same faction; forced rescue bypasses this gate.'),
 @('RimWorld.HealthAIUtility','if (!pawn.Downed)','WantsToBeRescued requires downed state.'),
 @('RimWorld.HealthAIUtility','if (pawn.InBed() || pawn.IsCharging())','A patient already in bed is not a rescue target.'),
 @('RimWorld.HealthAIUtility','CaravanFormingUtility.IsFormingCaravanOrDownedPawnToBeTakenByCaravan(pawn)','A separate caravan pickup workflow can exclude rescue.'),
 @('RimWorld.HealthAIUtility','if (pawn.ShouldBeSlaughtered())','Slaughter designation excludes routine care and rescue.'),
 @('RimWorld.HealthAIUtility','if (!forced && GenAI.EnemyIsNear(patient, 25f))','Automatic rescue checks nearby danger.'),
 @('RimWorld.HealthAIUtility','rescuer.CanReserveAndReach(patient, PathEndMode.OnCell, Danger.Deadly','Rescue requires actual reservation and reachability.'),
 @('RimWorld.FloatMenuOptionProvider_RescuePawn','HealthAIUtility.CanRescueNow(context.FirstSelectedPawn, clickedPawn, forced: true)','Manual rescue uses the forced eligibility path.'),
 @('RimWorld.FloatMenuOptionProvider_RescuePawn','clickedPawn.Faction != null && clickedPawn.Faction.HostileTo(Faction.OfPlayer)','Manual rescue excludes hostile-faction patients.'),
 @('RimWorld.FloatMenuOptionProvider_RescuePawn','playerSettings.medCare == MedicalCareCategory.NoCare','No-care policy disables the rescue menu.'),
 @('RimWorld.FloatMenuOptionProvider_RescuePawn','"NoAnimalBed"','Missing suitable animal bed produces a visible rejection.'),
 @('RimWorld.JobDriver_TakeToBed','pawn.Reserve(DropBed, job, DropBed.SleepingSlotsCount','Bed capacity is reserved as well as patient.'),
 @('RimWorld.JobDriver_TakeToBed','Toils_Bed.ClaimBedIfNonMedical(TargetIndex.B, TargetIndex.A)','An ordinary destination bed can be claimed by its patient.'),
 @('RimWorld.JobDriver_TakeToBed','Toils_Haul.StartCarryThing(TargetIndex.A)','Rescue physically carries the target pawn.'),
 @('RimWorld.JobDriver_TakeToBed','FailOn(() => !pawn.IsCarryingPawn(Takee))','Travel to bed requires carrying that exact patient.'),
 @('RimWorld.JobDriver_TakeToBed','pawn.carryTracker.TryDropCarriedThing(pawn.Position, ThingPlaceMode.Direct','Interrupted hauling drops the carried object at the rescuer location.'),
 @('RimWorld.JobDriver_TakeToBed','Takee.playerSettings = new Pawn_PlayerSettings(Takee);','Rescue creates missing player care settings on the same animal.'),
 @('RimWorld.JobDriver_TakeToBed','Toils_Bed.TuckIntoBed(DropBed, pawn, Takee, TakeeRescued)','Final placement retains patient identity.'),
 @('RimWorld.JobDriver_TakeToBed','Takee.RaceProps.Humanlike && job.def != JobDefOf.Arrest','The rescued social-notification flag is humanlike-specific.'),
 @('RimWorld.HealthAIUtility','if (pawn.playerSettings == null)','Automatic tending requires a patient with player care settings.'),
 @('RimWorld.WorkGiver_Tend','return patient.GetPosture() != PawnPosture.Standing;','Nonhumanlike treatment requires lying posture, not necessarily a bed.'),
 @('RimWorld.WorkGiver_Tend','return patient.InBed();','Humanlike non-self treatment uses a different bed requirement.'),
 @('RimWorld.WorkGiver_Tend','return JobMaker.MakeJob(JobDefOf.TendPatient, pawn2);','Automatic tending can proceed without medicine.'),
 @('RimWorld.JobDriver_TendPatient','int ticks = (int)(1f / pawn.GetStatValue(StatDefOf.MedicalTendSpeed) * 600f);','Treatment duration is work scaled by medical speed.'),
 @('RimWorld.Toils_Tend','actor.skills.Learn(SkillDefOf.Medicine, num * num2);','Animal treatment trains Medicine skill, not Animals.'),
 @('RimWorld.Toils_Tend','actor.carryTracker.TryStartCarry(thing, num2);','Medicine pickup moves actual inventory units.'),
 @('RimWorld.TendUtility','tmpHediffsToTend[i].Tended(quality, maxQuality, i);','Treatment marks selected hediffs; recovery is separate.'),
 @('RimWorld.TendUtility','medicine.stackCount--;','A completed treatment consumes one medicine unit when a stack remains.'),
 @('RimWorld.TendUtility','medicine.Destroy();','The final medicine unit is destroyed after use.'),
 @('RimWorld.TendUtility','num + severity <= 20f','Medicine can batch injury severity within a limit.'),
 @('RimWorld.TendUtility','else if ((hediff is Hediff_Injury) & usingMedicine)','Ordinary injury batching requires medicine.'),
 @('RimWorld.TendUtility','hediffCompProperties_TendDuration.tendAllAtOnce','Some disease definitions have a separate same-def batch rule.'),
 @('RimWorld.TendUtility','num *= medicinePotency;','Drug potency scales doctor treatment quality.'),
 @('RimWorld.TendUtility','num += building_Bed.GetStatValue(StatDefOf.MedicalTendQualityOffset);','Current bed can improve treatment quality.'),
 @('RimWorld.TendUtility','return Mathf.Clamp(num, 0f, medicineQualityMax);','Drug tier caps treatment quality.'),
 @('RimWorld.TendUtility','public const float NoMedicinePotency = 0.3f;','No medicine still has a low treatment potency.'),
 @('RimWorld.TendUtility','public const float NoMedicineQualityMax = 0.7f;','No-medicine treatment has its own quality ceiling.'),
 @('RimWorld.MedicalCareUtility','MedicalCareCategory.NoMeds => false','No-medicine care is different from no care.'),
 @('RimWorld.MedicalCareUtility','MedicalCareCategory.HerbalOrWorse => meds.GetStatValueAbstract','Drug policies compare medical potency limits.'),
 @('RimWorld.FeedPatientUtility','building_Bed == null || building_Bed.Faction != Faction.OfPlayer','Nonhumanlike feeding needs a player-owned bed, not player-owned patient.'),
 @('RimWorld.FeedPatientUtility','if (!HealthAIUtility.ShouldSeekMedicalRest(p))','Routine patient feeding requires medical-rest need.'),
 @('RimWorld.FeedPatientUtility','p.needs.food.PercentageThreshHungry + 0.02f','Patient feeding is hunger gated.'),
 @('RimWorld.JobDriver_FoodFeedPatient','Toils_Ingest.PickupIngestible(TargetIndex.A, Deliveree)','Patient feeding starts from actual food pickup.'),
 @('RimWorld.JobDriver_FoodFeedPatient','Toils_Goto.GotoThing(TargetIndex.B, PathEndMode.Touch)','Food is carried to physical contact with the patient.'),
 @('RimWorld.JobDriver_FoodFeedPatient','Toils_Ingest.ChewIngestible(Deliveree, 1.5f, TargetIndex.A)','Assisted feeding has an explicit eating work phase.'),
 @('RimWorld.JobDriver_FoodFeedPatient','Toils_Ingest.FinalizeIngest(Deliveree, TargetIndex.A)','Actual ingestion settles the food and nutrition.'),
 @('Verse.Pawn','ageTracker.CurLifeStage.bodySizeFactor * RaceProps.baseBodySize','Body size combines race and current life stage.'),
 @('Verse.Pawn','ageTracker.CurLifeStage.healthScaleFactor * RaceProps.baseHealthScale','Health scale combines race and life stage independently of body size.'),
 @('Verse.BodyPartDef','Mathf.CeilToInt((float)hitPoints * pawn.HealthScale)','Each anatomical part HP is scaled and rounded up.'),
 @('Verse.BodyPartDef','public int hitPoints = 10;','Unspecified part HP uses class default ten.'),
 @('Verse.Pawn_HealthTracker','hediffSet.PainTotal >= pawn.GetStatValue(StatDefOf.PainShockThreshold)','Pain shock is not a global HP-percentage test.'),
 @('Verse.Pawn_HealthTracker','!InPainShock && capacities.CanBeAwake && (capacities.CapableOf(PawnCapacityDefOf.Moving)','Downing also depends on consciousness and moving capacity.'),
 @('Verse.PawnCapacitiesHandler','GetLevel(PawnCapacityDefOf.Consciousness) >= 0.3f','Wakefulness consciousness threshold is separate from lethal capacity threshold.'),
 @('Verse.PawnCapacitiesHandler','return GetLevel(capacity) > capacity.minForCapable;','Capability threshold comparison is strict greater-than.'),
 @('RimWorld.PawnCapacityWorker_Moving','if (functionalPercentage < 0.4999f)','Movement calculation includes functional limb fraction.'),
 @('Verse.Pawn_HealthTracker','public float LethalDamageThreshold => 150f * pawn.HealthScale;','Total injury death threshold is distinct from part HP.'),
 @('Verse.Pawn_HealthTracker','num += hediffSet.hediffs[i].Severity;','Lethal damage threshold sums actual injury severity.'),
 @('Verse.Pawn_HealthTracker','num = 0.5f;','Nonplayer nonhost animal downing from eligible external damage can have an additional death roll; see enclosing branch.'),
 @('Verse.Hediff_Injury','this.IsTended() || this.IsPermanent()','Tended injury no longer bleeds through the ordinary injury bleed-rate path.'),
 @('Verse.Pawn_HealthTracker','pawn.IsHashIntervalTick(600, delta) && (pawn.needs.food == null || !pawn.needs.food.Starving)','Ordinary natural and tended recovery is periodic and requires not starving.'),
 @('Verse.Pawn_HealthTracker','num2 += building_Bed.def.building.bed_healPerDay;','Resting in bed can add to natural healing.'),
 @('Verse.Pawn_HealthTracker','tmpHediffInjuries.RandomElement().Heal(num2 * pawn.HealthScale * 0.01f','Natural recovery selects one eligible injury per interval.'),
 @('Verse.Pawn_HealthTracker','GenMath.LerpDouble(0f, 1f, 0.5f, 1.5f, Mathf.Clamp01(tendQuality))','Tended recovery additionally depends on treatment quality.'),
 @('Verse.Pawn_HealthTracker','healthState = PawnHealthState.Mobile;','Recovery exits downed state without creating a new pawn.'),
 @('RimWorld.LifeStageDef','public float bodySizeFactor = 1f;','Life-stage body-size default is one.'),
 @('RimWorld.LifeStageDef','public float healthScaleFactor = 1f;','Life-stage health-scale default is one.'),
 @('Verse.PawnCapacityDef','public float minForCapable;','Unspecified capacity threshold defaults to zero.'),
 @('RimWorld.TendUtility','RelationsUtility.TryDevelopBondRelation(doctor, patient, 0.004f)','Treatment has a gated bonding attempt distinct from rescue.'),
 @('RimWorld.RelationsUtility','trainability.intelligenceOrder < TrainabilityDefOf.Intermediate.intelligenceOrder','Bonding requires at least Intermediate effective trainability.'),
 @('RimWorld.TendUtility','InteractionWorker_RecruitAttempt.DoRecruit(doctor, patient, useAudiovisualEffects: false);','Successful cross-faction bonding can separately recruit the animal.'),
 @('RimWorld.TrainableUtility','return pawn.RaceProps.trainability;','Ordinary trainability comes from the race definition.'),
 @('RimWorld.TrainableUtility','ModsConfig.OdysseyActive && pawn.health.hediffSet.HasHediff(HediffDefOf.SentienceCatalyst)','Odyssey sentience is an explicit exception to base trainability.'),
 @('RimWorld.RecruitUtility','pawn.SetFaction(faction, recruiter);','The separate recruitment path can transfer faction.'),
 @('RimWorld.FloatMenuOptionProvider_DraftedTend','onlyUseInventory: true','Drafted field tending initially searches the doctor inventory.'),
 @('RimWorld.FloatMenuOptionProvider_DraftedTend','job.draftedTend = true;','Field treatment is explicitly marked as drafted tending.'),
 @('RimWorld.FloatMenuOptionProvider_DraftedTend','WorkTypeIsDisabled(WorkTypeDefOf.Doctor)','Field tending still checks disabled Doctor work.'),
 @('Verse.Pawn_HealthTracker','pawn.GetLord()?.Notify_PawnLost(pawn, PawnLostCondition.Incapped, dinfo);','Downing notifies group membership before later rescue.'),
 @('Verse.AI.Group.Lord','if (!curJob.ShouldRemovePawn(pawn, cond))','Group removal is controlled by the LordJob policy.'),
 @('Verse.AI.Group.Lord','RemovePawn(pawn);','Eligible lost-pawn notifications remove group membership.'),
 @('RimWorld.LordJob_TradeWithColony','public class LordJob_TradeWithColony : LordJob','Standard trading caravan uses the base LordJob removal policy unless overridden.'),
 @('RimWorld.Pawn_PlayerSettings','medCare = Find.PlaySettings.defaultCareForWildlife;','Medical defaults distinguish wildlife.'),
 @('RimWorld.Pawn_PlayerSettings','medCare = Find.PlaySettings.defaultCareForTamedAnimal;','Medical defaults distinguish colony animals.'),
 @('RimWorld.Pawn_PlayerSettings','ResetMedicalCare();','Faction-change notification initializes/reset medical policy.'),
 @('RimWorld.PlaySettings','public MedicalCareCategory defaultCareForWildlife = MedicalCareCategory.HerbalOrWorse;','New game wildlife care default allows herbal medicine.'),
 @('RimWorld.PlaySettings','public MedicalCareCategory defaultCareForTamedAnimal = MedicalCareCategory.HerbalOrWorse;','New game tamed animal care default allows herbal medicine.'),
 @('RimWorld.PlaySettings','public MedicalCareCategory defaultCareForNeutralFaction = MedicalCareCategory.HerbalOrWorse;','New game neutral faction care default allows herbal medicine.'),
 @('Verse.Pawn','Scribe_Deep.Look(ref health, "healthTracker", this);','Health persists on the individual pawn.'),
 @('Verse.Pawn','Scribe_Deep.Look(ref ageTracker, "ageTracker", this);','Age is retained as individual pawn state.')
)
$records=@(foreach($rule in $rules){
 $m=@($manifest.types|Where-Object type -eq $rule[0]);if($m.Count -ne 1){throw "Missing type $($rule[0])"}
 $lines=$sources[$rule[0]].Split("`n");$hits=@(for($i=0;$i -lt $lines.Length;$i++){if($lines[$i].Contains($rule[1])){[ordered]@{line=$i+1;text=$lines[$i].Trim()}}})
 if(!$hits.Count){throw "Missing anchor $($rule[0]): $($rule[1])"}
 [ordered]@{type=$rule[0];file=$m[0].local_file;sha256=$m[0].sha256;anchor=$rule[1];hits=$hits;interpretation=$rule[2]}
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
 (Bounded 'RimWorld.FloatMenuOptionProvider_RescuePawn' 'protected override FloatMenuOption GetSingleOptionFor' '' @('SetFaction','GeneratePawn','DoRecruit') @('JobDefOf.Rescue') 'Manual rescue schedules hauling, not recruitment.'),
 (Bounded 'RimWorld.JobDriver_TakeToBed' 'private void CheckMakeTakeeGuest()' '' @('SetFaction','GeneratePawn') @('Takee.guest != null','SetGuestStatus') 'Guest notification is conditional and not direct faction transfer.'),
 (Bounded 'RimWorld.TendUtility' 'public static void DoTend' 'public static float CalculateBaseTendQuality' @('.Heal(','GeneratePawn') @('.Tended(','DoRecruit') 'Treatment is separate from injury healing; rare bond recruitment is retained as an exception.'),
 (Bounded 'RimWorld.JobDriver_FoodFeedPatient' 'protected override IEnumerable<Toil> MakeNewToils' '' @('SetFaction','GeneratePawn','DoRecruit') @('FinalizeIngest') 'Patient feeding preserves faction and identity in this reviewed method.'),
 (Bounded 'Verse.Pawn_HealthTracker' 'private void MakeUndowned' 'public void NotifyPlayerOfKilled' @('SetFaction','GeneratePawn') @('PawnHealthState.Mobile') 'Standing recovery changes state, not ownership.'),
 (Bounded 'Verse.AI.Group.LordJob' 'public virtual bool ShouldRemovePawn' 'public virtual IEnumerable<Gizmo>' @() @('return true;') 'Default LordJob removes lost pawns.'),
 (Bounded 'RimWorld.LordJob_TradeWithColony' 'public class LordJob_TradeWithColony' '' @('ShouldRemovePawn') @(': LordJob') 'The ordinary trade Lord does not override base removal policy.'),
 (Bounded 'Verse.Pawn' 'public override void DeSpawn' 'public override void Discard' @('SetFaction','GeneratePawn','Notify_PawnLost') @('base.DeSpawn(mode)') 'Map despawning itself does not directly transfer faction or issue group removal here; downing has a separate notification.'),
 (Bounded 'RimWorld.RestUtility' 'public static bool CanUseBedEver' 'public static bool TimetablePreventsLayDown' @('Faction','Medical') @('p.BodySize','bed_humanlike') 'Physical bed compatibility is separate from ownership, reservation and medical policy checks.'),
 (Bounded 'RimWorld.RestUtility' 'public static Building_Bed FindBedFor(Pawn sleeper' 'public static Building_Bed FindPatientBedFor' @() @('HealthAIUtility.ShouldSeekMedicalRest(sleeper)','((Building_Bed)b).Medical','!((Building_Bed)b).Medical') 'Bed search prioritizes medical beds but retains ordinary-bed fallback.'),
 (Bounded 'RimWorld.FloatMenuOptionProvider_DraftedTend' 'private bool IsValidTendTarget' 'protected override FloatMenuOption GetSingleOptionFor' @('InBed') @('if (patient.Downed)','return true;','patient.HostileTo') 'Field target check accepts downed before the later hostility gate; additional menu and job checks still apply.'),
 (Bounded 'RimWorld.Pawn_PlayerSettings' 'public Pawn_PlayerSettings(Pawn pawn)' 'public void ExposeData' @() @('Notify_FactionChanged();') 'Constructing rescue care settings initializes the faction-specific policy.'),
 (Bounded 'RimWorld.Building_Bed' 'public bool Medical' 'public bool AnyUnownedSleepingSlot' @() @('RemoveAllOwners();','medicalInt = value;') 'Changing medical mode removes permanent bed assignments.')
)
$raceFields=@('statBases/PainShockThreshold','race/body','race/baseBodySize','race/baseHealthScale','race/trainability','race/playerCanChangeMaster','race/lifeStageAges')
$specs=@(
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Base.xml','/Defs/ThingDef[@Name="BuildingBase"]',@('costList','costStuffCount','building/bed_maxBodySize','building/bed_healPerDay','building/bed_canBeMedical'),'Root building inheritance contributes no animal bed limit.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml','/Defs/ThingDef[@Name="FurnitureBase"]',@('costList','costStuffCount','building/bed_maxBodySize','building/bed_healPerDay','building/bed_canBeMedical'),'Furniture parent bed-field projection.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml','/Defs/ThingDef[@Name="FurnitureWithQualityBase"]',@('costList','costStuffCount','building/bed_maxBodySize','building/bed_healPerDay','building/bed_canBeMedical'),'Quality furniture parent bed-field projection.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml','/Defs/ThingDef[defName="AnimalSleepingSpot"]',@('thingClass','size','passability','useHitPoints','costList','costStuffCount','statBases','building/bed_humanlike','building/bed_healPerDay'),'Free ground spot is a real animal Building_Bed.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml','/Defs/ThingDef[@Name="AnimalBedFurnitureBase"]',@('thingClass','building/bed_humanlike','building/bed_healPerDay'),'Furniture animal beds add four natural-heal units per day.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml','/Defs/ThingDef[defName="AnimalSleepingBox"]',@('costStuffCount','stuffCategories','building/bed_maxBodySize','statBases'),'Small-animal box body cap is .55.'),
 @('Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml','/Defs/ThingDef[defName="AnimalBed"]',@('costStuffCount','stuffCategories','building/bed_maxBodySize','statBases'),'Soft bed inherits the class default body-size cap.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Hares.xml','/Defs/ThingDef[@Name="BaseHare"]',$raceFields,'Hare physical and health template.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Hares.xml','/Defs/ThingDef[defName="Hare"]',$raceFields,'Concrete hare inherits BaseHare.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_PigGroup.xml','/Defs/ThingDef[defName="Deer"]',$raceFields,'Deer uses hoof quadruped body.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_SheepGroup.xml','/Defs/ThingDef[defName="Alpaca"]',$raceFields,'Alpaca uses hoof quadruped body.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_CowGroup.xml','/Defs/ThingDef[defName="Dromedary"]',$raceFields,'Dromedary adds a hump body part.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_ChickenGroup.xml','/Defs/ThingDef[defName="Chicken"]',$raceFields,'Chicken has Bird anatomy and tiny baby life stage.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml','/Defs/ThingDef[@Name="BasePawn"]',$raceFields,'Base pawn does not override pain threshold.'),
 @('Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml','/Defs/ThingDef[@Name="AnimalThingBase"]',$raceFields,'Base animal trainability is None.'),
 @('Data/Core/Defs/Stats/Stats_Pawns_General.xml','/Defs/StatDef[defName="PainShockThreshold"]',@('minValue','maxValue','defaultBaseValue'),'Pain shock default is .8, not remaining HP .2.'),
 @('Data/Core/Defs/PawnCapacityDefs/PawnCapacity.xml','/Defs/PawnCapacityDef[defName="Moving"]',@('workerClass','minForCapable','zeroIfCannotBeAwake'),'Moving must exceed .15 to remain capable.'),
 @('Data/Core/Defs/PawnCapacityDefs/PawnCapacity.xml','/Defs/PawnCapacityDef[defName="Consciousness"]',@('workerClass','minForCapable','lethalFlesh'),'Lethal consciousness capability differs from .3 wakefulness.'),
 @('Data/Core/Defs/ThinkTreeDefs/Animal.xml','/Defs/ThinkTreeDef[defName="Animal"]',@('.//li[@Class="JobGiver_PatientGoToBed"]'),'Two bed-seeking nodes; ancestor paths retained separately below.')
)
foreach($name in @('DoctorRescue','DoctorTendToAnimals','DoctorFeedAnimals','HandlingFeedPatientAnimals','DoBillsMedicalAnimalOperation')){
 $specs+=,@('Data/Core/Defs/WorkGiverDefs/WorkGivers.xml',('/Defs/WorkGiverDef[defName="'+$name+'"]'),@('giverClass','workType','priorityInType','directOrderable','requiredCapacities','feedAnimalsOnly','equivalenceGroup'),'Work assignment and inherited feeding equivalence group.')
}
foreach($name in @('AnimalBaby','AnimalBabyTiny','AnimalJuvenile','AnimalAdult')){
 $specs+=,@('Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml',('/Defs/LifeStageDef[defName="'+$name+'"]'),@('bodySizeFactor','healthScaleFactor','alwaysDowned'),'Life-stage scaling; missing fields inherit XML or class defaults.')
}
foreach($name in @('MedicineHerbal','MedicineIndustrial','MedicineUltratech')){
 $specs+=,@('Data/Core/Defs/ThingDefs_Items/Items_Resource_Manufactured.xml',('/Defs/ThingDef[defName="'+$name+'"]'),@('thingClass','statBases/MedicalPotency','statBases/MedicalQualityMax'),'Medicine potency and quality ceiling are separate.')
}
$docs=@{}
function XmlDoc([string]$rel){if(!$docs.ContainsKey($rel)){$d=[Xml.XmlDocument]::new();$d.XmlResolver=$null;$d.Load((Join-Path $GameRoot $rel));$docs[$rel]=$d};return ,$docs[$rel]}
$defs=@(foreach($spec in $specs){
 $doc=XmlDoc $spec[0];$nodes=@($doc.SelectNodes($spec[1]));if($nodes.Count -ne 1){throw "Unexpected XML node count: $($spec[1])"}
 $node=$nodes[0];$fields=@(foreach($xpath in $spec[2]){$values=@($node.SelectNodes($xpath));[ordered]@{xpath=$xpath;count=$values.Count;xml=@($values|ForEach-Object OuterXml)}})
 [ordered]@{file=$spec[0];sha256=Hash (Join-Path $GameRoot $spec[0]);xpath=$spec[1];nameAttribute=$node.GetAttribute('Name');parentName=$node.GetAttribute('ParentName');fields=$fields;interpretation=$spec[3]}
})
function PartNodes([Xml.XmlNode]$node,[string]$path){
 $fields=[ordered]@{};foreach($f in @('def','customLabel','coverage','height','depth')){$v=$node.SelectSingleNode($f);$fields[$f]=if($v){$v.InnerText}else{$null}}
 [ordered]@{path=$path;fields=$fields}
 $i=0;foreach($child in $node.SelectNodes('parts/li')){$i++;PartNodes $child ($path+'/parts/li['+$i+']')}
}
$bodyProfiles=@(foreach($spec in @(@('Bodies_Animal_Quadruped.xml','QuadrupedAnimalWithPawsAndTail'),@('Bodies_Animal_Quadruped.xml','QuadrupedAnimalWithHooves'),@('Bodies_Animal_Quadruped.xml','QuadrupedAnimalWithHoovesAndHump'),@('Bodies_Animal_Bird.xml','Bird'))){
 $rel='Data/Core/Defs/Bodies/'+$spec[0];$doc=XmlDoc $rel;$xpath='/Defs/BodyDef[defName="'+$spec[1]+'"]';$node=$doc.SelectSingleNode($xpath)
 if(!$node){throw "Missing body $($spec[1])"}
 [ordered]@{defName=$spec[1];file=$rel;sha256=Hash (Join-Path $GameRoot $rel);xpath=$xpath;parts=@(PartNodes ($node.SelectSingleNode('corePart')) 'corePart')}
})
$partDefs=@(foreach($partName in @($bodyProfiles.parts.fields.def|Sort-Object -Unique)){
 $found=@(foreach($file in @('BodyParts_General.xml','BodyParts_Animal.xml','BodyParts_Organs.xml','BodyParts_Humanoid.xml')){
  $rel='Data/Core/Defs/Bodies/'+$file;$doc=XmlDoc $rel;$xpath='/Defs/BodyPartDef[defName="'+$partName+'"]';$node=$doc.SelectSingleNode($xpath)
  if($node){$fields=[ordered]@{};foreach($f in @('hitPoints','tags','bleedRate','solid','delicate','conceptual')){$v=$node.SelectSingleNode($f);$fields[$f]=if($v){$v.OuterXml}else{$null}};[ordered]@{defName=$partName;file=$rel;sha256=Hash (Join-Path $GameRoot $rel);xpath=$xpath;parentName=$node.GetAttribute('ParentName');fields=$fields}}
 });if($found.Count -ne 1){throw "Ambiguous or missing body part: $partName"};$found[0]
})
$thinkDoc=XmlDoc 'Data/Core/Defs/ThinkTreeDefs/Animal.xml'
$patientNodes=@(foreach($node in $thinkDoc.SelectNodes('/Defs/ThinkTreeDef[defName="Animal"]//li[@Class="JobGiver_PatientGoToBed"]')){
 $anc=@();$p=$node.ParentNode;while($p -and $p.Name -ne 'ThinkTreeDef'){if($p.Attributes['Class']){$anc+=,[ordered]@{class=$p.GetAttribute('Class');invert=$p.SelectSingleNode('invert')?.InnerText}};$p=$p.ParentNode};[ordered]@{class=$node.GetAttribute('Class');ancestorsNearestFirst=$anc}
})
$expectedSpecies=@(
 @('Hare','Races_Animal_Hares.xml','/Defs/ThingDef[@Name="BaseHare"]','QuadrupedAnimalWithPawsAndTail',.2,.4),
 @('Deer','Races_Animal_PigGroup.xml','/Defs/ThingDef[defName="Deer"]','QuadrupedAnimalWithHooves',1.2,.9),
 @('Alpaca','Races_Animal_SheepGroup.xml','/Defs/ThingDef[defName="Alpaca"]','QuadrupedAnimalWithHooves',1,1),
 @('Dromedary','Races_Animal_CowGroup.xml','/Defs/ThingDef[defName="Dromedary"]','QuadrupedAnimalWithHoovesAndHump',2.1,1.6),
 @('Chicken','Races_Animal_ChickenGroup.xml','/Defs/ThingDef[defName="Chicken"]','Bird',.3,.35)
)
foreach($s in $expectedSpecies){
 $node=(XmlDoc ('Data/Core/Defs/ThingDefs_Races/'+$s[1])).SelectSingleNode($s[2]);$r=$node.SelectSingleNode('race')
 if($r.body -cne $s[3] -or [double]$r.baseBodySize -ne $s[4] -or [double]$r.baseHealthScale -ne $s[5]){throw "Species physical reference drifted: $($s[0])"}
 if($r.trainability -and $r.trainability -cne 'None'){throw "Species trainability drifted: $($s[0])"}
}
$animalBase=(XmlDoc 'Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml').SelectSingleNode('/Defs/ThingDef[@Name="AnimalThingBase"]')
if($animalBase.race.trainability -cne 'None'){throw 'Animal parent trainability drifted'}
foreach($b in $bodyProfiles){
 $expectedLegs=if($b.defName -eq 'Bird'){2}else{4}
 if(@($b.parts|Where-Object {$_.fields.def -eq 'Leg'}).Count -ne $expectedLegs){throw "Body limbs drifted: $($b.defName)"}
 if(@($b.parts|Where-Object {$_.fields.def -in @('Arm','Hand','Wing')}).Count){throw "Unexpected anatomy: $($b.defName)"}
}
$record=[ordered]@{
 evidence_id='RW17-ANIMAL-MEDICAL-STATIC';version=$manifest.version_text;assemblySha256=$assemblyHash
 reaEvidenceId=$rea.evidence_id;reaParentId=$rea.parameters.parent_evidence_id;reaFile=$reaFile;reaSha256=Hash (Join-Path $root $reaFile)
 manifestFile=$manifestFile;manifestSha256=Hash (Join-Path $root $manifestFile);rules=$records;boundedChecks=$bounded;packagedXml=$defs
 bodyProfiles=$bodyProfiles;bodyPartDefs=$partDefs;patientThinkTreeNodes=$patientNodes
 nativeReference=[ordered]@{
  careWorkType='Doctor';patientFeedingWorkTypes=@('Doctor','Handling');automaticRescueSameFaction=$true;manualRescueAllowsNonhostileForeignAnimals=$true
  rescueChangesAnimalFactionDirectly=$false;animalTendRequiresBed=$false;animalTendRequiresLying=$true;animalPatientFeedRequiresPlayerBed=$true
  carePolicies=@('NoCare','NoMeds','HerbalOrWorse','NormalOrWorse','Best');treatmentIsInstantFullHeal=$false
  bodySizeCapDefault=9999;animalSleepingBoxBodySizeCap=.55;animalFurnitureHealPerDay=4;painShockDefault=.8;consciousnessAwakeMinimum=.3;movingCapableStrictMinimum=.15
  lethalInjurySeverityPerHealthScale=150;tendWorkTicks=600;healingIntervalTicks=600;noMedicinePotency=.3;noMedicineQualityMax=.7;medicineInjuryBatchSeverity=20
  medicineUnitsPerSuccessfulTreatment=1;naturalHealBasePerDay=8;lyingNaturalHealBonusPerDay=4;tendedHealBasePerDay=8
  treatmentBondBaseChance=.004;treatmentBondMinimumTrainability='Intermediate';fiveCoreSpeciesTrainability='None';standardTradeLordRemovesDownedPawns=$true
  species=@(
   [ordered]@{def='Hare';body='QuadrupedAnimalWithPawsAndTail';baseBodySize=.2;baseHealthScale=.4},
   [ordered]@{def='Deer';body='QuadrupedAnimalWithHooves';baseBodySize=1.2;baseHealthScale=.9},
   [ordered]@{def='Alpaca';body='QuadrupedAnimalWithHooves';baseBodySize=1;baseHealthScale=1},
   [ordered]@{def='Dromedary';body='QuadrupedAnimalWithHoovesAndHump';baseBodySize=2.1;baseHealthScale=1.6},
   [ordered]@{def='Chicken';body='Bird';baseBodySize=.3;baseHealthScale=.35}
  )
 }
 webDesignChoices=@('Build rescue, carry, treat, feed and recovery state machines before balancing.','A compact species-specific anatomy model can omit detailed organs if labeled as simplification.','Retaining merchantId through incapacitation is a Web continuity choice, not native Lord membership equivalence.','Omitting random death-on-downed and rare bond recruitment is an explicit prototype rule.','Use original values as reference constants, not proof of Web runtime parity.')
 limits=@('Static derived C# and packaged Core XML are not original source or runtime proof.','REA metadata is reused for exact assembly identity only; ILSpy reconstructs the separately hashed C# types.','No game, browser, preview, GUI or screenshot was launched.','The XML projections are selected packaged nodes, not the mod-patched effective Def database.','Literal anchors and bounded absence checks support only their recorded methods; indirect callbacks can do additional work.','Pain, death and capacities have other modifiers and DLC paths; .8 pain threshold is a default, not universal.','No surgery, disease catalog, infection probability or trader recovery-exit integration completeness is claimed.','Full derived C#, assemblies and game assets stay outside the published evidence.')
 collectorSha256=Hash $PSCommandPath
}
$json=($record|ConvertTo-Json -Depth 30).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($out) -cne $json){throw 'Static animal-medical projection differs'};"Checked animal-medical: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) XML projections, $($bodyProfiles.Count) body profiles, $($partDefs.Count) part definitions"}
else{[IO.File]::WriteAllText($out,$json,[Text.UTF8Encoding]::new($false));"Collected animal-medical: $($records.Count) anchors, $($bounded.Count) bounded checks, $($defs.Count) XML projections, $($bodyProfiles.Count) body profiles, $($partDefs.Count) part definitions"}
