param(
 [Parameter(Mandatory=$true)][int]$TargetProcessId,
 [ValidateSet('capture','click','clickpause','doubleclick','rightclick','drag','text','key','hold','scroll','pulse')][string]$Action='capture',
 [int]$X=1280,[int]$Y=720,[string]$Text='',[int]$VirtualKey=27,[int]$DurationMs=80,
 [switch]$Control,[int]$WheelDelta=0,[int]$WaitMs=250,
 [int]$ParkX=1280,[int]$ParkY=720,[int]$EndX=1280,[int]$EndY=720,
 [Parameter(Mandatory=$true)][string]$OutputPath
)
# UI-only input to the existing isolated research process. No game code is injected.
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$profile=(Resolve-Path (Join-Path $project '.local-research/runtime/profile-exploration-20261104')).Path
$proc=Get-CimInstance Win32_Process -Filter "ProcessId=$TargetProcessId"
if(!$proc -or $proc.ExecutablePath -ne 'F:\SteamLibrary\steamapps\common\RimWorld\RimWorld.exe' -or !($proc.CommandLine.Contains("-savedatafolder=$profile") -or $proc.CommandLine.Contains('-savedatafolder="'+$profile+'"'))){throw 'Not the authorized isolated RimWorld process.'}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ExplorationInput {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref POINT p);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")] public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern short VkKeyScan(char c);
}
'@
[ExplorationInput]::SetProcessDPIAware()|Out-Null
$handle=(Get-Process -Id $TargetProcessId).MainWindowHandle
if([ExplorationInput]::IsIconic($handle)){[ExplorationInput]::ShowWindow($handle,9)|Out-Null}
[ExplorationInput]::SetForegroundWindow($handle)|Out-Null
Start-Sleep -Milliseconds 180
if([ExplorationInput]::GetForegroundWindow() -ne $handle){throw 'Target is not foreground; no input sent.'}
$rect=[ExplorationInput+RECT]::new();$origin=[ExplorationInput+POINT]::new()
[ExplorationInput]::GetClientRect($handle,[ref]$rect)|Out-Null
[ExplorationInput]::ClientToScreen($handle,[ref]$origin)|Out-Null
function Move-InClient([int]$cx,[int]$cy){
 if($cx -lt 0 -or $cx -ge $rect.Right -or $cy -lt 0 -or $cy -ge $rect.Bottom){throw 'Pointer is outside client.'}
 [ExplorationInput]::SetCursorPos($origin.X+$cx,$origin.Y+$cy)|Out-Null
}
$started=[DateTime]::UtcNow.ToString('o')
switch($Action){
 'drag' {
  Move-InClient $EndX $EndY
  Move-InClient $X $Y
  [ExplorationInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  try{
   Start-Sleep -Milliseconds 100
   for($step=1;$step -le 12;$step++){
    if([ExplorationInput]::GetForegroundWindow() -ne $handle){throw 'Focus changed during drag.'}
    Move-InClient ([int]($X+($EndX-$X)*$step/12)) ([int]($Y+($EndY-$Y)*$step/12))
    Start-Sleep -Milliseconds 40
   }
  }finally{[ExplorationInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)}
 }
 'clickpause' {
  # Close/accept an already inspected modal, select speed 1, then toggle Pause.
  # The pause button is a toggle, not an idempotent pause setter.
  # A modal may force-pause while the underlying speed is nonzero. The brief
  # interval between these clicks is retained; saved ticks remain authoritative.
  Move-InClient $X $Y
  $targetClickStart=[DateTime]::UtcNow.ToString('o')
  [ExplorationInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  try{Start-Sleep -Milliseconds 80}finally{[ExplorationInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)}
  # Allow the closing modal to leave the input stack before selecting speed.
  Start-Sleep -Milliseconds 500
  if([ExplorationInput]::GetForegroundWindow() -ne $handle){throw 'Focus changed after modal click.'}
  [ExplorationInput]::keybd_event(49,0,0,[UIntPtr]::Zero)
  try{Start-Sleep -Milliseconds 80}finally{[ExplorationInput]::keybd_event(49,0,2,[UIntPtr]::Zero)}
  Start-Sleep -Milliseconds 80
  Move-InClient 2441 1305
  $pauseStart=[DateTime]::UtcNow.ToString('o')
  [ExplorationInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  try{Start-Sleep -Milliseconds 160}finally{[ExplorationInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)}
  Start-Sleep -Milliseconds 100
 }
 'pulse' {
  # Preconditions: paused map, no modal, native2560x1440. Explicit speed starts;
  # one short bounded run ends with the Space pause key. Confirm with equal saves.
  if($VirtualKey -notin @(49,50,51)){throw 'Pulse requires speed1/2/3 key.'}
  if($DurationMs -lt 40 -or $DurationMs -gt 4000){throw 'Pulse is limited to40..4000ms.'}
  $runStart=[DateTime]::UtcNow.ToString('o')
  [ExplorationInput]::keybd_event([byte]$VirtualKey,0,0,[UIntPtr]::Zero)
  try{Start-Sleep -Milliseconds 40}finally{[ExplorationInput]::keybd_event([byte]$VirtualKey,0,2,[UIntPtr]::Zero)}
  Start-Sleep -Milliseconds $DurationMs
  if([ExplorationInput]::GetForegroundWindow() -ne $handle){throw 'Focus changed during bounded run.'}
  $pauseStart=[DateTime]::UtcNow.ToString('o')
  [ExplorationInput]::keybd_event(32,0,0,[UIntPtr]::Zero)
  try{Start-Sleep -Milliseconds 80}finally{[ExplorationInput]::keybd_event(32,0,2,[UIntPtr]::Zero)}
  Start-Sleep -Milliseconds 100
 }
 {$_ -in 'click','doubleclick','rightclick'} {
  Move-InClient $X $Y
  Start-Sleep -Milliseconds 100
  $down=if($Action -eq 'rightclick'){8}else{2};$up=if($Action -eq 'rightclick'){16}else{4}
  $count=if($Action -eq 'doubleclick'){2}else{1}
  for($i=0;$i -lt $count;$i++){
   [ExplorationInput]::mouse_event($down,0,0,0,[UIntPtr]::Zero)
   try{Start-Sleep -Milliseconds 80}finally{[ExplorationInput]::mouse_event($up,0,0,0,[UIntPtr]::Zero)}
   Start-Sleep -Milliseconds 100
  }
 }
 'text' {
  # Frame-paced keyboard events; Unity did not accept the initial SendKeys attempt.
  foreach($character in $Text.ToCharArray()){
   $mapping=[ExplorationInput]::VkKeyScan($character)
   if($mapping -lt 0 -or ($mapping -band 0x600)){throw 'Text needs an unsupported keyboard mapping.'}
   $shift=($mapping -band 0x100) -ne 0
   if($shift){[ExplorationInput]::keybd_event(16,0,0,[UIntPtr]::Zero)}
   [ExplorationInput]::keybd_event([byte]($mapping -band 255),0,0,[UIntPtr]::Zero)
   try{Start-Sleep -Milliseconds 40}finally{[ExplorationInput]::keybd_event([byte]($mapping -band 255),0,2,[UIntPtr]::Zero);if($shift){[ExplorationInput]::keybd_event(16,0,2,[UIntPtr]::Zero)}}
   Start-Sleep -Milliseconds 40
  }
 }
 {$_ -in 'key','hold'} {
  if($VirtualKey -lt 1 -or $VirtualKey -gt 255){throw 'Invalid virtual key.'}
  if($Control){[ExplorationInput]::keybd_event(17,0,0,[UIntPtr]::Zero)}
  [ExplorationInput]::keybd_event([byte]$VirtualKey,0,0,[UIntPtr]::Zero)
  try{Start-Sleep -Milliseconds ([Math]::Clamp($DurationMs,1,10000))}
  finally{[ExplorationInput]::keybd_event([byte]$VirtualKey,0,2,[UIntPtr]::Zero);if($Control){[ExplorationInput]::keybd_event(17,0,2,[UIntPtr]::Zero)}}
 }
 'scroll' {Move-InClient $X $Y;[ExplorationInput]::mouse_event(2048,0,0,[BitConverter]::ToUInt32([BitConverter]::GetBytes($WheelDelta),0),[UIntPtr]::Zero)}
}
Move-InClient $ParkX $ParkY
if([ExplorationInput]::GetForegroundWindow() -ne $handle){throw 'Focus changed after input.'}
& (Join-Path $PSScriptRoot 'native-window.ps1') -TargetProcessId $TargetProcessId -Action capture -OutputPath $OutputPath -WaitMs ([Math]::Clamp($WaitMs,0,10000))
$record=[ordered]@{started_utc=$started;finished_utc=[DateTime]::UtcNow.ToString('o');pid=$TargetProcessId;profile=$profile;action=$Action;x=$X;y=$Y;end_x=$EndX;end_y=$EndY;text=$Text;virtual_key=$VirtualKey;control=[bool]$Control;duration_ms=$DurationMs;wheel_delta=$WheelDelta;park_x=$ParkX;park_y=$ParkY;wait_ms=$WaitMs;run_start_utc=$runStart;target_click_start_utc=$targetClickStart;pause_start_utc=$pauseStart;image=[IO.Path]::GetFullPath($OutputPath)}
$record|ConvertTo-Json -Compress|Add-Content -LiteralPath ($OutputPath+'.actions.jsonl') -Encoding utf8
