# Read retained original saves and crop two existing UI captures. Never runs the game.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime'
$evidence=Join-Path $root 'docs/research/rimworld/evidence'
function Hash-File([string]$path){(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
$saves=@(foreach($name in @('trade-rejected-verified-a','trade-rejected-verified-b','trade-buy-verified-a','trade-buy-verified-b')){
 $relative=".local-research/runtime/profile-20261102/Saves/$name.rws"
 $path=Join-Path $root $relative
 [xml]$doc=Get-Content -LiteralPath $path -Raw
 $map=$doc.SelectSingleNode('//thing[id="Human958"]').ParentNode.ParentNode
 $goods=@($map.SelectNodes('.//*[id and (def="Silver" or def="MedicineHerbal")]')|ForEach-Object {
  [ordered]@{id=[string]$_.id;def=[string]$_.def;count=if($_.stackCount){[int]$_.stackCount}else{1};owner=[string]$_.SelectSingleNode('ancestor::*[healthTracker][1]/id').InnerText;pos=[string]$_.pos}
 }|Sort-Object id)
 $merchant=$map.SelectSingleNode('./things/thing[id="Human78584"]')
 [ordered]@{name=$name;file=$relative;sha256=(Hash-File $path);tick=[int]$doc.SelectSingleNode('//tickManager/ticksGame').InnerText;merchantId=[string]$merchant.id;traderKind=[string]$merchant.trader.traderKind;goods=$goods}
})
Add-Type -AssemblyName System.Drawing
$images=@(foreach($entry in @(
 @{source='trade-083-herbal-price.png';name='native-trade-buy-quote.png';rect=@(768,0,1110,1415)},
 @{source='trade-070-grump-health.png';name='native-trade-health.png';rect=@(0,780,635,625)}
)){
 $source=Join-Path $runtime $entry.source
 $destination=Join-Path $evidence "runtime/$($entry.name)"
 $original=[System.Drawing.Bitmap]::new($source)
 try {
  $rectangle=[System.Drawing.Rectangle]::new($entry.rect[0],$entry.rect[1],$entry.rect[2],$entry.rect[3])
  $crop=$original.Clone($rectangle,$original.PixelFormat)
  try{$crop.Save($destination,[System.Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose()}
 }finally{$original.Dispose()}
 [ordered]@{source=".local-research/runtime/$($entry.source)";sourceSha256=(Hash-File $source);file="docs/research/rimworld/evidence/runtime/$($entry.name)";sha256=(Hash-File $destination);rectangle=$entry.rect}
})
$report=[ordered]@{
 kind='native-runtime-observed';version='1.7.4980 rev60';scope='Selected purchase endpoints and UI observations, not a complete trade experiment.'
 preparation='Developer-generated Shaman caravan in an isolated research profile; not a natural arrival or the implemented Outlander trader catalogs.'
 saves=$saves;images=$images
 observed=@('ordinary walk and trade dialog','cancellation UI','buy two herbal medicines','same herbal item identity moved from pack animal inventory to ground','27 silver transferred between the colony and this caravan')
 unobserved=@('completed sale','gifts','merchant shortfall confirmation','natural caravan arrival','full caravan departure','statistical probabilities','exact unrounded Talking capacity')
 terminal=[ordered]@{lastVerifiedSave='trade-buy-verified-b';lastVerifiedTick=189222;processId=29920;observedCurrentProcess='not-running';verificationUtc=[DateTime]::UtcNow.ToString('o')}
 limitations=@('Earlier pause/menu/Steam-notification and foreground failures are retained locally and are not controlled same-tick experiments.','Before and after purchase differ by 796 game ticks; only the selected goods and transfer are compared.','The 218 silver carried by unrelated visitor Human78393 is excluded from both trading parties.','All original saves and full screenshots remain local; this report contains selected summaries and crops.')
}
if(Get-Process -Id 29920 -ErrorAction SilentlyContinue){throw 'Terminal process state changed; review before freezing.'}
[IO.File]::WriteAllText((Join-Path $evidence 'native-trade-runtime.json'),(($report|ConvertTo-Json -Depth 12)+"`n"),[Text.UTF8Encoding]::new($false))
Write-Output 'Collected retained purchase endpoints and two UI crops; no new native execution.'
