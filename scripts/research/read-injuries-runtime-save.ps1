param([Parameter(Mandatory=$true)][string]$SavePath)
# Read-only XML summary; never executes target assemblies or sends game input.
# Numeric omissions retain presence; ordinary numeric defaults use zero and
# tendTicksLeft uses its source default -1. tendQuality=0 is the source
# CompExposeData default, not standalone proof of treatment. Tend fields on
# non-tendable hediffs are only placeholders with present=false, not game state.
$ErrorActionPreference='Stop'
$s=[xml](Get-Content -Raw -LiteralPath $SavePath)
function Num($node){if($null -eq $node){return 0.0};[double]::Parse($node.InnerText,[Globalization.CultureInfo]::InvariantCulture)}
function NumericField($parent,$name,[double]$default=0.0){$n=$parent.SelectSingleNode($name);[ordered]@{value=if($null -eq $n){$default}else{Num $n};present=($null -ne $n)}}
function Stack($node){if($node.SelectSingleNode('stackCount')){return [int]$node.stackCount};1}
function Pawn($id){
 $p=$s.SelectSingleNode("//thing[id='$id']");if(!$p){throw "Missing pawn $id"};$d=$p.SelectSingleNode('jobs/curDriver');$m=$p.SelectSingleNode('skills/skills/li[def="Medicine"]')
 [ordered]@{id=$id;nick=[string]$p.name.nick;pos=[string]$p.pos;health_state_explicit=[string]$p.healthTracker.healthState;medical_care=[string]$p.playerSettings.medCare
 hediffs=@($p.SelectNodes('healthTracker/hediffSet/hediffs/li')|ForEach-Object{[ordered]@{id=[int]$_.loadID;class=[string]$_.Class;def=[string]$_.def;severity=(Num $_.SelectSingleNode('severity'));age_ticks=(Num $_.SelectSingleNode('ageTicks'));tick_added=(Num $_.SelectSingleNode('tickAdded'));body=[string]$_.part.body;part_index=(NumericField $_ 'part/index');permanent=([string]$_.isPermanent -eq 'True');tend_quality=(NumericField $_ 'tendQuality');tend_ticks_left=(NumericField $_ 'tendTicksLeft' -1)}})
 job=[ordered]@{def=[string]$p.jobs.curJob.def;target_a=[string]$p.jobs.curJob.targetA;target_b=[string]$p.jobs.curJob.targetB;player_forced=([string]$p.jobs.curJob.playerForced -eq 'True');driver=[string]$d.Class;toil_index=(Num $d.SelectSingleNode('curToilIndex'));ticks_left=(Num $d.SelectSingleNode('ticksLeftThisToil'));start_tick=(Num $d.SelectSingleNode('startTick'))}
 carried=@($p.SelectNodes('carryTracker/innerContainer/innerList/li')|ForEach-Object{[ordered]@{id=[string]$_.id;def=[string]$_.def;count=(Stack $_)}})
 medicine_skill=[ordered]@{level=(NumericField $m 'level');xp_since_level=(NumericField $m 'xpSinceLastLevel');xp_since_midnight=(NumericField $m 'xpSinceMidnight')}
 work_priority_values=@($p.SelectNodes('workSettings/priorities/vals/li')|ForEach-Object{[int]$_.InnerText})}
}
$medicines=@($s.SelectNodes('//*[id and (def="MedicineHerbal" or def="MedicineIndustrial" or def="MedicineUltratech")]')|ForEach-Object{[ordered]@{id=[string]$_.id;def=[string]$_.def;count=(Stack $_);pos=[string]$_.pos;forbidden=([string]$_.forbidden -eq 'True')}}|Sort-Object {$_.id})
$beds=@($s.SelectNodes('//thing[def="Bed"]')|ForEach-Object{[ordered]@{id=[string]$_.id;pos=[string]$_.pos;medical=([string]$_.medical -eq 'True');spawned_tick=[int]$_.spawnedTick}})
[ordered]@{file=(Split-Path -Leaf $SavePath);sha256=(Get-FileHash -LiteralPath $SavePath -Algorithm SHA256).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $SavePath).Length;version=$s.SelectSingleNode('//meta/gameVersion').InnerText;mods=@($s.SelectNodes('//meta/modIds/li')|ForEach-Object{$_.InnerText});tick=[int]$s.SelectSingleNode('//tickManager/ticksGame').InnerText;patient=(Pawn 'Human965');doctor=(Pawn 'Human958');medicines=$medicines;beds=$beds;scope='Read-only explicit XML. Numeric omission presence retained where relevant; tendQuality omitted means serialized default zero, confirmed by UI. Work priority index semantics and computed bleeding are not inferred from XML.'}|ConvertTo-Json -Depth 20
