param([Parameter(Mandatory=$true)][string]$Prefix,[Parameter(Mandatory=$true)][string]$Tool,[Parameter(Mandatory=$true)][string]$Choice)
# UI-only menu navigation; stops before map target. Review capture before targeting.
$ErrorActionPreference='Stop'
$inputScript=Join-Path $PSScriptRoot 'trade-runtime-input.ps1'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$base=Join-Path $root ".local-research/runtime/$Prefix"
& $inputScript -Action click -X 1240 -Y 13 -WaitMs 80 -OutputPath "$base-menu.png"
& $inputScript -Action click -X 330 -Y 32 -WaitMs 80 -OutputPath "$base-actions-tab.png"
& $inputScript -Action click -X 90 -Y 32 -WaitMs 80 -OutputPath "$base-focus.png"
& $inputScript -Action key -VirtualKey 65 -Control -WaitMs 80 -OutputPath "$base-select.png"
& $inputScript -Action text -Text $Tool -WaitMs 80 -OutputPath "$base-search.png"
& $inputScript -Action click -X 80 -Y 100 -WaitMs 80 -OutputPath "$base-options.png"
& $inputScript -Action text -Text $Choice -WaitMs 80 -OutputPath "$base-choice.png"
& $inputScript -Action click -X 80 -Y 70 -WaitMs 100 -OutputPath "$base-tool.png"
