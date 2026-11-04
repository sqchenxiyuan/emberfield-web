param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Replays bounded derived-source ranges and original Core XML. Never executes game code.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$base=Join-Path $root 'docs/research/rimworld/evidence'
$dllHash='eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'
$engineHash='587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78'
function Digest([string]$p){(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
function TextDigest([string]$s){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($s))).ToLowerInvariant()}
function LF([string]$s){$s.Replace(([string][char]13+[char]10),[string][char]10)}
if((Digest (Join-Path $GameRoot 'Assembly-CSharp.dll')) -ne $dllHash){throw 'Game assembly changed'}
if((Digest (Join-Path $root '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll')) -ne $engineHash){throw 'Decompiler changed'}
$groups=[Collections.Generic.HashSet[string]]::new()
function Source([string]$group,[string]$type,[int]$start,[int]$end){
 $m=Get-Content (Join-Path $base "$group-manifest.json") -Raw|ConvertFrom-Json
 if($m.source_sha256 -ne $dllHash -or $m.engine_sha256 -ne $engineHash){throw "Mismatched provenance: $group"}
 $entries=@($m.types|Where-Object type -eq $type)
 if($entries.Count -ne 1){throw "Unknown type: $group/$type"}
 $t=$entries[0];$file=Join-Path $root $t.local_file
 if((Digest $file) -ne $t.sha256){throw "Changed source: $file"}
 $lines=[IO.File]::ReadAllText($file).Split([char]10)
 if($lines.Length -ne $t.lines -or $start -lt 1 -or $end -lt $start -or $end -gt $t.lines){throw "Invalid source range: $group/$type"}
 [void]$groups.Add($group)
 [ordered]@{group=$group;type=$type;file=$t.local_file;sha256=$t.sha256;lines=@($start,$end);excerpt_sha256=(TextDigest ($lines[($start-1)..($end-1)] -join [char]10))}
}
$xmlRelative='Data/Core/Defs/RecipeDefs/Recipes_Production.xml'
$xmlFile=Join-Path $GameRoot $xmlRelative
[xml]$doc=[IO.File]::ReadAllText($xmlFile)
$xpath='/Defs/RecipeDef[@Name="MakeStoneBlocksBase" or defName="Make_StoneBlocksAny" or defName="Make_ComponentIndustrial"]'
$nodes=@(foreach($n in $doc.SelectNodes($xpath)){
 $fields=[ordered]@{}
 foreach($p in @('defName','label','workSkill','workSkillLearnFactor','ingredients','fixedIngredientFilter','skillRequirements','unfinishedThingDef','specialProducts')){
  $f=$n.SelectSingleNode($p);if($f){$fields[$p]=$f.InnerXml}
 }
 [ordered]@{name=$n.GetAttribute('Name');parent=$n.GetAttribute('ParentName');abstract=$n.GetAttribute('Abstract');fields=$fields}
})
if($nodes.Count -ne 3 -or $nodes[0].fields.workSkill -ne 'Crafting' -or $nodes[2].fields.skillRequirements -ne '<Crafting>8</Crafting>'){throw 'Original recipe XML changed'}
$xml=[ordered]@{id='PPLX01';file=$xmlRelative;source_sha256=Digest $xmlFile;xpath=$xpath;projection='Selected fields and immediate inheritance only; not an evaluated mod/DLC Def database';nodes=$nodes;nodes_sha256=TextDigest (LF ($nodes|ConvertTo-Json -Depth 8 -Compress))}
$claims=@(
 [ordered]@{id='PPL01';finding='IngredientCount.IsFixedIngredient means its slot filter has exactly one allowed def. recipe.fixedIngredientFilter instead describes the recipe-level allowed universe. New Bill copies defaultIngredientFilter; RecipeDef initializes a missing default filter from fixedIngredientFilter. These are distinct roles.';sources=@((Source 'food' 'Verse.IngredientCount' 8 17),(Source 'food' 'RimWorld.Bill' 151 157),(Source 'food' 'Verse.RecipeDef' 513 542))},
 [ordered]@{id='PPL02';finding='Bill.IsFixedOrAllowedIngredient first accepts any matching fixed ingredient slot; otherwise both recipe.fixedIngredientFilter and bill.ingredientFilter must allow it. IsUsableIngredient additionally requires a matching recipe slot. Fixed-slot matches bypass the player filter in both NoMix and AllowMix selection; empty nonfixed player allowances do not imply defaults.';sources=@((Source 'food' 'RimWorld.Bill' 400 432),(Source 'work' 'RimWorld.WorkGiver_DoBill' 407 420),(Source 'work' 'RimWorld.WorkGiver_DoBill' 615 727))},
 [ordered]@{id='PPL03';finding='ThingFilter.Allows(Thing) unwraps minified content and tests def, HP percentage, quality and special filters (plus Anomaly book restrictions); Allows(ThingDef) only tests def membership. Bill UI hides ingredient controls when every slot is fixed, otherwise uses the recipe fixed filter as parent. Save prunes player allowed defs outside that parent.';sources=@((Source 'preservation' 'Verse.ThingFilter' 874 910),(Source 'production-bills' 'RimWorld.Dialog_BillConfig' 486 507),(Source 'food' 'RimWorld.Bill' 205 231))},
 [ordered]@{id='PPL04';finding='Ordinary spawned ground ingredients use squared horizontal X/Z Euclidean distance from billGiver.Position, strictly less than radius squared, along with spawned, recipe/filter, forbidden and reservation checks. Traversal uses passable regions and within-region reachability; radius is not worker distance, interaction-cell distance or path length. Native multi-layer simulation is not established by this path.';sources=@((Source 'work' 'RimWorld.WorkGiver_DoBill' 443 461),(Source 'work' 'RimWorld.WorkGiver_DoBill' 498 557))},
 [ordered]@{id='PPL05';finding='The region-search root is the building interaction cell, falling back to pawn.Position for a malformed building, or billGiver.Position for nonbuildings. NoMix sorts candidates by squared horizontal distance from that root. Search/sort root is therefore distinct from radius center.';sources=@((Source 'work' 'RimWorld.WorkGiver_DoBill' 560 572),(Source 'work' 'RimWorld.WorkGiver_DoBill' 615 625))},
 [ordered]@{id='PPL06';finding='IHaulSource eligibility checks the spawned source container position with InHorDistOf, whose squared horizontal comparison is inclusive <=. Recursively held contents then undergo forbidden/reservation/thing checks; this is not the ordinary spawned-Thing validator. Autonomous worktables also try their own innerContainer. The ground/container boundary difference is static evidence only.';sources=@((Source 'work' 'RimWorld.WorkGiver_DoBill' 472 496),(Source 'production-policies' 'Verse.IntVec3' 173 178))},
 [ordered]@{id='PPL07';finding='Native ingredient radius is float: UI slider3..100 maps >=100 to999 and displays finite values with F0. The999 sentinel disables region-distance pruning when abs(999-radius)<1 but the ordinary ground validator still applies distance<999. It is a practical unlimited label, not mathematical infinity. Integer radius and null infinity in the Web adaptation are separate design choices.';sources=@((Source 'production-bills' 'RimWorld.Dialog_BillConfig' 509 519),(Source 'work' 'RimWorld.WorkGiver_DoBill' 460 461),(Source 'work' 'RimWorld.WorkGiver_DoBill' 498 521))},
 [ordered]@{id='PPL08';finding='PawnAllowedToStartAnew immediately returns pawnRestriction==pawn when a named worker is present. Otherwise category restrictions and an inclusive user skill interval apply using recipe.workSkill and pawn skill or mech fixed level; mechanitor checks follow. Named-worker mode bypasses the user interval in this method. UI hides the0..20 range selector for a named worker or mechs-only mode.';sources=@((Source 'food' 'RimWorld.Bill' 234 272),(Source 'production-bills' 'RimWorld.Dialog_BillConfig' 249 254))},
 [ordered]@{id='PPL09';finding='WorkGiver_DoBill independently evaluates recipe.FirstSkillRequirementPawnDoesntSatisfy after PawnAllowedToStartAnew. Named-worker selection therefore does not bypass hard recipe skill requirements. RecipeDef iterates the declared requirements, whereas the user interval uses workSkill. Core component recipe has a Crafting8 requirement; the stone base workSkill is Crafting with learn factor0.';xml=@('PPLX01');sources=@((Source 'work' 'RimWorld.WorkGiver_DoBill' 189 203),(Source 'food' 'Verse.RecipeDef' 573 587))},
 [ordered]@{id='PPL10';finding='Worker dropdown enumerates AllMaps_FreeColonists with an optional validator and stable ordering by label, work skill, active work and incapability. Incapable work types yield disabled options; unassigned workers may be selectable with NotAssigned label. Selecting only sets the bill restriction: it does not enable work or transport a pawn. Setters clear competing named/category modes; dead, faction-changed or kidnapped named pawns are cleared by validation.';sources=@((Source 'production-policies' 'RimWorld.BillDialogUtility' 10 90),(Source 'food' 'RimWorld.Bill' 165 203),(Source 'food' 'RimWorld.Bill' 482 491))},
 [ordered]@{id='PPL11';finding='New jobs capture ingredient targets/counts. Inspected ordinary ingredient-collection and work paths do not continuously reevaluate ingredient filter, radius, named worker or user skill interval. They retain other failure conditions including destroyed/forbidden targets, unusable/deleted bill giver and explicit suspension during work. Long UFT work can check overrides. Policy edits primarily govern subsequent dispatch; absolute uninterruptibility is not claimed.';sources=@((Source 'work' 'RimWorld.WorkGiver_DoBill' 335 351),(Source 'food' 'Verse.AI.JobDriver_DoBill' 69 136),(Source 'food' 'Verse.AI.Toils_Recipe' 90 165))},
 [ordered]@{id='PPL12';finding='Unbound UFT search requires same recipe, same creator, all ingredient defs currently fixed-or-allowed and reservation, searching from pawn with max9999 rather than bill ingredient radius. The bound UFT continuation branch checks bound worker/reachability/reservation/forbidden without the same ingredient re-filter. Outer named-worker and recipe hard-skill checks still precede bound continuation.';sources=@((Source 'work' 'RimWorld.WorkGiver_DoBill' 162 185),(Source 'work' 'RimWorld.WorkGiver_DoBill' 189 237))},
 [ordered]@{id='PPL13';finding='Bill serialization retains loadID, recipe, manual suspension, float ingredient radius(default999), user skill interval, pawn references, worker categories and ingredient filter. Clone creates its own filter allowances and copies radius, categories, range and pawn restriction; copying policy does not copy assigned work.';sources=@((Source 'food' 'RimWorld.Bill' 205 231),(Source 'food' 'RimWorld.Bill' 457 480))},
 [ordered]@{id='PPL14';finding='WorkGiver_DoBill scans ordered bills and continues after worker restriction, hard skill requirement or unavailable ingredients. A blocked first bill need not block later bills. Policy should yield a visible dispatch reason while preserving unrelated bill identity, mode and completed counts.';sources=@((Source 'work' 'RimWorld.WorkGiver_DoBill' 189 221),(Source 'work' 'RimWorld.WorkGiver_DoBill' 261 296))}
)
$reaFile=Join-Path $base 'production-bills-rea-managed.json'
$rea=Get-Content $reaFile -Raw|ConvertFrom-Json
if($rea.subject.digest.sha256 -ne $dllHash -or $rea.normalized_result.summary.module.mvid -ne '8e962ecc-7ac7-42d2-8f3b-1b16cd24d2cd'){throw 'REA identity mismatch'}
$e=[ordered]@{
 evidence_id='RW17-PRODUCTION-POLICIES';version_text=(Get-Content (Join-Path $GameRoot 'Version.txt') -Raw).Trim()
 source_sha256=$dllHash;engine_sha256=$engineHash;kind='Static derived reconstruction and selected Core XML; no target execution'
 rea=[ordered]@{file='production-bills-rea-managed.json';sha256=Digest $reaFile;evidence_id=$rea.evidence_id;parent_evidence_id=$rea.normalized_result.parent_evidence_id;mvid=$rea.normalized_result.summary.module.mvid;metadata_coverage=$rea.normalized_result.summary.coverage.state}
 manifests=@(foreach($name in @($groups|Sort-Object)){[ordered]@{file="$name-manifest.json";sha256=Digest (Join-Path $base "$name-manifest.json")}})
 xml=$xml;claims=$claims
 limitations=@('Derived C# is not original source and unresolved dependencies are tolerated.','Core XML is not an evaluated mod/DLC database; generated single-stone recipes are not asserted to be literal XML nodes.','Ground strict radius and container inclusive radius are distinct inspected paths; exact boundary runtime validation is not included.','Native radius is horizontal float with999 sentinel; Web integer3..100/null and strict3D distance are adaptations.','This collector performs no runtime observation; current-job behavior, UI availability and save/load evidence are separately scoped in native-production-policies-runtime.json.','REA target-framework metadata is literal metadata, not the actual runtime used by the game.')
}
$text=(LF ($e|ConvertTo-Json -Depth 30))+[char]10
$output=Join-Path $base 'production-policies-evidence.json'
if($Check){if([IO.File]::ReadAllText($output) -cne $text){throw 'Retained production-policy evidence differs'};"Production-policy source/XML replay verified: $($claims.Count) claims"}
else{[IO.File]::WriteAllText($output,$text,[Text.UTF8Encoding]::new($false));"Collected $($claims.Count) production-policy claims"}
