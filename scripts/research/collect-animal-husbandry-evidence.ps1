param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld')
# Read-only source analysis. C# is ILSpy-derived data, never loaded as game code.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence'
$manifest=Get-Content (Join-Path $out 'animal-husbandry-manifest.json') -Raw|ConvertFrom-Json
$repro=Get-Content (Join-Path $root '.local-research/husbandry-reproduction/manifest.json') -Raw|ConvertFrom-Json
function Source([string]$file,[int]$start=1,[int]$end=0){
 $path=Join-Path $root $file;$lines=Get-Content -LiteralPath $path
 if(!$end){$end=$lines.Count}
 if($start -lt 1 -or $end -gt $lines.Count -or $end -lt $start){throw "Invalid range: $file $start..$end"}
 [ordered]@{file=$file;sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();lines=@($start,$end)}
}
function WriteJson([string]$file,$data){[IO.File]::WriteAllText((Join-Path $out $file),($data|ConvertTo-Json -Depth 18).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))}
$p='.local-research/animal-husbandry';$r='.local-research/husbandry-reproduction'
$claims=@(
 [ordered]@{id='AH01';finding='Tame designation removes existing designations on the target before adding Tame. CanTame requires animal/wildman, no humanlike faction, wildness below1, not Dryad and no Scaria.';sources=@((Source "$p/RimWorld.Designator_Tame.cs" 50 84),(Source "$p/RimWorld.TameUtility.cs"));xml=@()},
 [ordered]@{id='AH02';finding='A handler must reserve the animal, meet minimum Animals skill and find it awake, not downed and casually interactible. Tame also requires its designation and a30000tick cooldown since last assigned interaction; ordinary priority does not bypass these skill/cooldown checks.';sources=@((Source "$p/RimWorld.WorkGiver_InteractAnimal.cs" 43 76),(Source "$p/RimWorld.WorkGiver_Tame.cs" 23 40),(Source "$p/RimWorld.TameUtility.cs" 57 60));xml=@()},
 [ordered]@{id='AH03';finding='Taming food is carried inventory. Inventory must support two feeds; otherwise map search excludes standing plants, drugs, corpses, dispensers, forbidden and socially improper food. Tame reserves four attempts worth of nutrition and uses ceil for pickup count. Its shared training pickup helper instead uses StackCountForNutrition rounding.';sources=@((Source "$p/RimWorld.WorkGiver_Tame.cs" 41 60),(Source "$p/RimWorld.WorkGiver_InteractAnimal.cs" 78 119),(Source "$p/RimWorld.JobDriver_Tame.cs" 14 28),(Source '.local-research/food/RimWorld.FoodUtility.cs' 1314 1322));xml=@('AX01','AX02')},
 [ordered]@{id='AH04';finding='Shared animal interaction has three270tick chats and two feed phases; feed target nutrition is min(MaxFood*0.15,0.3). Each phase takes actual inventory food into carry, rounds portions using StackCountForNutrition, ingests on the animal and returns leftovers. Duration scales with the taken portion;270 is not a fixed total tame duration.';sources=@((Source '.local-research/prisoners/RimWorld.JobDriver_InteractAnimal.cs'),(Source '.local-research/food/RimWorld.Toils_Ingest.cs' 395 438),(Source '.local-research/food/Verse.Thing.cs' 2132 2204));xml=@('AX01','AX02','AX03')},
 [ordered]@{id='AH05';finding='Ordinary tame chance is handler TameAnimalChance times a wildness curve with points(0,2),(.5,1),(1,0), with conditional bonded/venerated multipliers. The Animals skill factor is0.04+0.03*level, but capacities and stat processing also apply. Inspired_Taming guarantees this final check and is consumed; failed attempts can trigger manhunter via the species chance.';sources=@((Source '.local-research/prisoners/RimWorld.InteractionWorker_RecruitAttempt.cs' 29 104),(Source '.local-research/prisoners/Verse.AI.Pawn_MindState.cs' 702 716),(Source '.local-research/housing/RimWorld.PawnUtility.cs' 1301 1311));xml=@('AX01')},
 [ordered]@{id='AH06';finding='Successful recruitment calls SetFaction: it removes designations, updates components/name and completes Tameness for player animals. Tame may subsequently request a rope-to-pen job for rope managed animals; it does not create a pen.';sources=@((Source '.local-research/prisoners/RimWorld.RecruitUtility.cs'),(Source "$r/Verse.Pawn.cs" 2702 2780),(Source "$p/RimWorld.JobDriver_Tame.cs" 27 53));xml=@('AX09')},
 [ordered]@{id='AH07';finding='Animal self-feeding searches compatible reachable food through the ordinary food job. Self-search can include plants; selected herbivores seek food below45%food, with hungry/urgent thresholds36%/18%. RawRice nutrition0.05 is inherited. This differs from the plant-excluding handler tame-food search.';sources=@((Source '.local-research/food/RimWorld.JobGiver_GetFood.cs' 25 98),(Source '.local-research/food/RimWorld.FoodUtility.cs' 181 225),(Source '.local-research/food/RimWorld.FoodUtility.cs' 381 457),(Source "$r/Verse.RaceProperties.cs" 293 305),(Source "$r/RimWorld.Need_Food.cs" 21 46),(Source "$r/RimWorld.FoodTypeFlags.cs"));xml=@('AX02','AX04','AX05')},
 [ordered]@{id='AH08';finding='Grazing consumes actual plant nutrition. Available nutrition=growth*Nutrition; partial eating subtracts nutrition/Nutrition from growth, while exhausting the plant consumes/destroys it. Core Grass has Nutrition0.50 and growDays2.5; growth also depends on environmental plant rules, so2.5 is not unconditional elapsed regrowth time.';sources=@((Source '.local-research/generation/RimWorld.Plant.cs' 603 620),(Source '.local-research/food/Verse.Thing.cs' 2132 2180),(Source '.local-research/food/RimWorld.Toils_Ingest.cs' 419 438));xml=@('AX12','AX13')},
 [ordered]@{id='AH09';finding='Training checks same faction, an assignable next trainable, interaction eligibility, inventory food and15000tick cooldown. It reuses the actual feed/talk sequence. Skill training is not automatic support for hauling or combat on every tamed species.';sources=@((Source "$p/RimWorld.WorkGiver_Train.cs"),(Source "$p/RimWorld.JobDriver_Train.cs"),(Source "$r/RimWorld.Pawn_TrainingTracker.cs" 85 177));xml=@('AX09')},
 [ordered]@{id='AH10';finding='Hare and Deer use VegetarianRoughAnimal, Wildness0.75, genders and trainabilityNone. Base hunger factors are0.115/0.2 and body sizes0.2/1.2. Adult fed base consumption is1.6*baseHungerRate=0.184/0.32 nutrition/day before health, traits, bed or other modifiers; the Def factor is not nutrition/day itself.';sources=@((Source "$r/Verse.RaceProperties.cs"),(Source "$r/RimWorld.Need_Food.cs" 122 159),(Source "$r/RimWorld.Need_Food.cs" 215 219));xml=@('AX04','AX05','AX06')},
 [ordered]@{id='AH11';finding='Deer roamMtbDays2 implies Roamer/FenceBlocked and rope/pen management. Hare has no roamMtbDays in the selected Core chain and uses allowed areas rather than fence containment. Area restrictions are not physical walls.';sources=@((Source "$r/Verse.RaceProperties.cs"),(Source "$r/Verse.AnimalPenUtility.cs"));xml=@('AX04','AX05','AX06')},
 [ordered]@{id='AH12';finding='One biological year is3600000ticks=60days. Age continues advancing, while animal life stage derives from separately persisted hunger-modulated growth. Both juvenile thresholds are0.1years; fed adulthood is0.2222years forHare and0.3333 forDeer. Starvation delays stage maturation rather than freezing biological age.';sources=@((Source "$r/Verse.Pawn_AgeTracker.cs" 97 102),(Source "$r/Verse.Pawn_AgeTracker.cs" 417 459),(Source "$r/Verse.Pawn_AgeTracker.cs" 525 574));xml=@('AX04','AX05')},
 [ordered]@{id='AH13';finding='Animal baby factors body/foodMax/health/hunger are0.2/3/0.25/0.4; juvenile0.5/1.5/0.6/0.75; adult defaults1. Only AnimalAdult is reproductive in the selected Core life stages.';sources=@((Source "$r/RimWorld.LifeStageDef.cs" 1 89));xml=@('AX07')},
 [ordered]@{id='AH14';finding='The Animal think tree places mating inside HasFaction. A nonsterile male seeks a fertile female of the same faction and species or explicit crossbreed within30 reachable cells, not downed/forbidden and casually interactible. Sterile rejects nonreproductive stages and pregnancy-preventing hediffs, including existing pregnancy.';sources=@((Source "$r/RimWorld.JobGiver_Mate.cs"),(Source "$r/Verse.Pawn.cs" 3836 3881),(Source "$r/RimWorld.PawnUtility.cs" 346 358));xml=@('AX08','AX11')},
 [ordered]@{id='AH15';finding='Hare mateMtbHours8 and Deer inherits12. The chance-per-hour node uses that value; actual mating walks to touch and waits500ticks. Mammals conceive on Rand.Value<0.5. MTB is not a guaranteed conception countdown.';sources=@((Source "$r/Verse.RaceProperties.cs" 160 174),(Source "$r/Verse.AI.ThinkNode_ChancePerHour_Mate.cs"),(Source "$r/RimWorld.JobDriver_Mate.cs"),(Source "$r/RimWorld.PawnUtility.cs" 360 377));xml=@('AX04','AX05')},
 [ordered]@{id='AH16';finding='Both gestationPeriodDays5.661. Pregnancy severity starts0.001; progress addsHungerMultiplier*delta/(days*60000). Fed/hungry/urgent/starving multipliers1/0.5/0.25/0 affect gestation and immature growth, not biological age.';sources=@((Source "$r/Verse.Hediff_Pregnant.cs" 84 139),(Source "$r/RimWorld.PawnUtility.cs" 341 344),(Source "$r/RimWorld.HungerLevelUtility.cs"),(Source "$r/Verse.Pawn_AgeTracker.cs" 525 536));xml=@('AX04','AX05','AX11')},
 [ordered]@{id='AH17';finding='At progress>=1 animals directly spawn offspring without human labor. Mother kind/faction, age0, inherited allowed area and parent relations are used. Hare litter curve rounds to1or2; Deer null curve defaults1. Ordinary generator chooses sex and initializes player-animal Tameness.';sources=@((Source "$r/Verse.Hediff_Pregnant.cs" 118 204),(Source "$r/Verse.PawnGenerator.cs" 745 769),(Source "$r/Verse.PawnGenerator.cs" 828 845),(Source "$r/Verse.RaceProperties.cs" 160 174));xml=@('AX04','AX05','AX06')},
 [ordered]@{id='AH18';finding='Pregnancy checks every1000ticks: starvation plusMalnutrition>0.1 hasMTB2days miscarriage hazard; severe wounds above38*baseHealthScale separately haveMTB2days hazard. Miscarry removes pregnancy; neither is a fixed2day timer.';sources=@((Source "$r/Verse.Hediff_Pregnant.cs" 14 56),(Source "$r/Verse.Hediff_Pregnant.cs" 84 155));xml=@('AX11')},
 [ordered]@{id='AH19';finding='Food zero increases Malnutrition, eating allows gradual recovery. Per150tick need interval magnitude0.0011325 times a fixed seeded individual factor0.8..1.2, base0.453/day. Malnutrition severity0.8 caps consciousness0.1 and severity1 is lethal.';sources=@((Source "$r/RimWorld.Need_Food.cs" 81 87),(Source "$r/RimWorld.Need_Food.cs" 161 181));xml=@('AX10')},
 [ordered]@{id='AH20';finding='Tameness has5steps. Degradation interval curve wildness0->12days,1->6days yields7.5days at0.75. Each eligible decay reduces one learned leaf trainable step. Tameness0 returns a player animal to null faction. FenceBlocked skips tameness decay: ordinaryHare needs maintenance, Deer does not.';sources=@((Source "$r/RimWorld.TrainableUtility.cs" 13 20),(Source "$r/RimWorld.TrainableUtility.cs" 169 204),(Source "$r/RimWorld.Pawn_TrainingTracker.cs" 219 270));xml=@('AX09')},
 [ordered]@{id='AH21';finding='Minimum handling curve(0,0),(.15,1),(.98,10),(.99,14) is rounded. Wildness0.75 requiresAnimals8. TrainabilityNone still allows Tameness; selected normalHare/Deer cannot learn obedience/hauling/combat from that base category.';sources=@((Source "$r/RimWorld.StatWorker_MinimumHandlingSkill.cs"),(Source "$r/RimWorld.TrainableUtility.cs" 66 69),(Source "$r/RimWorld.Pawn_TrainingTracker.cs" 106 164));xml=@('AX04','AX05','AX06','AX09')}
)
$specs=@(
 @('AX01','Data/Core/Defs/Stats/Stats_Pawns_Social.xml','/Defs/StatDef[defName="TameAnimalChance" or defName="TrainAnimalChance"]'),
 @('AX02','Data/Core/Defs/ThingDefs_Items/Items_Resource_RawPlant.xml','/Defs/ThingDef[@Name="PlantFoodRawBase" or defName="RawRice" or defName="Hay"]'),
 @('AX03','Data/Core/Defs/Stats/Stats_Pawns_General.xml','/Defs/StatDef[defName="MaxNutrition" or defName="MinimumHandlingSkill"]'),
 @('AX04','Data/Core/Defs/ThingDefs_Races/Races_Animal_Hares.xml','/Defs/ThingDef[@Name="BaseHare" or defName="Hare"]'),
 @('AX05','Data/Core/Defs/ThingDefs_Races/Races_Animal_PigGroup.xml','/Defs/ThingDef[defName="Deer"]'),
 @('AX06','Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml','/Defs/ThingDef[@Name="AnimalThingBase" or @Name="BasePawn"]'),
 @('AX07','Data/Core/Defs/Misc/LifeStageDefs/LifeStages.xml','/Defs/LifeStageDef[defName="AnimalBaby" or defName="AnimalJuvenile" or defName="AnimalAdult"]'),
 @('AX08','Data/Core/Defs/ThinkTreeDefs/Animal.xml','/Defs/ThinkTreeDef[defName="Animal"]//li[@Class="ThinkNode_ConditionalHasFaction"]/subNodes/li[@Class="ThinkNode_ChancePerHour_Mate"]'),
 @('AX09','Data/Core/Defs/TrainableDefs/Trainables.xml','/Defs/TrainableDef[defName="Tameness" or defName="Obedience" or defName="Release" or defName="Haul" or defName="Rescue"]'),
 @('AX10','Data/Core/Defs/HediffDefs/Hediffs_Global_Needs.xml','/Defs/HediffDef[defName="Malnutrition"]'),
 @('AX11','Data/Core/Defs/HediffDefs/Hediffs_Global_Misc.xml','/Defs/HediffDef[defName="Pregnant"]'),
 @('AX12','Data/Core/Defs/ThingDefs_Plants/Plants_Wild_General.xml','/Defs/ThingDef[defName="Plant_Grass"]'),
 @('AX13','Data/Core/Defs/ThingDefs_Plants/Plants_Bases.xml','/Defs/ThingDef[@Name="PlantBase" or @Name="PlantBaseNonEdible"]')
)
$keep=@('defName','defaultBaseValue','minValue','skillNeedFactors','capacityFactors','workerClass','parts','bodySizeFactor','foodMaxFactor','healthScaleFactor','hungerRateFactor','reproductive','developmentalStage','initialSeverity','lethalSeverity','preventsPregnancy','pregnant','hediffClass','stages','requiredTrainability','steps','prerequisites','trainableTags','subNodes','stackLimit')
$nested=@{
 statBases=@('Nutrition','Wildness');race=@('hasGenders','trainability','foodType','baseBodySize','baseHungerRate','baseHealthScale','mateMtbHours','gestationPeriodDays','litterSizeCurve','lifeExpectancy','roamMtbDays','lifeStageAges');ingestible=@('foodType','preferability','maxNumToIngestAtOnce');plant=@('fertilityMin','fertilitySensitivity','growDays','maxGrowthTemperature')
}
$xml=@(foreach($spec in $specs){
 $path=Join-Path $GameRoot $spec[1];$doc=[xml](Get-Content -LiteralPath $path -Raw);$nodes=$doc.SelectNodes($spec[2])
 if(!$nodes.Count){throw "Empty XPath $($spec[0])"}
 $selected=@(foreach($node in $nodes){
  $copy=$node.CloneNode($false)
  foreach($child in $node.ChildNodes){
   if($child.LocalName -in $keep){[void]$copy.AppendChild($child.CloneNode($true))}
   elseif($nested.ContainsKey($child.LocalName)){
    $subcopy=$child.CloneNode($false)
    foreach($sub in $child.ChildNodes){
     if($sub.LocalName -in $nested[$child.LocalName]){
      $value=$sub.CloneNode($true)
      # Life-stage sound paths are irrelevant to the mechanism projection.
      foreach($sound in @($value.SelectNodes('.//*[starts-with(local-name(),"sound")]'))){[void]$sound.ParentNode.RemoveChild($sound)}
      [void]$subcopy.AppendChild($value)
     }
    }
    [void]$copy.AppendChild($subcopy)
   }
  }
  $copy.OuterXml
 })
 [ordered]@{id=$spec[0];file=$spec[1];source_sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();xpath=$spec[2];projection='Original element attributes and selected gameplay children only; not the complete selected node';nodes=$selected}
})
$reproPublic=[ordered]@{
 evidence_id=$repro.evidence_id;version_text=$repro.version;source='Assembly-CSharp.dll';source_sha256=$repro.source_sha256;engine=$repro.engine;engine_version=$repro.engine_version;engine_sha256=$repro.engine_sha256;mvid=$repro.mvid;rea_artifact_evidence=$repro.rea_artifact_evidence;rea_summary_evidence=$repro.rea_summary_evidence;kind=$repro.kind;limitations=$repro.limitations
 types=@($repro.types|ForEach-Object{[ordered]@{type=$_.type;local_file="$r/$($_.file)";sha256=$_.sha256;lines=$_.lines}})
 xml=@($repro.xml|ForEach-Object{[ordered]@{source=$_.source;local_file="$r/$($_.file)";sha256=$_.sha256}})
}
WriteJson 'animal-husbandry-reproduction-manifest.json' $reproPublic
$rea=Get-Content (Join-Path $root "$r/rea-members-summary.json") -Raw|ConvertFrom-Json
$e=[ordered]@{
 evidence_id='RW17-ANIMAL-HUSBANDRY-MECHANISMS';date_local='2026-11-04';version_text=$manifest.version_text;source_sha256=$manifest.source_sha256
 kind='Static derived C# and projected Core XML; native observations separate';manifest='animal-husbandry-manifest.json';reproduction_manifest='animal-husbandry-reproduction-manifest.json';types='animal-husbandry-types.json'
 claims=$claims;xml=$xml
 rea_members=[ordered]@{source_file="$r/rea-members-summary.json";sha256=(Get-FileHash (Join-Path $root "$r/rea-members-summary.json")).Hash.ToLowerInvariant();evidence_id=$rea.evidence_id;parent_evidence_id=$rea.normalized_result.parent_evidence_id;status='unavailable';reason='Managed metadata exceeds the67108864byte representation budget; zero returned members is not absence evidence'}
 native_runtime_report='../89-native-animal-husbandry-runtime.md'
 limitations=@('Derived C# is not original source.','Core XML inheritance and C# defaults are interpreted for selected ordinaryHare/Deer; no full effective modded Def database resolution.','27 retained type records across two extraction sets include duplicate TrainableUtility, hence26 distinct type names; reused earlier groups provide additional source pointers.','REA artifact identity succeeded; selected managed member view was unavailable. ILSpy fallback is the source of mechanism reconstruction.','Only native tame success using developer-granted Inspired_Taming is observed. Feeding/grazing, breeding, birth, failure, revenge and maintenance mechanisms remain static evidence.','No statistical calibration; Web shortened durations or simplified rules must be labeled provisional adaptations.')
}
WriteJson 'animal-husbandry-evidence.json' $e
"$($claims.Count) claims; $($xml.Count) XML selections; $($manifest.types.Count)+$($reproPublic.types.Count) type records."
