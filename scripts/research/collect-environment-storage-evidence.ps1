param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld')
# Read-only analysis of retained derived C# and selected packaged XML; never loads game code.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence'
$manifest=Get-Content (Join-Path $out 'environment-storage-manifest.json') -Raw|ConvertFrom-Json
function Source([string]$file,[int]$start=1,[int]$end=0){
 $path=Join-Path $root $file;$lines=Get-Content -LiteralPath $path
 if(!$end){$end=$lines.Count}
 if($start -lt 1 -or $end -gt $lines.Count -or $end -lt $start){throw "Invalid range: $file $start..$end"}
 [ordered]@{file=$file;sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();lines=@($start,$end)}
}
$p='.local-research/environment-storage'
$claims=@(
 [ordered]@{id='ES01';finding='Ground deterioration is processed on random-order cell visits, gated by item HP eligibility and final stat, then probabilistic one-HP damage. It is distinct from food rot and does not subtract stack quantity per hit.';sources=@((Source '.local-research/weather/RimWorld.SteadyEnvironmentEffects.cs' 57 137),(Source '.local-research/weather/RimWorld.SteadyEnvironmentEffects.cs' 254 342),(Source '.local-research/energy/Verse.ThingDef.cs' 714 732));xml=@('XML01')},
 [ordered]@{id='ES02';finding='Environmental multiplier starts at zero: roof exposure, outdoor-temperature room and terrain add factors, rain multiplies only unroofed items, and protective edifices multiply by zero. A roofed outdoor shelter is not equivalent to enclosed storage.';sources=@((Source '.local-research/weapons/RimWorld.StatPart_EnvironmentalEffects.cs'),(Source "$p/Verse.Room.cs" 99 109),(Source '.local-research/weather/RimWorld.SteadyEnvironmentEffects.cs' 197 205),(Source '.local-research/biomes/Verse.TerrainDef.cs' 180 186));xml=@('XML01','XML10','XML11','XML19','XML20')},
 [ordered]@{id='ES03';finding='Selected resource eligibility and base values follow explicit Core parent declarations and field/stat defaults. Steel, silver and stone blocks disable HP; rock chunks have HP but zero default deterioration rate.';sources=@((Source '.local-research/energy/Verse.ThingDef.cs' 23 31),(Source '.local-research/energy/Verse.ThingDef.cs' 117 125));xml=@('XML01','XML02','XML03','XML04','XML05','XML06','XML07','XML18')},
 [ordered]@{id='ES04';finding='Meat definitions are generated with final HP 60 and base deterioration 6; normal corpses use base rate 1 and pawn base max HP. Selected Hare and Deer parent chains have no max-HP override, so the Core default is 100.';sources=@((Source "$p/RimWorld.ThingDefGenerator_Meat.cs" 23 74),(Source '.local-research/storyteller/RimWorld.ThingDefGenerator_Corpses.cs' 116 163));xml=@('XML01','XML12','XML13','XML14')},
 [ordered]@{id='ES05';finding='Stack absorption averages HP using the actual transferred quantity and rounds upward; splitting copies HP. Component-specific stacking checks can impose extra compatibility rules.';sources=@((Source '.local-research/trade/Verse.Thing.cs' 1553 1642),(Source '.local-research/trade/Verse.ThingWithComps.cs' 555 603),(Source '.local-research/preservation/Verse.ThingUtility.cs' 33 49));xml=@()},
 [ordered]@{id='ES06';finding='Ground apparel and weapons use environmental deterioration and quality factors. Worn apparel uses a separate daily wearPerDay path; carried/equipped gear is not a ground-cell item. Corpses explicitly recurse into worn apparel in the environment caller.';sources=@((Source "$p/RimWorld.Pawn_ApparelTracker.cs" 319 338),(Source "$p/RimWorld.Pawn_ApparelTracker.cs" 407 418),(Source '.local-research/weather/RimWorld.SteadyEnvironmentEffects.cs' 254 265),(Source '.local-research/weather/RimWorld.SteadyEnvironmentEffects.cs' 314 336));xml=@('XML01','XML08','XML09')},
 [ordered]@{id='ES07';finding='Rain only thins exposed filth marked rainWashes. Dirt, blood and vomit opt in; trash and ash do not. Butchery generates the corpse pawn blood Def, not a distinct generic butcher filth. ThinFilth removes one layer and destroys at zero.';sources=@((Source '.local-research/weather/RimWorld.SteadyEnvironmentEffects.cs' 116 136),(Source "$p/RimWorld.Filth.cs" 138 166),(Source '.local-research/hygiene/RimWorld.FilthProperties.cs' 5 20),(Source '.local-research/storyteller/Verse.Corpse.cs' 355 364));xml=@('XML12','XML15')},
 [ordered]@{id='ES08';finding='Wet mood is a weatherThought memory, not a generic rainRate effect. Core rain variants name SoakingWet; Core gentle and hard snow have rainRate 1 but no weatherThought. Roof prevents acquisition, not immediate memory removal.';sources=@((Source '.local-research/prisoners/Verse.AI.Pawn_MindState.cs' 534 587),(Source '.local-research/weather/Verse.WeatherDef.cs' 43 59));xml=@('XML16','XML17')},
 [ordered]@{id='ES09';finding='EnjoyableOutsideNow rejects interpolated rainRate >= 0.25 and additional conditions. Walking checks it at start and during the job; skygazing additionally rejects current Def rainRate > 0.1 at start and has roof/preventSkygaze failure conditions.';sources=@((Source '.local-research/mood-recreation/RimWorld.JoyUtility.cs' 16 52),(Source "$p/RimWorld.JoyGiver_GoForWalk.cs"),(Source "$p/RimWorld.JobDriver_GoForWalk.cs"),(Source "$p/RimWorld.JoyGiver_Skygaze.cs"),(Source "$p/RimWorld.JobDriver_Skygaze.cs" 14 33));xml=@()},
 [ordered]@{id='ES10';finding='The selected horseshoes WatchBuilding chain and common JoyTickCheckEnd do not contain the walking/skygazing rain cancellation. This bounded negative finding does not prove every recreation activity ignores weather.';sources=@((Source "$p/RimWorld.JobDriver_PlayHorseshoes.cs"),(Source "$p/RimWorld.JobDriver_WatchBuilding.cs"),(Source "$p/RimWorld.JoyGiver_WatchBuilding.cs"),(Source "$p/RimWorld.JoyGiver_InteractBuilding.cs" 67 103),(Source "$p/RimWorld.WatchBuildingUtility.cs"),(Source '.local-research/mood-recreation/RimWorld.JoyUtility.cs' 54 107));xml=@()},
 [ordered]@{id='ES11';finding='Native preparation used Spawn full thing stack, which requests stackLimit and nearby placement through ordinary developer UI. Subsequent forbidding, simulation, inspection and saves used ordinary UI; no save editing or code injection.';sources=@((Source "$p/Verse.DebugToolsSpawning.cs" 282 288),(Source "$p/Verse.DebugThingPlaceHelper.cs" 39 89));xml=@('XML02','XML03')}
)
$specs=@(
 @('XML01','Data/Core/Defs/Stats/Stats_Basics_General.xml','/Defs/StatDef[defName="DeteriorationRate" or defName="MaxHitPoints"]'),
 @('XML02','Data/Core/Defs/ThingDefs_Items/Items_Resource_Base.xml','/Defs/ThingDef[@Name="ResourceBase"]'),
 @('XML03','Data/Core/Defs/ThingDefs_Items/Items_Resource_Stuff.xml','/Defs/ThingDef[defName="Silver" or defName="Steel" or defName="WoodLog" or defName="Cloth"]'),
 @('XML04','Data/Core/Defs/ThingDefs_Items/Items_Resource_Manufactured.xml','/Defs/ThingDef[@Name="MedicineBase" or defName="ComponentIndustrial" or defName="MedicineHerbal"]'),
 @('XML05','Data/Core/Defs/ThingDefs_Items/Items_Food.xml','/Defs/ThingDef[@Name="MealBaseIngredientless" or @Name="MealBase" or @Name="MealCooked" or defName="MealSurvivalPack" or defName="MealSimple"]'),
 @('XML06','Data/Core/Defs/ThingDefs_Items/Items_Resource_RawPlant.xml','/Defs/ThingDef[@Name="OrganicProductBase" or @Name="PlantFoodRawBase" or defName="RawRice" or defName="RawPotatoes" or defName="RawCorn"]'),
 @('XML07','Data/Core/Defs/ThingDefs_Misc/Various_Stone.xml','/Defs/ThingDef[@Name="ChunkBase" or @Name="ChunkRockBase" or @Name="StoneBlocksBase" or defName="ChunkGranite" or defName="BlocksGranite"]'),
 @('XML08','Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','/Defs/ThingDef[@Name="ApparelNoQualityBase"]'),
 @('XML09','Data/Core/Defs/ThingDefs_Misc/Weapons/BaseWeapons.xml','/Defs/ThingDef[@Name="BaseWeapon"]'),
 @('XML10','Data/Core/Defs/TerrainDefs/Terrain_Water.xml','/Defs/TerrainDef[extraDeteriorationFactor]'),
 @('XML11','Data/Core/Defs/ThingDefs_Buildings/Buildings_Furniture.xml','/Defs/ThingDef[building/preventDeteriorationOnTop]'),
 @('XML12','Data/Core/Defs/ThingDefs_Races/Races_Animal_Base.xml','/Defs/ThingDef[@Name="BasePawn" or @Name="AnimalThingBase"]'),
 @('XML13','Data/Core/Defs/ThingDefs_Races/Races_Animal_Hares.xml','/Defs/ThingDef[@Name="BaseHare" or defName="Hare"]'),
 @('XML14','Data/Core/Defs/ThingDefs_Races/Races_Animal_PigGroup.xml','/Defs/ThingDef[defName="Deer"]'),
 @('XML15','Data/Core/Defs/ThingDefs_Misc/Filth_Various.xml','/Defs/ThingDef[@Name="BaseFilth" or defName="Filth_Dirt" or defName="Filth_Blood" or defName="Filth_Vomit" or defName="Filth_Trash" or defName="Filth_Ash"]'),
 @('XML16','Data/Core/Defs/WeatherDefs/Weathers.xml','/Defs/WeatherDef[defName="Rain" or defName="RainyThunderstorm" or defName="FoggyRain" or defName="SnowGentle" or defName="SnowHard"]'),
 @('XML17','Data/Core/Defs/ThoughtDefs/Thoughts_Memory_Misc.xml','/Defs/ThoughtDef[defName="SoakingWet"]'),
 @('XML18','Data/Core/Defs/ThingDefs_Items/Items_Exotic.xml','/Defs/ThingDef[@Name="ResourceVerbBase"]'),
 @('XML19','Data/Core/Defs/TerrainDefs/Terrain_Floors.xml','/Defs/TerrainDef[@Name="FloorBase" or defName="WoodPlankFloor"]'),
 @('XML20','Data/Core/Defs/TerrainDefs/Terrain_Natural.xml','/Defs/TerrainDef[@Name="NaturalTerrainBase" or defName="Sand"]')
)
# Retain identity/parent plus only relevant child fields; no art/audio/resource payloads.
$keep='defName|useHitPoints|deteriorateFromEnvironmentalEffects|canDeteriorateUnspawned|stackLimit|category|defaultBaseValue|description|parts|extraDeteriorationFactor|weatherThought|rainRate|snowRate|durationDays|stackLimit|nullifyingPrecepts|stages|filth'
$xml=@(foreach($spec in $specs){
 $path=Join-Path $GameRoot $spec[1];$doc=[xml](Get-Content -LiteralPath $path -Raw);$nodes=$doc.SelectNodes($spec[2])
 if(!$nodes.Count){throw "Empty XPath $($spec[0])"}
 $selected=@(foreach($node in $nodes){
  $copy=$node.CloneNode($false)
  foreach($child in $node.ChildNodes){
   if($child.Name -match ('^('+$keep+')$')){[void]$copy.AppendChild($child.CloneNode($true))}
   elseif($child.Name -in @('statBases','building','race')){
    $nested=$child.CloneNode($false)
    foreach($sub in $child.ChildNodes){if($sub.Name -in @('MaxHitPoints','DeteriorationRate','preventDeteriorationOnTop','bloodDef')){[void]$nested.AppendChild($sub.CloneNode($true))}}
    if($nested.HasChildNodes){[void]$copy.AppendChild($nested)}
   }
  }
  $copy.OuterXml
 })
 [ordered]@{id=$spec[0];file=$spec[1];source_sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();xpath=$spec[2];projection='Original element attributes and selected gameplay children only; not the complete selected node';nodes=$selected}
})
$e=[ordered]@{
 evidence_id='RW17-ENVIRONMENT-STORAGE';date_local='2026-11-04';version_text=$manifest.version_text;source_sha256=$manifest.source_sha256
 kind='Static derived C# and projected packaged XML; native observations separate';manifest='environment-storage-manifest.json';types='environment-storage-types.json'
 claims=$claims;xml=$xml;native_runtime_report='../86-native-environment-storage-runtime.md'
 limitations=@('Derived C# is not original source.','Selected Core parent chains and defaults are manually interpreted; no full active-mod Def database resolution.','Native contrast observes forbidden cloth on an unroofed outdoor cell versus an enclosed roofed room; it does not independently isolate roof, room temperature and flooring.','No natural rain frequency, statistical deterioration-rate calibration, stack-merge runtime, recreation runtime, snow wetness or filth wash runtime measurement.')
}
[IO.File]::WriteAllText((Join-Path $out 'environment-storage-evidence.json'),($e|ConvertTo-Json -Depth 14).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($claims.Count) claims; $($xml.Count) XML selections; $($manifest.types.Count) types."
