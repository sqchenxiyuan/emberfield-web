param(
  [Parameter(Mandatory=$true)][string]$GameRoot,
  [string]$Output = (Join-Path $PSScriptRoot '../../docs/research/rimworld/evidence/generation-xml.json')
)
$ErrorActionPreference = 'Stop'
$expectedAssemblyHash = 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'
$assemblyHash = (Get-FileHash -LiteralPath (Join-Path $GameRoot 'Assembly-CSharp.dll') -Algorithm SHA256).Hash.ToLowerInvariant()
if($assemblyHash -ne $expectedAssemblyHash) { throw "Source changed: $assemblyHash. Review the version before regenerating this evidence." }
$versionText = (Get-Content -Raw -LiteralPath (Join-Path $GameRoot 'Version.txt')).Trim()
$selections = @(
  @('world_layers','Data/Core/Defs/PlanetLayerDefs/PlanetLayers.xml',"/Defs/PlanetLayerDef[defName='Surface']",@('worldGenSteps','layerType','tileType')),
  @('world_steps','Data/Core/Defs/WorldGeneration/WorldGenerator.xml','/Defs/WorldGenStepDef',@('order','worldGenStep')),
  @('map_base','Data/Core/Defs/MapGeneration/CommonMapGenerator.xml',"/Defs/MapGeneratorDef[@Name='MapCommonBase']",@('genSteps')),
  @('map_steps','Data/Core/Defs/MapGeneration/CommonMapGenerator.xml','/Defs/GenStepDef',@('order','genStep')),
  @('player_map','Data/Core/Defs/MapGeneration/BasePlayerMapGenerator.xml','/Defs/*',@('genSteps','order','genStep')),
  @('mutators','Data/Core/Defs/MapGeneration/TileMutators.xml','/Defs/TileMutatorDef',@('workerClass','genOrder','priority','categories')),
  @('rivers','Data/Core/Defs/RiverDefs/RiverDefs.xml','/Defs/RiverDef',@('spawnFlowThreshold','spawnChance','degradeThreshold','degradeChild','branches','widthOnMap')),
  @('minerals','Data/Core/Defs/ThingDefs_Buildings/Buildings_Natural.xml',"/Defs/ThingDef[starts-with(defName,'Mineable') or @Name='RockBase']",@('building','statBases')),
  @('stone','Data/Core/Defs/ThingDefs_Misc/Various_Stone.xml',"/Defs/ThingDef[defName='Granite' or defName='Limestone' or defName='Marble' or defName='Sandstone' or defName='Slate' or @Name='UglyRockBase']",@('building','statBases')),
  @('terrain','Data/Core/Defs/TerrainDefs/Terrain_Natural.xml','/Defs/TerrainDef[defName]',@('fertility','pathCost','supportsRock','passability','affordances')),
  @('biome','Data/Core/Defs/BiomeDefs/Biomes_Temperate.xml',"/Defs/BiomeDef[defName='TemperateForest']",@('plantDensity','animalDensity','wildPlantRegrowDays','terrainsByFertility','terrainPatchMakers','wildPlants','wildAnimals','workerClass')),
  @('crops','Data/Core/Defs/ThingDefs_Plants/Plants_Cultivated_Farm.xml','/Defs/ThingDef',@('plant','statBases')),
  @('plant_bases','Data/Core/Defs/ThingDefs_Plants/Plants_Bases.xml',"/Defs/ThingDef[@Name='PlantBaseNonEdible' or @Name='PlantBase' or @Name='TreeBase' or @Name='DeciduousTreeBase']",@('plant','statBases')),
  @('wild_plants','Data/Core/Defs/ThingDefs_Plants/Plants_Wild_Temperate.xml',"/Defs/ThingDef[defName='Plant_Berry' or defName='Plant_TreeOak' or defName='Plant_TreePoplar']",@('plant','statBases')),
  @('wild_herb','Data/Core/Defs/ThingDefs_Plants/Plants_Wild_General.xml',"/Defs/ThingDef[defName='Plant_HealrootWild']",@('plant','statBases'))
)
$records = [System.Collections.Generic.List[object]]::new()
foreach($selection in $selections) {
  $path = Join-Path $GameRoot $selection[1]
  [xml]$xml = Get-Content -Raw -LiteralPath $path
  $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  foreach($node in $xml.SelectNodes($selection[2])) {
    $def = $node.SelectSingleNode('defName')
    $name = $node.GetAttribute('Name')
    $key = if($def) { $def.InnerText } else { $name }
    if(!$key) { throw "Missing stable selector in $path" }
    $xpath = if($def) { '/Defs/'+$node.LocalName+"[defName='$key']" } else { '/Defs/'+$node.LocalName+"[@Name='$key']" }
    $fields = [System.Collections.Generic.List[object]]::new()
    foreach($leaf in $node.SelectNodes('.//*[not(*)]')) {
      $parts = [System.Collections.Generic.List[string]]::new()
      $cursor = $leaf
      while($cursor -ne $node) {
        $tag = $cursor.LocalName
        $siblings = @($cursor.ParentNode.ChildNodes | Where-Object { $_.NodeType -eq 'Element' -and $_.LocalName -eq $tag })
        $segment = $tag
        if($siblings.Count -gt 1) { $segment += '['+([Array]::IndexOf($siblings,$cursor)+1)+']' }
        $parts.Insert(0,$segment)
        $cursor = $cursor.ParentNode
      }
      if($parts[0] -notin $selection[3]) { continue }
      $rel = $parts -join '/'
      # Retain rules and numbers, not art paths, prose, sound identifiers or visual tuning.
      if($rel -match '(?i)graphic|sound|visual|wind|mesh|snowOverlay|leafless|topWind') { continue }
      $attrs = [ordered]@{}
      foreach($attr in $leaf.Attributes) { $attrs[$attr.Name] = $attr.Value }
      $fields.Add([ordered]@{xpath=$xpath+'/'+$rel;value=$leaf.InnerText;attributes=$attrs})
    }
    $records.Add([ordered]@{
      group=$selection[0];id=$key;parent_name=$node.GetAttribute('ParentName');
      source=[ordered]@{path=$selection[1];xpath=$xpath;sha256=$hash};fields=@($fields.ToArray())
    })
  }
}
$result = [ordered]@{
  evidence_id='RW17-GENERATION-XML';version_text=$versionText;assembly_sha256=$assemblyHash;
  kind='Selected direct XML declarations, not an effective inherited Def database';
  limitations=@('ParentName is retained but not resolved here.','MayRequire and Inherit attributes are retained; active packages and patches are not evaluated.','Omitted fields are not evidence of absence.');
  records=@($records.ToArray())
}
$outPath = [System.IO.Path]::GetFullPath($Output)
[System.IO.File]::WriteAllText($outPath, (($result | ConvertTo-Json -Depth 16) -replace "`r`n","`n")+"`n", [System.Text.UTF8Encoding]::new($false))
Write-Output "Recorded $($records.Count) selected XML nodes in $outPath"
