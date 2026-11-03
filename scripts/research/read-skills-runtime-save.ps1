param([string]$SavePath=(Join-Path $PSScriptRoot '../../.local-research/runtime/profile-20261102/Saves/skills-stopped-b.rws'))
# Read-only explicit XML. Reuse the committed container/material reader from43,
# then add skill presence semantics and this experiment's Steel inventory.
$ErrorActionPreference='Stop'
$r=(& (Join-Path $PSScriptRoot 'read-weapons-runtime-save.ps1') -SavePath $SavePath)|ConvertFrom-Json -AsHashtable
$s=[xml](Get-Content -Raw -LiteralPath $SavePath)
function Numeric($parent,[string]$field){$node=$parent.SelectSingleNode($field);[ordered]@{value=if($node){[double]::Parse($node.InnerText,[Globalization.CultureInfo]::InvariantCulture)}else{0.0};present=($null -ne $node)}}
function Skill($node){[ordered]@{def=[string]$node.def;level=(Numeric $node 'level');xp_since_level=(Numeric $node 'xpSinceLastLevel');xp_since_midnight=(Numeric $node 'xpSinceMidnight');passion=if($node.SelectSingleNode('passion')){[string]$node.passion}else{'None'};passion_field_present=($null -ne $node.SelectSingleNode('passion'))}}
$p=$s.SelectSingleNode('//thing[id="Human961"]');$map=$p.ParentNode.ParentNode
$r.worker.skills=@($p.SelectNodes('skills/skills/li')|ForEach-Object{Skill $_})
$r.worker.crafting=Skill ($p.SelectSingleNode('skills/skills/li[def="Crafting"]'))
$r.worker.last_xp_reset_tick=[int]$p.skills.lastXpSinceMidnightResetTimestamp
$r.worker.inspiration_null=([string]$p.mindState.inspirationHandler.curState.IsNull -eq 'True')
$r.worker.traits=@($p.SelectNodes('story/traits/allTraits/li')|ForEach-Object{[string]$_.def})
$r.worker.hediffs=@($p.SelectNodes('healthTracker/hediffSet/hediffs/li')|ForEach-Object{[ordered]@{def=[string]$_.def;severity=(Numeric $_ 'severity')}})
$r.steel=@($map.SelectNodes('.//*[def="Steel" and id]')|ForEach-Object{[ordered]@{id=[string]$_.id;count=if($_.SelectSingleNode('stackCount')){[int]$_.stackCount}else{1};pos=[string]$_.pos;parent=$_.ParentNode.Name;ingredient_of=if($_.ParentNode.Name -eq 'ingredients'){[string]$_.ParentNode.ParentNode.id}else{''};forbidden=([string]$_.forbidden -eq 'True')}}|Sort-Object {$_.id})
$r.steel_total=[int](($r.steel|Measure-Object -Property count -Sum).Sum)
foreach($spot in $r.spots){foreach($bill in $spot.bills){$node=$s.SelectSingleNode('//thing[id="'+$spot.id+'"]/billStack/bills/li[loadID="'+$bill.id+'"]');$bill.allowed_skill_range=[string]$node.allowedSkillRange}}
$r.scope='Read-only explicit XML; active-map material and container reader reused from43. Skill numeric field presence retained; omitted passion is None, omitted numeric skill fields zero. Current-map Steel includes unfinished ingredients, excludes world-pawn inventory. Inspiration curState IsNull retained. No gameplay execution.'
$r|ConvertTo-Json -Depth 28
