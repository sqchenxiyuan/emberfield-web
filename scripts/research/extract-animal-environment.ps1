param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Only ILSpy metadata/CIL reconstruction. Never load or execute the game DLL.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$output=Join-Path $root '.local-research/animal-environment'
$manifestFile=Join-Path $root 'docs/research/rimworld/evidence/animal-environment-manifest.json'
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
$names=@(
 'RimWorld.Fire','RimWorld.FireUtility','Verse.DamageWorker_Flame','Verse.DamageWorker_Extinguish',
 'RimWorld.JobGiver_ExtinguishSelf','RimWorld.JobDriver_ExtinguishSelf','Verse.AI.JobGiver_RunRandom',
 'RimWorld.ThinkNode_ConditionalBurning','RimWorld.JobGiver_SeekSafeTemperature',
 'RimWorld.ThinkNode_ConditionalAnimalWrongSeason','RimWorld.ThinkNode_ConditionalDangerousTemperature','RimWorld.ThinkNode_ConditionalOutdoorTemperature',
 'Verse.AI.JobGiver_ExitMapRandom','Verse.AI.JobGiver_ExitMapBest','Verse.GenTemperature',
 'Verse.HediffGiver_Heat','Verse.HediffGiver_Hypothermia','Verse.Pawn_HealthTracker','Verse.Hediff','Verse.HediffSet',
 'Verse.RaceProperties','RimWorld.PawnUtility','Verse.PawnCapacitiesHandler','RimWorld.PawnCapacityWorker_Consciousness',
 'RimWorld.PawnCapacityWorker_Moving','Verse.Pawn','RimWorld.WorkGiver_FightFires','RimWorld.Verb_BeatFire',
 'RimWorld.WildAnimalSpawner','Verse.AI.JobGiver_Wander','Verse.AI.ThinkNode_Conditional','Verse.MapTemperature','Verse.TemperatureInjuryStage','Verse.PawnCapacityUtility','Verse.HealthUtility','Verse.ThingUtility','RimWorld.StatPart_GearStatOffset','Verse.HediffDef','Verse.AI.JobGiver_ExitMap',
 'Verse.Intelligence','Verse.AttachableThing','Verse.Thing','Verse.CompAttachBase'
)
$records=@(foreach($name in $names){
 $content=$decompiler.DecompileTypeAsString([ICSharpCode.Decompiler.TypeSystem.FullTypeName]::new($name)).Replace("`r`n","`n")
 if([string]::IsNullOrWhiteSpace($content)){throw "Empty type $name"}
 $path=Join-Path $output ($name+'.cs')
 if($Check){if([IO.File]::ReadAllText($path) -cne $content){throw "Derived type changed: $name"}}
 else{[IO.File]::WriteAllText($path,$content,$utf8)}
 [ordered]@{type=$name;local_file=('.local-research/animal-environment/'+$name+'.cs');sha256=Digest $path;lines=$content.Split("`n").Count}
})
$manifest=[ordered]@{
 evidence_id='RW17-ANIMAL-ENVIRONMENT';version_text=(Get-Content (Join-Path $GameRoot 'Version.txt') -Raw).Trim()
 source='Assembly-CSharp.dll';source_sha256=$assemblyHash;engine='ICSharpCode.Decompiler'
 engine_version=[ICSharpCode.Decompiler.CSharp.CSharpDecompiler].Assembly.GetName().Version.ToString();engine_sha256=$engineHash
 kind='Static derived reconstruction; not original source; target code not loaded or executed'
 line_endings='LF';encoding='UTF-8 without BOM'
 limitations=@('Unresolved dependencies are tolerated by ILSpy.','No runtime, enabled-mod, or effective Def database validation.','Line locations apply only to the recorded derived hashes.','No game, browser, preview, GUI input or screenshot capture was launched.')
 types=$records
}
$text=($manifest|ConvertTo-Json -Depth 12).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($manifestFile) -cne $text){throw 'Retained manifest differs'};"Re-extracted and checked $($records.Count) animal-environment types"}
else{[IO.File]::WriteAllText($manifestFile,$text,$utf8);"Extracted $($records.Count) animal-environment types"}
