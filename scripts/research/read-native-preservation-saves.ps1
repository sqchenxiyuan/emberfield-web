param([string]$SaveDirectory=(Join-Path $PSScriptRoot '../../.local-research/runtime/profile-20261102/Saves'))
# Read-only extraction of original-game XML. No target assembly is loaded or executed.
$ErrorActionPreference='Stop'
$culture=[Globalization.CultureInfo]::InvariantCulture
function Number([string]$value){[double]::Parse($value,$culture)}
function Position([string]$value){
 if($value -notmatch '^\((\d+),\s*(\d+),\s*(\d+)\)$'){throw "Invalid position: $value"}
 @([int]$Matches[1],[int]$Matches[2],[int]$Matches[3])
}
$result=@()
foreach($name in 'warm-0','warm-1','chilled-0','frozen-0','frozen-1'){
 $file=Join-Path $SaveDirectory "preservation-$name.rws"
 $xml=[xml](Get-Content -Raw -LiteralPath $file)
 $map=$xml.SelectSingleNode('//maps/li')
 $size=Position $map.SelectSingleNode('mapInfo/size').InnerText
 $compressed=[Convert]::FromBase64String($map.SelectSingleNode('temperatureCache/temperaturesDeflate').InnerText)
 $inputStream=[IO.MemoryStream]::new($compressed)
 $inflate=[IO.Compression.DeflateStream]::new($inputStream,[IO.Compression.CompressionMode]::Decompress)
 $outputStream=[IO.MemoryStream]::new()
 try{$inflate.CopyTo($outputStream);$bytes=$outputStream.ToArray()}
 finally{$inflate.Dispose();$inputStream.Dispose();$outputStream.Dispose()}
 if($bytes.Length -ne 2*$size[0]*$size[2]){throw 'Temperature grid length differs from map dimensions.'}
 function Temperature($position){
  $offset=2*($position[2]*$size[0]+$position[0])
  (($bytes[$offset]+256*$bytes[$offset+1])-32768)/16
 }
 $meals=@()
 foreach($id in 'MealSimple42000','MealSimple42001'){
  $found=$xml.SelectNodes("//id[text()='$id']")
  if($found.Count -gt 1){throw "Ambiguous food identity: $id"}
  if(!$found.Count){$meals+=@{id=$id;present=$false};continue}
  $thing=$found[0].ParentNode
  $position=Position $thing.pos
  $meals += [ordered]@{id=$id;present=$true;def=[string]$thing.def;pos=$position;stack_count=[int]$thing.stackCount;health=[int]$thing.health;forbidden=[bool]::Parse($thing.forbidden);spawned_tick=[int]$thing.spawnedTick;rot_progress=(Number $thing.rotProg);temperature_cache_c=(Temperature $position)}
 }
 $cooler=$xml.SelectSingleNode('//id[text()="Cooler42061"]').ParentNode
 $result += [ordered]@{
  id=$name;file="preservation-$name.rws";sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();bytes=(Get-Item -LiteralPath $file).Length
  version=$xml.SelectSingleNode('//meta/gameVersion').InnerText;active_mods=@($xml.SelectNodes('//meta/modIds/li')|ForEach-Object{$_.InnerText});tick=[int]$xml.SelectSingleNode('//tickManager/ticksGame').InnerText
  map_size=$size;temperature_grid_bytes=$bytes.Length;meals=$meals
  outdoor_control_cell_temperature_c=(Temperature @(114,0,137))
  cooler=[ordered]@{id=[string]$cooler.id;pos=(Position $cooler.pos);target_c=(Number $cooler.targetTemperature);power_on_serialized=if($cooler.SelectSingleNode('powerOn')){[string]$cooler.powerOn}else{$null}}
 }
}
ConvertTo-Json -InputObject $result -Depth 12
