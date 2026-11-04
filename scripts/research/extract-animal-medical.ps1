param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Only ILSpy metadata/CIL reconstruction. Never load or execute the game DLL.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$output=Join-Path $root '.local-research/animal-medical'
$manifestFile=Join-Path $root 'docs/research/rimworld/evidence/animal-medical-manifest.json'
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
 'Verse.Pawn_HealthTracker','Verse.HealthTuning','Verse.Hediff_Injury','Verse.HediffSet','Verse.Hediff',
 'Verse.HediffComp_TendDuration','Verse.HediffCompProperties_TendDuration','Verse.HediffWithComps',
 'RimWorld.RestUtility','RimWorld.Building_Bed','RimWorld.CompAssignableToPawn_Bed',
 'RimWorld.WorkGiver_RescueDowned','RimWorld.WorkGiver_TakeToBed','RimWorld.HealthAIUtility',
 'RimWorld.FloatMenuOptionProvider_RescuePawn','RimWorld.FloatMenuOptionProvider_DraftedTend',
 'RimWorld.JobDriver_TakeToBed','RimWorld.Toils_Bed','RimWorld.WorkGiver_Tend','RimWorld.WorkGiver_TendOther','RimWorld.WorkGiver_TendOther_Animal',
 'RimWorld.WorkGiver_FeedPatient','RimWorld.FeedPatientUtility','RimWorld.JobDriver_FoodFeedPatient',
 'RimWorld.JobDriver_TendPatient','RimWorld.Toils_Tend','RimWorld.TendUtility',
 'RimWorld.MedicalCareUtility','RimWorld.MedicalCareCategory','RimWorld.Medicine',
 'Verse.AI.Toils_Haul','Verse.Pawn_CarryTracker','Verse.Pawn','Verse.RaceProperties','RimWorld.BuildingProperties',
 'RimWorld.Pawn_PlayerSettings','RimWorld.Pawn_Ownership','RimWorld.Pawn_GuestTracker',
 'RimWorld.JobGiver_PatientGoToBed','RimWorld.PawnCapacityWorker_Moving','RimWorld.PawnCapacityWorker_Consciousness',
 'Verse.PawnCapacitiesHandler','Verse.BodyDef','Verse.BodyPartDef','Verse.BodyPartRecord',
 'RimWorld.LifeStageDef','Verse.Pawn_AgeTracker','Verse.ImmunityHandler','RimWorld.StatPart_Resting','RimWorld.StatPart_BedStat',
 'RimWorld.RelationsUtility','RimWorld.InteractionWorker_RecruitAttempt','Verse.AI.Group.Lord','Verse.AI.Group.LordJob',
 'RimWorld.LordJob_TradeWithColony','RimWorld.TrainableUtility','RimWorld.RecruitUtility',
 'Verse.PawnCapacityDef','RimWorld.PlaySettings'
)
$records=@(foreach($name in $names){
 $content=$decompiler.DecompileTypeAsString([ICSharpCode.Decompiler.TypeSystem.FullTypeName]::new($name)).Replace("`r`n","`n")
 if([string]::IsNullOrWhiteSpace($content)){throw "Empty type $name"}
 $path=Join-Path $output ($name+'.cs')
 if($Check){if([IO.File]::ReadAllText($path) -cne $content){throw "Derived type changed: $name"}}
 else{[IO.File]::WriteAllText($path,$content,$utf8)}
 [ordered]@{type=$name;local_file=('.local-research/animal-medical/'+$name+'.cs');sha256=Digest $path;lines=$content.Split("`n").Count}
})
$manifest=[ordered]@{
 evidence_id='RW17-ANIMAL-MEDICAL';version_text=(Get-Content (Join-Path $GameRoot 'Version.txt') -Raw).Trim()
 source='Assembly-CSharp.dll';source_sha256=$assemblyHash;engine='ICSharpCode.Decompiler'
 engine_version=[ICSharpCode.Decompiler.CSharp.CSharpDecompiler].Assembly.GetName().Version.ToString();engine_sha256=$engineHash
 kind='Static derived reconstruction; not original source; target code not loaded or executed'
 line_endings='LF';encoding='UTF-8 without BOM'
 limitations=@('Unresolved dependencies are tolerated by ILSpy.','No runtime, enabled-mod, or effective Def database validation.','Line locations apply only to the recorded derived hashes.','No game, browser, preview, GUI input or screenshot capture was launched.')
 types=$records
}
$text=($manifest|ConvertTo-Json -Depth 12).Replace("`r`n","`n")+"`n"
if($Check){if([IO.File]::ReadAllText($manifestFile) -cne $text){throw 'Retained manifest differs'};"Re-extracted and checked $($records.Count) animal-medical types"}
else{[IO.File]::WriteAllText($manifestFile,$text,$utf8);"Extracted $($records.Count) animal-medical types"}
