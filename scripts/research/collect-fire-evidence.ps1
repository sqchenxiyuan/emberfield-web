param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld')
# Read packaged XML and previously derived managed code; never execute game code.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$out=Join-Path $root 'docs/research/rimworld/evidence'
$manifest=Get-Content (Join-Path $out 'fire-manifest.json') -Raw|ConvertFrom-Json
function Source([string]$file,[int]$start=1,[int]$end=0){
 $path=Join-Path $root $file;$lines=Get-Content -LiteralPath $path
 if(!$end -or $end -eq ($lines.Count+1)){$end=$lines.Count}
 if($start -lt 1 -or $end -gt $lines.Count -or $end -lt $start){throw "Invalid range: $file"}
 [ordered]@{file=$file;sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();lines=@($start,$end)}
}
$p='.local-research/fire'
$claims=@(
 [ordered]@{id='FI01';finding='Fire is an independent entity, static or pawn-attached, with size and age. Fuel availability and maximum flammability govern persistence and growth; damage selects one eligible target per complex calculation.';sources=@((Source "$p/RimWorld.Fire.cs" 8 212),(Source "$p/RimWorld.Fire.cs" 238 334));xml=@('XML01','XML02')},
 [ordered]@{id='FI02';finding='Ignition rejects existing fire, blocked multi-cell interiors and fire-blocking filth. Terrain uses top and foundation flammability; TryStartFireIn tests positive eligibility without its own random roll.';sources=@((Source "$p/RimWorld.FireUtility.cs" 19 127),(Source "$p/RimWorld.FireUtility.cs" 206 244),(Source '.local-research/food/Verse.Thing.cs' 152 178));xml=@('XML02','XML08')},
 [ordered]@{id='FI03';finding='Size above 1 enables individual short or long spread attempts; flame damage, heat, rain exposure and vacuum interact. Rain interval code compares Rand.Value <6, not a 4 percent roll per interval.';sources=@((Source "$p/RimWorld.Fire.cs" 238 412),(Source "$p/Verse.DamageWorker_Flame.cs"));xml=@()},
 [ordered]@{id='FI04';finding='Automatic WorkGiver_FightFires requires Home for static fires even when its forced parameter is true; nearby compatible pawns on fire have a separate outside-Home branch.';sources=@((Source "$p/RimWorld.WorkGiver_FightFires.cs"),(Source "$p/RimWorld.JobDriver_BeatFire.cs"));xml=@('XML03','XML04')},
 [ordered]@{id='FI05';finding='The actual 1.7 right-click path is FloatMenuOptionProvider_ExtinguishFires to ExtinguishFiresNearby: manipulation, firefighting capability, reachability and Allowed area are checked; no Home test. It queues nearby fires and can continue to other reachable reservable fires.';sources=@((Source "$p/RimWorld.FloatMenuOptionProvider_ExtinguishFires.cs"),(Source "$p/RimWorld.JobDriver_ExtinguishFiresNearby.cs"),(Source "$p/RimWorld.FireUtility.cs" 246 283));xml=@('XML04')},
 [ordered]@{id='FI06';finding='Both firefighting drivers repeatedly use native beat-fire verbs. Nominal extinguish damage32 reduces fire size by .32; size below .1 destroys fire; nominal cooldown1.1 seconds is not an observed completion time.';sources=@((Source "$p/RimWorld.Verb_BeatFire.cs"),(Source "$p/Verse.DamageWorker_Extinguish.cs"),(Source "$p/RimWorld.Pawn_NativeVerbs.cs"),(Source "$p/RimWorld.VerbDefsHardcodedNative.cs"));xml=@('XML04')},
 [ordered]@{id='FI07';finding='Ordinary HP repair uses same-faction damaged repairable buildings, Home, reservations and no demolition/mining designation; burning targets are rejected at job selection. The repair driver spends construction work to restore HP without ingredient hauling or consumption.';sources=@((Source "$p/RimWorld.RepairUtility.cs"),(Source "$p/RimWorld.ListerBuildingsRepairable.cs"),(Source "$p/RimWorld.WorkGiver_Repair.cs"),(Source "$p/RimWorld.JobDriver_Repair.cs"));xml=@('XML03','XML05')},
 [ordered]@{id='FI08';finding='Electrical incident selects ordinary PowerConduit on networks with active power sources. Stored battery energy chooses an energy-draining explosion branch; otherwise a nearby eligible visible cell may ignite. Rain short circuit is separate and its caller exposure checks are not traced here.';sources=@((Source "$p/RimWorld.IncidentWorker_ShortCircuit.cs"),(Source "$p/RimWorld.ShortCircuitUtility.cs"));xml=@('XML06','XML07')},
 [ordered]@{id='FI09';finding='Developer Attach Fire was used only for controlled preparation; for the selected wall it calls TryStartFireIn at size1.75, not a spontaneous incident. Subsequent player-ordered firefighting is recorded separately.';sources=@((Source "$p/Verse.DebugToolsMisc.cs" 17 33));xml=@('XML01')},
 [ordered]@{id='FI10';finding='Player artificial building wealth uses MarketValueIgnoreHp, while regular MarketValue has a health curve. HP loss alone therefore must not be treated as native building-wealth depreciation.';sources=@((Source '.local-research/economy/RimWorld.WealthWatcher.cs' 122 138));xml=@('XML09')}
)
$specs=@(
 @('XML01','Data/Core/Defs/ThingDefs_Misc/Things_Special.xml','/Defs/ThingDef[defName="Fire"]'),
 @('XML02','Data/Core/Defs/Stats/Stats_Basics_General.xml','/Defs/StatDef[defName="Flammability"]'),
 @('XML03','Data/Core/Defs/WorkGiverDefs/WorkGivers.xml','/Defs/WorkGiverDef[defName="FightFires" or defName="Repair"]'),
 @('XML04','Data/Core/Defs/JobDefs/Jobs_Misc.xml','/Defs/JobDef[defName="BeatFire" or defName="ExtinguishFiresNearby"]'),
 @('XML05','Data/Core/Defs/JobDefs/Jobs_Work.xml','/Defs/JobDef[defName="Repair"]'),
 @('XML06','Data/Core/Defs/ThingDefs_Buildings/Buildings_Power.xml','/Defs/ThingDef[defName="PowerConduit" or defName="HiddenConduit" or defName="Battery" or defName="WoodFiredGenerator" or defName="PowerSwitch"]/defName | /Defs/ThingDef[defName="PowerConduit" or defName="HiddenConduit" or defName="Battery" or defName="WoodFiredGenerator" or defName="PowerSwitch"]/statBases/Flammability'),
 @('XML07','Data/Core/Defs/ThingDefs_Buildings/Buildings_Temperature.xml','/Defs/ThingDef[defName="Heater" or defName="Cooler"]/defName | /Defs/ThingDef[defName="Heater" or defName="Cooler"]/statBases/Flammability | /Defs/ThingDef[defName="Heater" or defName="Cooler"]/comps/li[@Class="CompProperties_Power"]'),
 @('XML08','Data/Core/Defs/ThingDefs_Misc/Filth_Various.xml','/Defs/ThingDef[defName="Filth_FireFoam"]/defName | /Defs/ThingDef[defName="Filth_FireFoam"]/filth'),
 @('XML09','Data/Core/Defs/Stats/Stats_Basics_General.xml','/Defs/StatDef[defName="MarketValue" or defName="MarketValueIgnoreHp"]')
)
$xml=@(foreach($spec in $specs){
 $path=Join-Path $GameRoot $spec[1];$doc=[xml](Get-Content -LiteralPath $path -Raw);$nodes=$doc.SelectNodes($spec[2])
 if(!$nodes.Count){throw "Empty XPath $($spec[0])"}
 [ordered]@{id=$spec[0];file=$spec[1];source_sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();xpath=$spec[2];nodes=@($nodes|ForEach-Object OuterXml)}
})
$e=[ordered]@{
 evidence_id='RW17-FIRE-FIREFIGHTING-REPAIR';date_local='2026-11-04';version_text=$manifest.version_text;source_sha256=$manifest.source_sha256
 kind='Static derived managed-code reconstruction and selected packaged XML; original-game experiment reported separately'
 artifact_identity='artifact-identity.json';manifest='fire-manifest.json';types='fire-types.json';claims=$claims;xml=$xml
 native_runtime_report='../80-native-firefighting-runtime.md'
 limitations=@('Derived C# is not original source.','Packaged XML selections do not resolve every inheritance or mod patch.','Manual firefighting and automatic WorkGiver forced parameters are different paths.','The native experiment prepared one fire with developer UI; it does not establish incident frequency, exact beat timing or spread probability.','Ordinary repair, battery explosions, rain exposure and building wealth were not measured in the native run.')
}
[IO.File]::WriteAllText((Join-Path $out 'fire-evidence.json'),($e|ConvertTo-Json -Depth 14).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($claims.Count) claims; $($xml.Count) XML selections; $($manifest.types.Count) types."
