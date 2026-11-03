param([Parameter(Mandatory=$true)][string]$Prefix)
# UI-only helper: open the already verified normal Apply damage / Bullet tool.
# Stops before targeting; caller must inspect final capture and identify the pawn.
$ErrorActionPreference='Stop'
$inputScript=Join-Path $PSScriptRoot 'preservation-runtime-input.ps1'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$base=Join-Path $root ".local-research/runtime/$Prefix"
& $inputScript -Action click -X 1240 -Y 13 -WaitMs 100 -OutputPath "$base-menu.png"
& $inputScript -Action click -X 90 -Y 32 -WaitMs 100 -OutputPath "$base-focus.png"
& $inputScript -Action key -VirtualKey 65 -Control -WaitMs 100 -OutputPath "$base-select.png"
& $inputScript -Action text -Text 'Apply damage' -WaitMs 100 -OutputPath "$base-search.png"
& $inputScript -Action click -X 80 -Y 100 -WaitMs 100 -OutputPath "$base-options.png"
& $inputScript -Action text -Text Bullet -WaitMs 100 -OutputPath "$base-bullet.png"
& $inputScript -Action click -X 80 -Y 70 -WaitMs 150 -OutputPath "$base-tool.png"
