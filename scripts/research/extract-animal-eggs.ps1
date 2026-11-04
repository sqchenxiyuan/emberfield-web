param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static managed PE reading only; target code is not loaded or executed.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$output=Join-Path $root '.local-research/animal-eggs'
$manifestFile=Join-Path $root 'docs/research/rimworld/evidence/animal-eggs-manifest.json'
$assembly=Join-Path $GameRoot 'Assembly-CSharp.dll'
$engine=(Resolve-Path (Join-Path $root '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll')).Path
function Digest([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
$assemblyHash=Digest $assembly
$engineHash=Digest $engine
if($assemblyHash -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Assembly identity changed'}
if($engineHash -ne '587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'){throw 'Decompiler identity changed'}
Add-Type -LiteralPath $engine
$settings=[ICSharpCode.Decompiler.DecompilerSettings]::new()
$settings.ThrowOnAssemblyResolveErrors=$false
$decompiler=[ICSharpCode.Decompiler.CSharp.CSharpDecompiler]::new($assembly,$settings)
$utf8=[Text.UTF8Encoding]::new($false)
if(!$Check){[void](New-Item -ItemType Directory -Path $output -Force)}
$records=@(foreach($name in @('RimWorld.CompEggLayer','RimWorld.CompProperties_EggLayer','RimWorld.JobGiver_LayEgg','RimWorld.JobDriver_LayEgg','RimWorld.CompHatcher','RimWorld.CompProperties_Hatcher','RimWorld.CompTemperatureRuinable','RimWorld.CompProperties_TemperatureRuinable','RimWorld.CompRottable','RimWorld.CompProperties_Rottable','RimWorld.JobGiver_Mate','RimWorld.JobDriver_Mate','RimWorld.PawnUtility','Verse.AI.ThinkNode_ChancePerHour_Mate','RimWorld.HungerLevelUtility','RimWorld.LifeStageDef','Verse.Thing','Verse.ThingWithComps','Verse.ThingDef','Verse.GenSpawn','Verse.PawnGenerationRequest','Verse.PawnGenerator','RimWorld.PawnRelationDefOf','RimWorld.StatWorker_MinimumHandlingSkill','RimWorld.Need_Food','Verse.RaceProperties','Verse.Pawn','Verse.AI.ThinkNode_ChancePerHour','RimWorld.CompEggContainer','RimWorld.CompThingContainer','RimWorld.CompProperties_ThingContainer','RimWorld.WorkGiver_EmptyEggBox','RimWorld.JobDriver_EmptyThingContainer','Verse.GenTemperature','Verse.Pawn_CarryTracker','Verse.Pawn_InventoryTracker','Verse.ThingOwner','RimWorld.StatPart_BodySize','RimWorld.StatPart_LifeStageMaxFood','RimWorld.FoodUtility','RimWorld.JobGiver_GetFood','RimWorld.HungerCategory','RimWorld.FoodPreferability')){
 $content=$decompiler.DecompileTypeAsString([ICSharpCode.Decompiler.TypeSystem.FullTypeName]::new($name)).Replace("`r`n","`n")
 if([string]::IsNullOrWhiteSpace($content)){throw "Empty type $name"}
 $path=Join-Path $output ($name+'.cs')
 if($Check){if([IO.File]::ReadAllText($path) -cne $content){throw "Derived type changed: $name"}}
 else{[IO.File]::WriteAllText($path,$content,$utf8)}
 [ordered]@{type=$name;local_file=('.local-research/animal-eggs/'+$name+'.cs');sha256=Digest $path;lines=$content.Split("`n").Count}
})
$manifest=[ordered]@{
 evidence_id='RW17-ANIMAL-EGGS';version_text=(Get-Content (Join-Path $GameRoot 'Version.txt') -Raw).Trim()
 source='Assembly-CSharp.dll';source_sha256=$assemblyHash;engine='ICSharpCode.Decompiler'
 engine_version=[ICSharpCode.Decompiler.CSharp.CSharpDecompiler].Assembly.GetName().Version.ToString();engine_sha256=$engineHash
 kind='Static derived reconstruction; not original source; target code not loaded or executed'
 line_endings='LF';encoding='UTF-8 without BOM'
 limitations=@('Unresolved dependencies are tolerated by ILSpy.','No runtime, enabled-mod, or effective Def database validation.','Line locations apply only to the recorded derived hashes.','No native game, browser, preview, GUI input, or screenshot capture was launched for this milestone.')
 types=$records
}
$text=($manifest|ConvertTo-Json -Depth 12).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($manifestFile) -cne $text){throw 'Retained manifest differs'};"Re-extracted and checked $($records.Count) animal-eggs types"}
else{[IO.File]::WriteAllText($manifestFile,$text,$utf8);"Extracted $($records.Count) animal-eggs types"}
