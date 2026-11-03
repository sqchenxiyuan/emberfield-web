param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld')
# Read packaged XML and retained static reconstructions. Never load game code.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence'
$manifest=Get-Content (Join-Path $out 'weather-manifest.json') -Raw|ConvertFrom-Json
function Source([string]$file,[int]$start=1,[int]$end=0){
 $path=Join-Path $root $file;$lines=Get-Content -LiteralPath $path
 if(!$end -or $end -eq ($lines.Count+1)){$end=$lines.Count}
 if($start -lt 1 -or $end -gt $lines.Count -or $end -lt $start){throw "Invalid range: $file"}
 [ordered]@{file=$file;sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();lines=@($start,$end)}
}
$p='.local-research/weather'
$claims=@(
 [ordered]@{id='WE01';finding='Weather selection combines biome commonality, rainfall curves, temperature and game-condition filters. Large fire danger shortens current duration threshold and raises rain weights; it does not guarantee immediate rain.';sources=@((Source "$p/RimWorld.WeatherDecider.cs"),(Source "$p/RimWorld.FireWatcher.cs"));xml=@('XML01','XML02')},
 [ordered]@{id='WE02';finding='WeatherManager interpolates rates and movement/accuracy factors over4000ticks. Perceived label switches at priority-dependent fractions, while CurWeatherLerped switches at.5; workers handle overlays and events separately.';sources=@((Source "$p/RimWorld.WeatherManager.cs" 14 180),(Source "$p/Verse.WeatherWorker.cs" 29 95),(Source '.local-research/economy/Verse.Map.cs' 1068 1106));xml=@('XML01')},
 [ordered]@{id='WE03';finding='Pawn base movement time uses weather only when the current cell is unroofed. PathGrid takes the maximum terrain/object/snow surcharge; PathFollower adds this cost to base movement. Snow category thresholds and speed effects are separate from instantaneous precipitation.';sources=@((Source '.local-research/preservation/Verse.Pawn.cs' 1971 2013),(Source "$p/Verse.AI.PathGrid.cs" 121 178),(Source "$p/Verse.AI.Pawn_PathFollower.cs" 746 812),(Source "$p/Verse.WeatherBuildupUtility.cs" 5 64));xml=@('XML01')},
 [ordered]@{id='WE04';finding='SteadyEnvironmentEffects visits a fraction of map cells each tick. Unroofed outdoor-temperature cells receive noise-modulated snow; temperature melts accumulated snow. SnowGrid clamps depth and refreshes paths on category changes; large pawns reduce depth slightly when entering cells.';sources=@((Source "$p/RimWorld.SteadyEnvironmentEffects.cs" 57 177),(Source "$p/RimWorld.SteadyEnvironmentEffects.cs" 207 238),(Source "$p/Verse.SnowGrid.cs"),(Source "$p/Verse.AI.Pawn_PathFollower.cs" 650 654));xml=@('XML01')},
 [ordered]@{id='WE05';finding='ShotReport applies weather accuracy when either shooter or target cell is unroofed, except equipment that ignores accuracy maluses. It is one factor in the shot calculation, not final hit probability.';sources=@((Source '.local-research/combat/Verse.ShotReport.cs' 58 73),(Source '.local-research/combat/Verse.ShotReport.cs' 83 123));xml=@('XML01')},
 [ordered]@{id='WE06';finding='RainRate and roof vulnerability feed Fire extinguishing damage; snow Defs also have rainRate1. Thunderstorm event makers roll strength-scaled chances and lightning chooses an unroofed standable cell for flame explosion.';sources=@((Source '.local-research/fire/RimWorld.Fire.cs' 312 352),(Source "$p/Verse.WeatherEventMaker.cs"),(Source "$p/RimWorld.WeatherEvent_LightningStrike.cs"));xml=@('XML01')},
 [ordered]@{id='WE07';finding='Solar output uses sky glow and unroofed occupied-cell fraction. Weather glow is min(celestial glow,maxGlow), separately from visual sky colors. Ordinary Core rain/fog lack a maxGlow override; Odyssey Overcast explicitly caps.95.';sources=@((Source "$p/Verse.WeatherDef.cs" 43 59),(Source "$p/Verse.WeatherWorker.cs" 98 131),(Source "$p/Verse.SkyManager.cs" 40 46),(Source "$p/Verse.SkyManager.cs" 141 171),(Source "$p/RimWorld.CompPowerPlantSolar.cs"),(Source '.local-research/energy/Verse.GlowGrid.cs' 248 267));xml=@('XML01','XML03','XML06')},
 [ordered]@{id='WE08';finding='Pawn_MindState uses CurWeatherLerped weatherThought every120hash ticks for eligible mood-bearing flesh pawns. Single-stage wet thought requires no roof and persists as memory; outdoor recreation eligibility also rejects rainRate>=.25.';sources=@((Source '.local-research/prisoners/Verse.AI.Pawn_MindState.cs' 534 587),(Source '.local-research/mood-recreation/RimWorld.JoyUtility.cs' 16 46));xml=@('XML01','XML04')},
 [ordered]@{id='WE09';finding='Exposed rainWashes filth can lose a layer during environmental cell visits. Exposed item deterioration environmental factors are multiplied by lerp(1,5,RainRate), while a protective edifice can suppress deterioration. This is HP deterioration rather than food rot.';sources=@((Source "$p/RimWorld.SteadyEnvironmentEffects.cs" 118 141),(Source "$p/RimWorld.SteadyEnvironmentEffects.cs" 197 205),(Source "$p/RimWorld.SteadyEnvironmentEffects.cs" 314 343),(Source '.local-research/weapons/RimWorld.StatPart_EnvironmentalEffects.cs' 16 46));xml=@('XML05')},
 [ordered]@{id='WE10';finding='The rain short-circuit caller checks97tick intervals, probabilistic gates, a colonist electrical-fire candidate list and an unroofed selected building before calling TryShortCircuitInRain. This is separate from the conduit electrical incident.';sources=@((Source "$p/RimWorld.SteadyEnvironmentEffects.cs" 57 66),(Source "$p/RimWorld.SteadyEnvironmentEffects.cs" 349 360),(Source '.local-research/fire/RimWorld.ShortCircuitUtility.cs' 90 109));xml=@()},
 [ordered]@{id='WE11';finding='Developer Change weather calls WeatherManager.TransitionTo directly. The native experiment used this preparation, then ordinary speed, pause, hover, Needs and save UI; it does not measure natural weather occurrence.';sources=@((Source "$p/Verse.DebugActionsMisc.cs" 223 235),(Source "$p/RimWorld.WeatherManager.cs" 138 150));xml=@('XML01')}
)
$specs=@(
 @('XML01','Data/Core/Defs/WeatherDefs/Weathers.xml','/Defs/WeatherDef[defName="Clear" or defName="Fog" or defName="Rain" or defName="DryThunderstorm" or defName="RainyThunderstorm" or defName="FoggyRain" or defName="SnowHard" or defName="SnowGentle"]/*[self::defName or self::repeatable or self::durationRange or self::favorability or self::temperatureRange or self::commonalityRainfallFactor or self::perceivePriority or self::rainRate or self::snowRate or self::windSpeedFactor or self::windSpeedOffset or self::moveSpeedMultiplier or self::accuracyMultiplier or self::maxGlow or self::weatherThought or self::eventMakers]'),
 @('XML02','Data/Core/Defs/BiomeDefs/Biomes_Temperate.xml','/Defs/BiomeDef[defName="TemperateForest"]/defName | /Defs/BiomeDef[defName="TemperateForest"]/baseWeatherCommonalities'),
 @('XML03','Data/Core/Defs/ThingDefs_Buildings/Buildings_Power.xml','/Defs/ThingDef[defName="SolarGenerator"]/defName | /Defs/ThingDef[defName="SolarGenerator"]/comps/li[@Class="CompProperties_Power"]'),
 @('XML04','Data/Core/Defs/ThoughtDefs/Thoughts_Memory_Misc.xml','/Defs/ThoughtDef[defName="SoakingWet"]'),
 @('XML05','Data/Core/Defs/Stats/Stats_Basics_General.xml','/Defs/StatDef[defName="DeteriorationRate"]/defName | /Defs/StatDef[defName="DeteriorationRate"]/parts/li[@Class="StatPart_EnvironmentalEffects"]'),
 @('XML06','Data/Odyssey/Defs/WeatherDefs/Weathers.xml','/Defs/WeatherDef[defName="Overcast"]/defName | /Defs/WeatherDef[defName="Overcast"]/maxGlow')
)
$xml=@(foreach($spec in $specs){
 $path=Join-Path $GameRoot $spec[1];$doc=[xml](Get-Content -LiteralPath $path -Raw);$nodes=$doc.SelectNodes($spec[2])
 if(!$nodes.Count){throw "Empty XPath $($spec[0])"}
 [ordered]@{id=$spec[0];file=$spec[1];source_sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();xpath=$spec[2];nodes=@($nodes|ForEach-Object OuterXml)}
})
$e=[ordered]@{
 evidence_id='RW17-WEATHER-EXPOSURE-OPERATIONS';date_local='2026-11-04';version_text=$manifest.version_text;source_sha256=$manifest.source_sha256
 kind='Static derived managed-code reconstruction plus selected packaged XML; native observations separate'
 artifact_identity='artifact-identity.json';manifest='weather-manifest.json';types='weather-types.json';claims=$claims;xml=$xml
 native_runtime_report='../83-native-weather-runtime.md'
 limitations=@('Derived C# is not original source.','Selected packaged XML does not resolve all inheritance or active-mod patches.','Core ordinary rain visual darkening must not be treated as a proven solar-output reduction.','Native Rain was prepared with developer UI; no natural distribution, snow, movement, gunfire, solar, rain-extinguishing or rain-short-circuit measurement.','Weather numbers are static reference parameters, not calibration targets for the Web simulation.')
}
[IO.File]::WriteAllText((Join-Path $out 'weather-evidence.json'),($e|ConvertTo-Json -Depth 14).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($claims.Count) claims; $($xml.Count) XML selections; $($manifest.types.Count) types."
