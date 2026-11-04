param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static managed PE reading only; target code is not loaded or executed.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$output=Join-Path $root '.local-research/animal-milk'
$manifestFile=Join-Path $root 'docs/research/rimworld/evidence/animal-milk-manifest.json'
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
$records=@(foreach($name in @('RimWorld.CompMilkable','RimWorld.CompHasGatherableBodyResource','RimWorld.CompProperties_Milkable','RimWorld.WorkGiver_Milk','RimWorld.WorkGiver_GatherAnimalBodyResources','RimWorld.JobDriver_Milk','RimWorld.JobDriver_GatherAnimalBodyResources','RimWorld.PawnUtility','Verse.Pawn','RimWorld.Need_Food','Verse.AI.Toils_General','Verse.GenPlace','Verse.Thing','RimWorld.LifeStageDef','RimWorld.HungerLevelUtility','Verse.AnimalPenUtility','Verse.RaceProperties','RimWorld.StatWorker_MinimumHandlingSkill','RimWorld.SkillNeed_BaseBonus','RimWorld.SkillNeed_Direct','RimWorld.PawnCapacityFactor','Verse.Rand','Verse.GenMath','RimWorld.CompRottable','Verse.GenTemperature','RimWorld.StockGenerator_Category','Verse.ThingFilter','RimWorld.FoodTypeFlags','RimWorld.StatWorker','Verse.AI.JobDriver','RimWorld.FoodUtility','RimWorld.IngestibleProperties','Verse.ThingDef','RimWorld.BiomeDef','RimWorld.WildAnimalSpawner')){
 $content=$decompiler.DecompileTypeAsString([ICSharpCode.Decompiler.TypeSystem.FullTypeName]::new($name)).Replace("`r`n","`n")
 if([string]::IsNullOrWhiteSpace($content)){throw "Empty type $name"}
 $path=Join-Path $output ($name+'.cs')
 if($Check){if([IO.File]::ReadAllText($path) -cne $content){throw "Derived type changed: $name"}}
 else{[IO.File]::WriteAllText($path,$content,$utf8)}
 [ordered]@{type=$name;local_file=('.local-research/animal-milk/'+$name+'.cs');sha256=Digest $path;lines=$content.Split("`n").Count}
})
$manifest=[ordered]@{
 evidence_id='RW17-ANIMAL-MILK';version_text=(Get-Content (Join-Path $GameRoot 'Version.txt') -Raw).Trim()
 source='Assembly-CSharp.dll';source_sha256=$assemblyHash;engine='ICSharpCode.Decompiler'
 engine_version=[ICSharpCode.Decompiler.CSharp.CSharpDecompiler].Assembly.GetName().Version.ToString();engine_sha256=$engineHash
 kind='Static derived reconstruction; not original source; target code not loaded or executed'
 line_endings='LF';encoding='UTF-8 without BOM'
 limitations=@('Unresolved dependencies are tolerated by ILSpy.','No runtime, enabled-mod, or effective Def database validation.','Line locations apply only to the recorded derived hashes.','No native game, browser, preview, GUI input, or screenshot capture was launched for this milestone.')
 types=$records
}
$text=($manifest|ConvertTo-Json -Depth 12).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($manifestFile) -cne $text){throw 'Retained manifest differs'};"Re-extracted and checked $($records.Count) animal-milk types"}
else{[IO.File]::WriteAllText($manifestFile,$text,$utf8);"Extracted $($records.Count) animal-milk types"}
