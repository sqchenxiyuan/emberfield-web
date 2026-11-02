param(
 [int]$TargetProcessId=29920,
 [ValidateSet('capture','click','doubleclick','rightclick','text','key','hold','scroll')][string]$Action='capture',
 [int]$X=1280,[int]$Y=720,[string]$Text='',[int]$VirtualKey=27,[int]$DurationMs=80,
 [switch]$Control,[int]$WheelDelta=0,[int]$WaitMs=250,
 [int]$ParkX=1280,[int]$ParkY=720,
 [Parameter(Mandatory=$true)][string]$OutputPath
)
# UI-only input to the existing isolated research process. No game code is injected.
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$profile=(Resolve-Path (Join-Path $project '.local-research/runtime/profile-20261102')).Path
$proc=Get-CimInstance Win32_Process -Filter "ProcessId=$TargetProcessId"
if(!$proc -or $proc.ExecutablePath -ne 'F:\SteamLibrary\steamapps\common\RimWorld\RimWorld.exe' -or !$proc.CommandLine.Contains("-savedatafolder=$profile")){throw 'Not the authorized isolated RimWorld process.'}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PreservationInput {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref POINT p);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")] public static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern short VkKeyScan(char c);
}
'@
[PreservationInput]::SetProcessDPIAware()|Out-Null
$handle=(Get-Process -Id $TargetProcessId).MainWindowHandle
[PreservationInput]::SetForegroundWindow($handle)|Out-Null
Start-Sleep -Milliseconds 180
if([PreservationInput]::GetForegroundWindow() -ne $handle){throw 'Target is not foreground; no input sent.'}
$rect=[PreservationInput+RECT]::new();$origin=[PreservationInput+POINT]::new()
[PreservationInput]::GetClientRect($handle,[ref]$rect)|Out-Null
[PreservationInput]::ClientToScreen($handle,[ref]$origin)|Out-Null
function Move-InClient([int]$cx,[int]$cy){
 if($cx -lt 0 -or $cx -ge $rect.Right -or $cy -lt 0 -or $cy -ge $rect.Bottom){throw 'Pointer is outside client.'}
 [PreservationInput]::SetCursorPos($origin.X+$cx,$origin.Y+$cy)|Out-Null
}
$started=[DateTime]::UtcNow.ToString('o')
switch($Action){
 {$_ -in 'click','doubleclick','rightclick'} {
  Move-InClient $X $Y
  Start-Sleep -Milliseconds 100
  $down=if($Action -eq 'rightclick'){8}else{2};$up=if($Action -eq 'rightclick'){16}else{4}
  $count=if($Action -eq 'doubleclick'){2}else{1}
  for($i=0;$i -lt $count;$i++){
   [PreservationInput]::mouse_event($down,0,0,0,[UIntPtr]::Zero)
   try{Start-Sleep -Milliseconds 80}finally{[PreservationInput]::mouse_event($up,0,0,0,[UIntPtr]::Zero)}
   Start-Sleep -Milliseconds 100
  }
 }
 'text' {
  # Frame-paced keyboard events; Unity did not accept the initial SendKeys attempt.
  foreach($character in $Text.ToCharArray()){
   $mapping=[PreservationInput]::VkKeyScan($character)
   if($mapping -lt 0 -or ($mapping -band 0x600)){throw 'Text needs an unsupported keyboard mapping.'}
   $shift=($mapping -band 0x100) -ne 0
   if($shift){[PreservationInput]::keybd_event(16,0,0,[UIntPtr]::Zero)}
   [PreservationInput]::keybd_event([byte]($mapping -band 255),0,0,[UIntPtr]::Zero)
   try{Start-Sleep -Milliseconds 40}finally{[PreservationInput]::keybd_event([byte]($mapping -band 255),0,2,[UIntPtr]::Zero);if($shift){[PreservationInput]::keybd_event(16,0,2,[UIntPtr]::Zero)}}
   Start-Sleep -Milliseconds 40
  }
 }
 {$_ -in 'key','hold'} {
  if($VirtualKey -lt 1 -or $VirtualKey -gt 255){throw 'Invalid virtual key.'}
  if($Control){[PreservationInput]::keybd_event(17,0,0,[UIntPtr]::Zero)}
  [PreservationInput]::keybd_event([byte]$VirtualKey,0,0,[UIntPtr]::Zero)
  try{Start-Sleep -Milliseconds ([Math]::Clamp($DurationMs,1,10000))}
  finally{[PreservationInput]::keybd_event([byte]$VirtualKey,0,2,[UIntPtr]::Zero);if($Control){[PreservationInput]::keybd_event(17,0,2,[UIntPtr]::Zero)}}
 }
 'scroll' {Move-InClient $X $Y;[PreservationInput]::mouse_event(2048,0,0,[BitConverter]::ToUInt32([BitConverter]::GetBytes($WheelDelta),0),[UIntPtr]::Zero)}
}
Move-InClient $ParkX $ParkY
if([PreservationInput]::GetForegroundWindow() -ne $handle){throw 'Focus changed after input.'}
& (Join-Path $PSScriptRoot 'native-window.ps1') -TargetProcessId $TargetProcessId -Action capture -OutputPath $OutputPath -WaitMs ([Math]::Clamp($WaitMs,0,10000))
$record=[ordered]@{started_utc=$started;finished_utc=[DateTime]::UtcNow.ToString('o');pid=$TargetProcessId;profile=$profile;action=$Action;x=$X;y=$Y;text=$Text;virtual_key=$VirtualKey;control=[bool]$Control;duration_ms=$DurationMs;wheel_delta=$WheelDelta;park_x=$ParkX;park_y=$ParkY;wait_ms=$WaitMs;image=[IO.Path]::GetFullPath($OutputPath)}
$record|ConvertTo-Json -Compress|Add-Content -LiteralPath ($OutputPath+'.actions.jsonl') -Encoding utf8
