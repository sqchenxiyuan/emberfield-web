param([Parameter(Mandatory=$true)][string]$GameRoot,[string]$Output=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/anatomy-xml.json'),[string]$HumanOutput=(Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/anatomy-human.json'))
$ErrorActionPreference='Stop'
$assembly=(Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assembly -ne 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'){throw 'Review changed source before updating anatomy evidence.'}
$bodyPath='Data/Core/Defs/Bodies/Bodies_Humanlike.xml'
[xml]$bodyXml=Get-Content -Raw -LiteralPath (Join-Path $GameRoot $bodyPath)
$body=$bodyXml.SelectSingleNode("/Defs/BodyDef[defName='Human']")
$required=@($body.SelectNodes('corePart//def')|ForEach-Object InnerText|Sort-Object -Unique)
$partFields=@('label','hitPoints','bleedRate','skinCovered','solid','conceptual','destroyableByDamage','alive','delicate','socketed','hitChanceFactors','tags')
$partPredicate=($required|ForEach-Object{"defName='$_'"}) -join ' or '
$partPaths=@('Data/Core/Defs/Bodies/BodyParts_Humanoid.xml','Data/Core/Defs/Bodies/BodyParts_General.xml','Data/Core/Defs/Bodies/BodyParts_Organs.xml')
$damageFields=@('workerClass','hediff','hediffSkin','hediffSolid','armorCategory','externalViolence','harmAllLayersUntilOutside','stabChanceOfForcedInternal','cutExtraTargetsCurve','cutCleaveBonus','bluntInnerHitChance','bluntInnerHitDamageFractionToConvert','bluntInnerHitDamageFractionToAdd','bluntStunDuration','bluntStunChancePerDamagePctOfCorePartToHeadCurve','bluntStunChancePerDamagePctOfCorePartToBodyCurve','overkillPctToDestroyPart')
$selections=@(
 @('body',$bodyPath,"/Defs/BodyDef[defName='Human']",@('corePart')),
 @('capacity','Data/Core/Defs/PawnCapacityDefs/PawnCapacity.xml','/Defs/PawnCapacityDef',@('workerClass','minForCapable','minValue','zeroIfCannotBeAwake','lethalFlesh','lethalMechanoids')),
 @('damage','Data/Core/Defs/DamageDefs/Damages_MeleeWeapon.xml',"/Defs/DamageDef[defName='Cut' or defName='Stab' or defName='Blunt' or defName='Poke' or defName='Bite' or defName='Crush']",$damageFields),
 @('injury','Data/Core/Defs/HediffDefs/Hediffs_Local_Injuries.xml',"/Defs/HediffDef[@Name='InjuryBase' or defName='MissingBodyPart' or defName='Bruise' or defName='Cut' or defName='Stab' or defName='Crush' or defName='Crack' or defName='Bite']",@('hediffClass','tendable','injuryProps','comps')),
 @('human','Data/Core/Defs/ThingDefs_Races/Races_Humanlike.xml',"/Defs/ThingDef[defName='Human']",@('race/body','race/baseHealthScale','race/bleedRateFactor','race/alwaysAwake','race/lethalDamageThreshold','tools'))
 ,@('work','Data/Core/Defs/WorkGiverDefs/WorkGivers.xml',"/Defs/WorkGiverDef[defName='Mine' or defName='ConstructFinishFrames' or defName='GrowerSow' or defName='GrowerHarvest' or defName='PlantsCut' or defName='DoctorTendToHumanlikes' or defName='Research']",@('giverClass','workType','requiredCapacities'))
)
foreach($p in $partPaths){$selections+=,@('part',$p,"/Defs/BodyPartDef[$partPredicate]",$partFields)}
function Relative-XPath($leaf,$root){$parts=[Collections.Generic.List[string]]::new();$cursor=$leaf;while($cursor -ne $root){$tag=$cursor.LocalName;$siblings=@($cursor.ParentNode.ChildNodes|Where-Object{$_.NodeType -eq 'Element' -and $_.LocalName -eq $tag});$segment=$tag;if($siblings.Count -gt 1){$segment+='['+([Array]::IndexOf($siblings,$cursor)+1)+']'};$parts.Insert(0,$segment);$cursor=$cursor.ParentNode};return ($parts -join '/')}
$records=[Collections.Generic.List[object]]::new();$definitions=@{}
foreach($s in $selections){$file=Join-Path $GameRoot $s[1];[xml]$doc=Get-Content -Raw -LiteralPath $file;$sha=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();$nodes=$doc.SelectNodes($s[2]);if(!$nodes.Count){throw "No nodes: $($s[2])"}
 foreach($node in $nodes){$def=$node.SelectSingleNode('defName');$name=if($def){$def.InnerText}else{$node.GetAttribute('Name')};$xp='/Defs/'+$node.LocalName+$(if($def){"[defName='$name']"}else{"[@Name='$name']"});$leaves=[Collections.Generic.List[object]]::new();$attrs=[Collections.Generic.List[object]]::new();$absent=[Collections.Generic.List[string]]::new()
  foreach($selector in $s[3]){$chosen=$node.SelectNodes($selector);if(!$chosen.Count){$absent.Add($selector);continue};foreach($top in $chosen){$scan=@($top)+@($top.SelectNodes('.//*'));foreach($child in $scan){$rel=Relative-XPath $child $node;if($rel -match '/(description|labelTendedWell|labelTendedWellInner|labelSolidTendedWell|destroyedLabel|destroyedOutLabel|permanentLabel|instantlyPermanentLabel)$'){continue};if($child.Attributes.Count){$a=[ordered]@{};foreach($item in $child.Attributes){$a[$item.Name]=$item.Value};$attrs.Add([ordered]@{xpath=$xp+'/'+$rel;attributes=$a})};if(!$child.SelectNodes('*').Count){$leaves.Add([ordered]@{xpath=$xp+'/'+$rel;value=$child.InnerText})}}}}
  $records.Add([ordered]@{group=$s[0];id=$node.LocalName+'_'+$name;def_name=$name;parent_name=$node.GetAttribute('ParentName');name_attribute=$node.GetAttribute('Name');source=[ordered]@{path=$s[1];xpath=$xp;sha256=$sha};selected_paths=$s[3];absent_paths=@($absent.ToArray());fields=@($leaves.ToArray());node_attributes=@($attrs.ToArray())})
  if($s[0] -eq 'part'){if($node.GetAttribute('ParentName')){throw "Unreviewed body-part parent: $name"};$definitions[$name]=$node}
 }
}
if($definitions.Count -ne $required.Count){throw 'Missing selected body-part definition'}
function Field($node,$name,$default){$f=$node.SelectSingleNode($name);if($f){return $f.InnerText};return $default}
function BoolField($node,$name,$default){return [bool]::Parse((Field $node $name ([string]$default)))}
$humanNodes=[Collections.Generic.List[object]]::new()
function Walk-Body($node,$parent,$indexPath){
 $defName=[string]$node.def;$definition=$definitions[$defName];$label=Field $node 'customLabel' (Field $definition 'label' $defName)
 $id=($label.ToLowerInvariant() -replace '[^a-z0-9]+','-').Trim('-')
 if(@($humanNodes|Where-Object id -eq $id).Count){throw "Duplicate semantic part identity: $id"}
 $height=Field $node 'height' $(if($parent){$parent.height}else{'Middle'});$depth=Field $node 'depth' $(if($parent){$parent.depth}else{'Outside'})
 $relative=[double](Field $node 'coverage' 1);$withChildren=if($parent){$parent.coverageAbsWithChildren*$relative}else{1.0}
 $children=@($node.SelectNodes('parts/li'));$self=1.0;foreach($child in $children){$self-=[double](Field $child 'coverage' 1)};if([Math]::Abs($self) -lt 0.00001 -or $self -le 0){$self=0.0}
 $hitFactors=[ordered]@{};foreach($factor in $definition.SelectNodes('hitChanceFactors/li')){$hitFactors[[string]$factor.key]=[double]$factor.value}
 $r=[ordered]@{id=$id;index=$humanNodes.Count;defName=$defName;label=$label;parentId=$(if($parent){$parent.id}else{$null});childIds=@();height=$height;depth=$depth;coverageRelative=$relative;coverageAbsWithChildren=[Math]::Round($withChildren,15);coverageAbs=[Math]::Round(($withChildren*$self),15);groups=@($node.SelectNodes('groups/li')|ForEach-Object InnerText);tags=@($definition.SelectNodes('tags/li')|ForEach-Object InnerText);hitPoints=[int](Field $definition 'hitPoints' 10);bleedRate=[double](Field $definition 'bleedRate' 1);skinCovered=(BoolField $definition 'skinCovered' $false);solid=(BoolField $definition 'solid' $false);conceptual=(BoolField $definition 'conceptual' $false);destroyableByDamage=(BoolField $definition 'destroyableByDamage' $true);alive=(BoolField $definition 'alive' $true);hitChanceFactors=$hitFactors;definitionRef='BodyPartDef_'+$defName;sourceXPath="/Defs/BodyDef[defName='Human']/corePart$indexPath"}
 $humanNodes.Add($r)
 for($i=0;$i -lt $children.Count;$i++){$child=Walk-Body $children[$i] $r ($indexPath+'/parts/li['+($i+1)+']');$r.childIds+=,$child.id}
 return $r
}
$null=Walk-Body ($body.SelectSingleNode('corePart')) $null ''
$version=(Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim()
$result=[ordered]@{evidence_id='RW17-ANATOMY-XML';version_text=$version;assembly_sha256=$assembly;kind='Selected direct Core Human body, all used part definitions, all eleven capacities, selected work qualifications and ordinary physical damage declarations';limitations=@('Selected direct declarations, reviewed DamageDef parents and class defaults; not the enabled-mod effective database.','No target code execution or native runtime assertion.');records=@($records.ToArray())}
$human=[ordered]@{evidence_id='RW17-ANATOMY-HUMAN';version_text=$version;assembly_sha256=$assembly;body='Human';source=[ordered]@{path=$bodyPath;sha256=(Get-FileHash -LiteralPath (Join-Path $GameRoot $bodyPath) -Algorithm SHA256).Hash.ToLowerInvariant();xpath="/Defs/BodyDef[defName='Human']"};derivation='BodyDef.CacheDataRecursive preorder, inherited height/depth; BodyPartDef class defaults. IDs are project-side stable English label slugs, not native save identifiers. Coverage arithmetic uses double precision rounded to 15 decimal places; not C# float-bit emulation.';nodes=@($humanNodes.ToArray())}
if($humanNodes.Count -ne 64){throw "Unexpected Human node count: $($humanNodes.Count)"}
foreach($pair in @(@($Output,$result),@($HumanOutput,$human))){[IO.File]::WriteAllText([IO.Path]::GetFullPath($pair[0]),(($pair[1]|ConvertTo-Json -Depth 40) -replace "`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))}
Write-Output "Recorded $($records.Count) selected XML records and $($humanNodes.Count) Human nodes."
