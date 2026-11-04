param([string]$GameRoot='F:/SteamLibrary/steamapps/common/RimWorld',[switch]$Check)
# Static, bounded source/XML replay. Does not load or execute target game code.
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
$xmlFiles=@(
 'Data/Core/Defs/ThingDefs_Misc/Apparel_Various.xml','Data/Core/Defs/ThingDefs_Misc/Apparel_Headgear.xml',
 'Data/Core/Defs/ThingDefs_Misc/Weapons/BaseWeapons.xml','Data/Core/Defs/ThingDefs_Misc/Weapons/MeleeNeolithic.xml',
 'Data/Core/Defs/ThingDefs_Misc/Weapons/MeleeMedieval.xml','Data/Core/Defs/ThingDefs_Misc/Weapons/RangedNeolithic.xml',
 'Data/Core/Defs/ThingDefs_Misc/Weapons/RangedIndustrial.xml','Data/Core/Defs/ThingDefs_Items/Items_Unfinished.xml',
 'Data/Core/Defs/RecipeDefs/Recipes_Meals.xml','Data/Core/Defs/RecipeDefs/Recipes_Butchery.xml',
 'Data/Core/Defs/RecipeDefs/Recipes_Production.xml','Data/Core/Defs/Stats/Stats_Basics_General.xml'
)
$xmlRecords=@(foreach($relative in $xmlFiles){
 $file=Join-Path $GameRoot $relative;[xml]$doc=[IO.File]::ReadAllText($file)
 [pscustomobject]@{file=$relative;sha256=Digest $file;doc=$doc}
})
function XmlChain([string]$kind,[string]$def,[string]$field){
 $matches=@(foreach($r in $xmlRecords){foreach($n in $r.doc.SelectNodes("/Defs/$kind")){if($n.SelectSingleNode('defName').InnerText -ceq $def){[pscustomobject]@{record=$r;node=$n}}}})
 if($matches.Count -ne 1){throw "Expected one $kind/$def"}
 $current=$matches[0];$seen=[Collections.Generic.HashSet[string]]::new()
 while($null -ne $current){
  $n=$current.node;$r=$current.record;$parent=$n.GetAttribute('ParentName');$f=$n.SelectSingleNode($field)
  $container=if($field.Contains('/')){$n.SelectSingleNode($field.Split('/')[0])}else{$null}
  [ordered]@{file=$r.file;source_sha256=$r.sha256;defName=$n.SelectSingleNode('defName').InnerText;name=$n.GetAttribute('Name');parent=$parent
   node_sha256=TextDigest $n.OuterXml;field=$field;present=($null -ne $f);value=if($f){$f.InnerText}else{$null}
   fieldInherit=if($f){$f.GetAttribute('Inherit')}else{$null};containerInherit=if($container){$container.GetAttribute('Inherit')}else{$null}}
  if(!$parent){break};if(!$seen.Add($parent)){throw 'XML inheritance cycle'}
  $parents=@(foreach($p in $xmlRecords){foreach($pn in $p.doc.SelectNodes("/Defs/$kind")){if($pn.GetAttribute('Name') -ceq $parent){[pscustomobject]@{record=$p;node=$pn}}}})
  if($parents.Count -ne 1){throw "Expected one parent $parent"};$current=$parents[0]
 }
}
$mappingSpecs=@(
 @('tuque','Apparel_Tuque','UnfinishedApparel'),@('parka','Apparel_Parka','UnfinishedApparel'),@('duster','Apparel_Duster','UnfinishedApparel'),
 @('shirt','Apparel_BasicShirt','UnfinishedApparel'),@('pants','Apparel_Pants','UnfinishedApparel'),
 @('simpleHelmet','Apparel_SimpleHelmet','UnfinishedArmor'),@('plateArmor','Apparel_PlateArmor','UnfinishedMetallicTechArmor'),
 @('woodClub','MeleeWeapon_Club','UnfinishedWeapon'),@('steelKnife','MeleeWeapon_Knife','UnfinishedWeapon'),@('steelLongsword','MeleeWeapon_LongSword','UnfinishedWeapon'),
 @('shortBow','Bow_Short','UnfinishedWeapon'),@('revolver','Gun_Revolver','UnfinishedGun'),@('machinePistol','Gun_MachinePistol','UnfinishedGun')
)
$mappings=@(foreach($spec in $mappingSpecs){
 $chain=@(XmlChain 'ThingDef' $spec[1] 'recipeMaker/unfinishedThingDef')
 $first=$chain|Where-Object present|Select-Object -First 1
 if(!$first -or $first.value -cne $spec[2]){throw "Unexpected UFT mapping: $($spec[0])"}
 # These selected chains have no container reset; stop rather than silently resolve an unsupported inheritance edit.
 if(@($chain|Where-Object {$_.containerInherit -eq 'false' -or $_.fieldInherit -eq 'false'}).Count){throw 'Selected recipe inheritance now needs manual review'}
 [ordered]@{webRecipe=$spec[0];productDef=$spec[1];generatedRecipe=('Make_'+$spec[1]);unfinishedThingDef=$first.value;chain=$chain}
})
$withoutUft=@(foreach($name in @('CookMealSimple','ButcherCorpseFlesh','Make_StoneBlocksAny')){
 $chain=@(XmlChain 'RecipeDef' $name 'unfinishedThingDef')
 if(@($chain|Where-Object present).Count){throw "Unexpected UFT declaration: $name"}
 [ordered]@{recipe=$name;unfinishedThingDef=$null;chain=$chain}
})
$uftRecord=$xmlRecords|Where-Object file -like '*/Items_Unfinished.xml'
$uftNodes=@(foreach($n in $uftRecord.doc.SelectNodes('/Defs/ThingDef[@Name="UnfinishedBase" or defName="UnfinishedWeapon" or defName="UnfinishedGun" or defName="UnfinishedApparel" or defName="UnfinishedArmor" or defName="UnfinishedTechArmor" or defName="UnfinishedMetallicTechArmor"]')){
 $fields=[ordered]@{};foreach($p in @('defName','thingClass','category','useHitPoints','isUnfinishedThing','selectable','tradeability','statBases','comps','alwaysHaulable','stuffCategories','killedLeavings','killedLeavingsPlayerHostile')){
  $f=$n.SelectSingleNode($p);if($f){$fields[$p]=[ordered]@{xml=$f.InnerXml;inherit=$f.GetAttribute('Inherit')}}
 }
 [ordered]@{name=$n.GetAttribute('Name');parent=$n.GetAttribute('ParentName');node_sha256=TextDigest $n.OuterXml;fields=$fields}
})
if($uftNodes.Count -ne 7){throw 'Selected unfinished definitions changed'}
$massRecord=$xmlRecords|Where-Object file -like '*/Stats_Basics_General.xml'
$massPart=$massRecord.doc.SelectSingleNode('/Defs/StatDef[defName="Mass"]/parts/li[@Class="StatPart_UnfinishedThingIngredientsMass"]')
if(!$massPart){throw 'Missing unfinished mass stat part'}
$claims=@(
 [ordered]@{id='UFT01';finding='RecipeDef.UsesUnfinishedThing is unfinishedThingDef != null. BillUtility selects Bill_ProductionWithUft for this case. Generated item recipes copy recipeMaker.unfinishedThingDef; selected Core chains map all13 current Web apparel/weapon recipes to a UFT, with PlateArmor overriding to UnfinishedMetallicTechArmor. Selected cooking/butchery/stone base recipes have no such declaration.';sources=@((Source 'food' 'Verse.RecipeDef' 355 365),(Source 'unfinished-production' 'RimWorld.BillUtility' 35 54),(Source 'apparel' 'RimWorld.RecipeDefGenerator' 28 85),(Source 'apparel' 'Verse.RecipeMakerProperties' 20 28))},
 [ordered]@{id='UFT02';finding='UnfinishedThing is a separate ThingWithComps with creator reference, cached creatorName, recipe, deeply serialized List<Thing> ingredients, bound bill and workLeft. It is not merely bill-local progress. The declaration does not implement IThingHolder. Creator setter rejects null; missing loaded references are separate from the cached name.';sources=@((Source 'weapons' 'Verse.UnfinishedThing' 8 43),(Source 'weapons' 'Verse.UnfinishedThing' 136 151))},
 [ordered]@{id='UFT03';finding='After ingredient collection and reaching the table, MakeUnfinishedThingIfNeeded splits exact placed counts, clears designations, despawns ingredient Things and puts the list into one new UFT. It sets creator, reciprocal bill binding, workLeft and dominant-material/color, spawns at targetA cell, assigns targetB and reserves it. An existing targetB UFT skips creation.';sources=@((Source 'food' 'Verse.AI.JobDriver_DoBill' 90 112),(Source 'food' 'Verse.AI.Toils_Recipe' 11 40),(Source 'food' 'Verse.AI.Toils_Recipe' 309 343),(Source 'food' 'Verse.AI.Toils_Recipe' 346 367))},
 [ordered]@{id='UFT04';finding='DoRecipeWork restores initialized UFT.workLeft and mirrors remaining work on each work interval. UFT sentinel starts at-10000, Initialized is >-5000. A new non-UFT work start initializes the full bill amount, but JobDriver_DoBill.ExposeData still saves workLeft, billStartTick and ticksSpentDoingRecipeWork: restarting a job and loading the same active job are different cases.';sources=@((Source 'weapons' 'Verse.UnfinishedThing' 20 24),(Source 'weapons' 'Verse.UnfinishedThing' 136 151),(Source 'food' 'Verse.AI.Toils_Recipe' 43 75),(Source 'food' 'Verse.AI.Toils_Recipe' 90 153),(Source 'food' 'Verse.AI.JobDriver_DoBill' 42 51))},
 [ordered]@{id='UFT05';finding='FinishUftJob requires the original Creator. After optional obstruction hauling, new DoBill targets the UFT with count1; job initialization rebinds that UFT to its selected bill before hauling. This consumes the existing independent work item rather than collecting a new recipe batch.';sources=@((Source 'work' 'RimWorld.WorkGiver_DoBill' 168 185),(Source 'food' 'Verse.AI.JobDriver_DoBill' 69 112))},
 [ordered]@{id='UFT06';finding='ClosestUnfinishedThingForBill has NO BoundBill==null requirement. For a bill without its own bound UFT it finds reachable, reservable, nonforbidden same-recipe/same-creator UFT whose ingredient Defs pass fixed-or-allowed, from pawn with max9999. It may select one bound to another bill; reciprocal rebinding clears the old link. This permits compatible-table continuation and is not a hard creation-bench lock.';sources=@((Source 'work' 'RimWorld.WorkGiver_DoBill' 162 185),(Source 'work' 'RimWorld.WorkGiver_DoBill' 223 238),(Source 'food' 'Verse.AI.JobDriver_DoBill' 84 96),(Source 'weapons' 'Verse.UnfinishedThing' 46 92),(Source 'production-bills' 'RimWorld.Bill_ProductionWithUft' 58 81))},
 [ordered]@{id='UFT07';finding='Bound continuation checks BoundWorker==pawn, touch reach/reservation with Danger.Deadly and not forbidden, without the search branch ingredient Def re-filter. Outer ShouldDoNow, allowed-worker and hard recipe skill checks still precede both paths. Changing named worker does not transfer UFT Creator; outer worker and bound-author checks can block both people.';sources=@((Source 'work' 'RimWorld.WorkGiver_DoBill' 189 238),(Source 'food' 'RimWorld.Bill' 234 272))},
 [ordered]@{id='UFT08';finding='BoundWorker lazily drops the bill-side pointer if creator is missing/downed/hosted/destroyed/unspawned or its applicable work type is inactive. UFT.BoundBill lazily clears an invalid/deleted/nonreciprocal link. Neither operation appoints another creator; cached author survives independently.';sources=@((Source 'production-bills' 'RimWorld.Bill_ProductionWithUft' 22 55),(Source 'weapons' 'Verse.UnfinishedThing' 46 77),(Source 'weapons' 'Verse.UnfinishedThing' 136 151))},
 [ordered]@{id='UFT09';finding='Suspension explicitly fails work; deletion/dereference/unusable table and despawned target can fail the job. BillStack.Delete removes and marks the bill; ordinary Building_WorkTable.Notify_BillDeleted is empty. UFT keeps recipe/creator/ingredients/workLeft while invalid binding is cleared lazily or during save. Deleting a bill is not UFT Cancel.';sources=@((Source 'food' 'Verse.AI.Toils_Recipe' 149 165),(Source 'food' 'Verse.AI.JobDriver_DoBill' 69 83),(Source 'food' 'RimWorld.Bill' 111 125),(Source 'production-bills' 'RimWorld.BillStack' 75 80),(Source 'stonecutting' 'RimWorld.Building_WorkTable' 116 118),(Source 'weapons' 'Verse.UnfinishedThing' 136 170))},
 [ordered]@{id='UFT10';finding='At completion CalculateIngredients takes the existing UFT ingredients list then calls recipe.Worker.ConsumeIngredient(UFT); default worker destroys it with Vanish. Product generation uses the retained ingredients and dominant material, then consumes ingredients and notifies the completed iteration. Completion clears bill boundUft. Clone does not copy boundUft.';sources=@((Source 'food' 'Verse.AI.Toils_Recipe' 180 200),(Source 'food' 'Verse.AI.Toils_Recipe' 301 307),(Source 'food' 'Verse.AI.Toils_Recipe' 346 376),(Source 'food' 'Verse.RecipeWorker' 44 47),(Source 'production-bills' 'RimWorld.Bill_ProductionWithUft' 95 115))},
 [ordered]@{id='UFT11';finding='The normal UFT Cancel gizmo calls Destroy(Cancel). Only this UFT branch rounds each ingredient stack with GenMath.RoundRandom(stackCount*0.75), attempts placement near the UFT, clears ingredients, destroys the item and clears binding. Per-stack random rounding is not floor of a pooled total, and nearby placement is attempted rather than universally guaranteed.';sources=@((Source 'weapons' 'Verse.UnfinishedThing' 153 186))},
 [ordered]@{id='UFT12';finding='Ordinary Vanish/Kill destruction does not run UFT Cancel recovery. Generic GenLeaving exits for Vanish/QuestLogic; construction-resource recovery excludes non-Building Things. UFT Core definitions are Item and the selected chains declare no killedLeavings. This is not a claim that every modded UFT can never yield any configured leavings.';sources=@((Source 'weapons' 'Verse.UnfinishedThing' 153 170),(Source 'food' 'Verse.Thing' 1038 1100),(Source 'unfinished-production' 'RimWorld.GenLeaving' 28 46),(Source 'unfinished-production' 'RimWorld.GenLeaving' 280 303))},
 [ordered]@{id='UFT13';finding='UFT is selectable/alwaysHaulable with hit points and forbidding component in selected XML. An inspected auto-haul path protects a UFT bound to the first ShouldDoNow bill near its spawned building or nonbuilding bill giver. Haul-aside excludes bound table interaction/occupied cells. These scoped rules do not mean UFT is universally immovable.';sources=@((Source 'work' 'Verse.AI.HaulAIUtility' 80 107),(Source 'work' 'Verse.AI.HaulAIUtility' 313 327))},
 [ordered]@{id='UFT14';finding='UFT and bill persist reciprocal references; UFT persists creator reference/name, recipe, workLeft and each ingredient deeply. When saving, deleted/dereferenced bill reference is cleared. Inspect text displays cached Author and WorkLeft; selection overlay links to the currently bound table. These are separate from save-wide identity or unrelated job continuity.';sources=@((Source 'weapons' 'Verse.UnfinishedThing' 136 151),(Source 'production-bills' 'RimWorld.Bill_ProductionWithUft' 95 109),(Source 'weapons' 'Verse.UnfinishedThing' 216 238))},
 [ordered]@{id='UFT15';finding='Selected UnfinishedBase declares base MaxHitPoints50, DeteriorationRate2, Beauty-8 and Mass1; material/stat processing may modify final values. Mass stat includes StatPart_UnfinishedThingIngredientsMass, adding each ingredient GetStatValue(Mass)*stackCount. UnfinishedGun declares Flammability0.5 and clears stuffCategories inheritance. No uniform final HP across materials is asserted.';sources=@((Source 'unfinished-production' 'RimWorld.StatPart_UnfinishedThingIngredientsMass' 5 39))},
 [ordered]@{id='UFT16';finding='Inspected StatWorker_MarketValue has general cost/work/stuff/comp handling, not a confirmed UFT-ingredients valuation rule. This scope does not close UFT final market value or colony wealth aggregation. Web material-cost valuation must remain an explicit adaptation, not a claimed native formula.';sources=@((Source 'unfinished-production' 'RimWorld.StatWorker_MarketValue' 14 125))}
)
$reaFile=Join-Path $base 'production-bills-rea-managed.json';$rea=Get-Content $reaFile -Raw|ConvertFrom-Json
if($rea.subject.digest.sha256 -ne $dllHash -or $rea.normalized_result.summary.module.mvid -ne '8e962ecc-7ac7-42d2-8f3b-1b16cd24d2cd'){throw 'REA identity mismatch'}
$e=[ordered]@{
 evidence_id='RW17-UNFINISHED-PRODUCTION';version_text=(Get-Content (Join-Path $GameRoot 'Version.txt') -Raw).Trim()
 source_sha256=$dllHash;engine_sha256=$engineHash;kind='Static derived reconstruction and bounded Core XML inheritance; not target execution'
 rea=[ordered]@{file='production-bills-rea-managed.json';sha256=Digest $reaFile;evidence_id=$rea.evidence_id;parent_evidence_id=$rea.normalized_result.parent_evidence_id;mvid=$rea.normalized_result.summary.module.mvid;metadata_coverage=$rea.normalized_result.summary.coverage.state}
 manifests=@(foreach($name in @($groups|Sort-Object)){[ordered]@{file="$name-manifest.json";sha256=Digest (Join-Path $base "$name-manifest.json")}})
 xml=[ordered]@{files=@($xmlRecords|ForEach-Object{[ordered]@{file=$_.file;sha256=$_.sha256}});projection='Selected literal nodes and explicit Core ancestry only; not effective loaded mod/DLC Def database';recipeMappings=$mappings;recipesWithoutUftDeclaration=$withoutUft;unfinishedDefinitions=$uftNodes;massStatPart=$massPart.OuterXml}
 claims=$claims
 limitations=@('Derived C# is not original source; unresolved decompiler dependencies are tolerated.','The search branch has no unbound-only requirement; previous chapter120 wording is superseded by UFT06.','No blanket claim that non-UFT jobs lose progress across save/load: same job driver saves progress.','Final UFT market value and colony wealth are unresolved; XML base stats are not universally final stats.','Native runtime evidence is separate and limited to one unfinished wooden club at one crafting spot.','REA target-framework metadata is literal metadata, not proof of the runtime used by the game.')
}
$text=(LF ($e|ConvertTo-Json -Depth 40))+[char]10;$output=Join-Path $base 'unfinished-production-evidence.json'
if($Check){if([IO.File]::ReadAllText($output) -cne $text){throw 'Retained unfinished-production evidence differs'};"Unfinished-production replay verified: $($claims.Count) claims, $($mappings.Count) UFT and $($withoutUft.Count) non-UFT recipe mappings"}
else{[IO.File]::WriteAllText($output,$text,[Text.UTF8Encoding]::new($false));"Collected $($claims.Count) unfinished-production claims and $($mappings.Count) UFT recipe mappings"}
