param(
    [Parameter(Mandatory=$true)][int]$TargetProcessId,
    [ValidateSet('capture','click','rightclick','key','drag')][string]$Action='capture',
    [int]$X=0, [int]$Y=0, [int]$EndX=0, [int]$EndY=0,
    [ValidateSet('Escape','Enter','Space','F1','F2','F3','F4','Tab','Left','Right','Up','Down','1','2','3')][string]$Key='Escape',
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [int]$WaitMs=300
)
# Explicitly target one authorized game process. Never send input unless its window is foreground.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GameWindowProbe {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
}
'@
[GameWindowProbe]::SetProcessDPIAware() | Out-Null
$target=Get-Process -Id $TargetProcessId
if ($target.ProcessName -notlike 'RimWorld*') { throw 'This probe is restricted to the RimWorld process.' }
$handle=$target.MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { throw 'No game window yet.' }
if ([GameWindowProbe]::IsIconic($handle)) { [GameWindowProbe]::ShowWindow($handle,9) | Out-Null }
[GameWindowProbe]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 180
if ([GameWindowProbe]::GetForegroundWindow() -ne $handle) { throw 'Game did not become foreground; no input sent.' }
$rect=[GameWindowProbe+RECT]::new()
$point=[GameWindowProbe+POINT]::new()
[GameWindowProbe]::GetClientRect($handle,[ref]$rect) | Out-Null
[GameWindowProbe]::ClientToScreen($handle,[ref]$point) | Out-Null
$width=$rect.Right-$rect.Left; $height=$rect.Bottom-$rect.Top
if ($width -le 0 -or $height -le 0) { throw 'Game window has no capture area.' }
if ($Action -in @('click','rightclick','drag')) {
    if ($X -lt 0 -or $X -ge $width -or $Y -lt 0 -or $Y -ge $height) { throw 'Click is outside the game client.' }
    if ($Action -eq 'drag' -and ($EndX -lt 0 -or $EndX -ge $width -or $EndY -lt 0 -or $EndY -ge $height)) { throw 'Drag end is outside the game client.' }
    [GameWindowProbe]::SetCursorPos($point.X+$X,$point.Y+$Y) | Out-Null
    Start-Sleep -Milliseconds 80
    $down=if($Action -eq 'rightclick'){8}else{2}; $up=if($Action -eq 'rightclick'){16}else{4}
    [GameWindowProbe]::mouse_event($down,0,0,0,[UIntPtr]::Zero)
    try {
        if ($Action -eq 'drag') {
            for($i=1;$i -le 12;$i++) {
                [GameWindowProbe]::SetCursorPos($point.X+[int]($X+($EndX-$X)*$i/12),$point.Y+[int]($Y+($EndY-$Y)*$i/12)) | Out-Null
                Start-Sleep -Milliseconds 40
            }
        } else { Start-Sleep -Milliseconds 80 }
    } finally { [GameWindowProbe]::mouse_event($up,0,0,0,[UIntPtr]::Zero) }
} elseif ($Action -eq 'key') {
    $keys=@{Escape=27;Enter=13;Space=32;F1=112;F2=113;F3=114;F4=115;Tab=9;Left=37;Right=39;Up=38;Down=40;'1'=49;'2'=50;'3'=51}
    [GameWindowProbe]::keybd_event($keys[$Key],0,0,[UIntPtr]::Zero)
    Start-Sleep -Milliseconds 80
    [GameWindowProbe]::keybd_event($keys[$Key],0,2,[UIntPtr]::Zero)
}
Start-Sleep -Milliseconds ([Math]::Clamp($WaitMs,0,10000))
if ([GameWindowProbe]::GetForegroundWindow() -ne $handle) { throw 'Focus changed; skip potentially unrelated screenshot.' }
$absolute=[IO.Path]::GetFullPath($OutputPath)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($absolute)) | Out-Null
$bitmap=[Drawing.Bitmap]::new($width,$height)
$graphics=[Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.CopyFromScreen($point.X,$point.Y,0,0,$bitmap.Size)
    $bitmap.Save($absolute,[Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }
$record=[ordered]@{timestamp_utc=[DateTime]::UtcNow.ToString('o');pid=$TargetProcessId;process=$target.ProcessName;action=$Action;x=$X;y=$Y;end_x=$EndX;end_y=$EndY;key=$Key;width=$width;height=$height;image=$absolute}
$record | ConvertTo-Json -Compress | Add-Content -LiteralPath ($absolute+'.jsonl') -Encoding utf8
$record | ConvertTo-Json -Compress
