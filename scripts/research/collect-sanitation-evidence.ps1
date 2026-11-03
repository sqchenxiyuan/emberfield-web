param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld')
# Read packaged XML and previously derived C# only. Does not execute game code.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence'
$manifest=Get-Content (Join-Path $out 'hygiene-manifest.json') -Raw|ConvertFrom-Json
function Source([string]$file,[int]$start=1,[int]$end=0){
 $path=Join-Path $root $file; $lines=Get-Content -LiteralPath $path
 if(!$end){$end=$lines.Count}
 if($end -eq ($lines.Count+1)){$end=$lines.Count} # Extractor counts the trailing empty LF line.
 if($start -lt 1 -or $end -gt $lines.Count -or $end -lt $start){throw "Invalid range: $file"}
 [ordered]@{file=$file;sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();lines=@($start,$end)}
}
$p='.local-research/hygiene'
$claims=@(
 [ordered]@{id='HY01';finding='Movement can pick up, drop and generate filth; terrain acceptance and same-type thickening are separate from a universal dirt timer.';sources=@((Source "$p/RimWorld.Pawn_FilthTracker.cs" 81 232),(Source "$p/RimWorld.FilthMaker.cs"),(Source "$p/RimWorld.Filth.cs"));xml=@('XML01')},
 [ordered]@{id='HY02';finding='Room cleanliness averages eligible contained/adjacent thing stats and room terrain over cell count. The worker multiplies stackCount, not Filth.thickness.';sources=@((Source '.local-research/environment/RimWorld.RoomStatWorker_Cleanliness.cs'),(Source "$p/RimWorld.Filth.cs"));xml=@('XML01','XML02','XML03')},
 [ordered]@{id='HY03';finding='Cooking reads the cooks room FoodPoisonChance. ProperRoom and region-count gating cause ordinary open outdoor rooms to return roomlessScore rather than map-wide filth average.';sources=@((Source '.local-research/environment/Verse.Room.cs' 536 553),(Source '.local-research/environment/Verse.Room.cs' 823 834),(Source '.local-research/environment/Verse.Room.cs' 859 879),(Source '.local-research/technology/RimWorld.RoomStatWorker_FromStatByCurve.cs'),(Source "$p/RimWorld.CompFoodPoisonable.cs" 36 46));xml=@('XML02')},
 [ordered]@{id='HY04';finding='Cleaning candidates and forced jobs require Home area; recently thickened filth waits 600 ticks. Cleaning reserves, walks and reduces layers with terrain-adjusted work; leaving Home invalidates targets.';sources=@((Source "$p/RimWorld.ListerFilthInHomeArea.cs"),(Source "$p/RimWorld.WorkGiver_CleanFilth.cs"),(Source "$p/RimWorld.JobDriver_CleanFilth.cs"));xml=@('XML01','XML04','XML05')},
 [ordered]@{id='HY05';finding='Recipe production checks kitchen risk first and cook risk only on failure; a successful check marks the produced stack poisonPct=1. Each product entry is one Thing and one notification.';sources=@((Source "$p/RimWorld.CompFoodPoisonable.cs" 15 46),(Source '.local-research/food/Verse.GenRecipe.cs' 9 38),(Source '.local-research/preservation/Verse.ThingWithComps.cs' 815 824));xml=@('XML02','XML06','XML07','XML08')},
 [ordered]@{id='HY06';finding='Split preserves poison percentage and cause. Merge weights by actual absorbed count. Ingestion rolls the stored percentage multiplied by the eater factor.';sources=@((Source "$p/RimWorld.CompFoodPoisonable.cs" 21 73),(Source '.local-research/food/RimWorld.FoodUtility.cs' 1352 1379));xml=@()},
 [ordered]@{id='HY07';finding='Food poisoning starts severity 1, decreases naturally, progresses initial-major-recovering and is removed at severity <=0. Its Core Def is not tendable.';sources=@((Source '.local-research/combat/Verse.HediffComp_SeverityModifierBase.cs'),(Source '.local-research/combat/Verse.HediffComp_SeverityPerDay.cs'),(Source '.local-research/survival/Verse.Hediff.cs' 177 177),(Source '.local-research/survival/Verse.Hediff.cs' 322 336),(Source '.local-research/survival/Verse.HediffDef.cs' 34 34));xml=@('XML09')},
 [ordered]@{id='HY08';finding='A repeated poisoning event does not stack a second illness; an existing non-initial illness is reset to severity .799 while initial stage is unchanged.';sources=@((Source '.local-research/food/RimWorld.FoodUtility.cs' 1332 1349));xml=@('XML09')},
 [ordered]@{id='HY09';finding='Vomit is an intermittent interrupting job with resume requested; it stops movement, creates vomit filth and can remove food need, creating further cleaning work.';sources=@((Source '.local-research/survival/Verse.Hediff.cs' 478 481),(Source "$p/RimWorld.JobDriver_Vomit.cs"));xml=@('XML01','XML09','XML10')},
 [ordered]@{id='HY10';finding='Dangerous food-type poisoning is a separate ingestion path from contaminated cooked stacks; eater factor includes difficulty, health-stage and applicable DLC modifiers.';sources=@((Source '.local-research/food/Verse.Thing.cs' 2137 2141),(Source '.local-research/food/RimWorld.FoodUtility.cs' 1352 1379));xml=@('XML03')}
)
$specs=@(
 @('XML01','Data/Core/Defs/ThingDefs_Misc/Filth_Various.xml','/Defs/ThingDef[@Name="BaseFilth" or defName="Filth_Dirt" or defName="Filth_Blood" or defName="Filth_Vomit"]'),
 @('XML02','Data/Core/Defs/Rooms/RoomStats.xml','/Defs/RoomStatDef[defName="Cleanliness" or defName="FoodPoisonChance"]'),
 @('XML03','Data/Core/Defs/Stats/Stats_Basics_General.xml','/Defs/StatDef[defName="Cleanliness" or defName="FoodPoisonChanceFixedHuman"]'),
 @('XML04','Data/Core/Defs/WorkGiverDefs/WorkGivers.xml','/Defs/WorkGiverDef[defName="CleanFilth"]'),
 @('XML05','Data/Core/Defs/JobDefs/Jobs_Work.xml','/Defs/JobDef[defName="Clean"]'),
 @('XML06','Data/Core/Defs/Stats/Stats_Pawns_WorkRecipes.xml','/Defs/StatDef[defName="FoodPoisonChance"]'),
 @('XML07','Data/Core/Defs/ThingDefs_Items/Items_Food.xml','/Defs/ThingDef[@Name="MealBaseIngredientless" or @Name="MealBase" or defName="MealSimple"]'),
 @('XML08','Data/Core/Defs/RecipeDefs/Recipes_Meals.xml','/Defs/RecipeDef[defName="CookMealSimple" or defName="CookMealSimpleBulk"]'),
 @('XML09','Data/Core/Defs/HediffDefs/Hediffs_Global_Misc.xml','/Defs/HediffDef[@Name="DiseaseBase" or defName="FoodPoisoning"]'),
 @('XML10','Data/Core/Defs/JobDefs/Jobs_Misc.xml','/Defs/JobDef[defName="Vomit"]')
)
$xml=@(foreach($spec in $specs){
 $path=Join-Path $GameRoot $spec[1];$doc=[xml](Get-Content -LiteralPath $path -Raw);$nodes=$doc.SelectNodes($spec[2])
 if(!$nodes.Count){throw "Empty XPath $($spec[0])"}
 [ordered]@{id=$spec[0];file=$spec[1];source_sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();xpath=$spec[2];nodes=@($nodes|ForEach-Object OuterXml)}
})
$e=[ordered]@{
 evidence_id='RW17-SANITATION-FOOD-POISONING';date_local='2026-11-04';version_text=$manifest.version_text;source_sha256=$manifest.source_sha256
 kind='Static derived managed-code reconstruction plus selected shipped Core XML; native observation separate'
 artifact_identity='artifact-identity.json';manifest='hygiene-manifest.json';types='hygiene-types.json';claims=$claims;xml=$xml
 native_runtime_report='../77-native-sanitation-runtime.md'
 limitations=@('Derived ILSpy C# is not original source.','Selected packaged XML is not an effective runtime Def database; inheritance and mod patches are not globally resolved.','Native run validates one ordinary clean job, not kitchen probabilities, layer work timing, disease duration or cure behavior.','Capacity post-factors are not direct final movement-speed multipliers.','Deterministic Web random streams and accelerated illness duration are design choices, not original code claims.')
}
[IO.File]::WriteAllText((Join-Path $out 'hygiene-evidence.json'),($e|ConvertTo-Json -Depth 14).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($claims.Count) claims; $($xml.Count) XML selections; $($manifest.types.Count) types."
