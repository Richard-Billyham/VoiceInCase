param(
    [string]$PythonRuntime = "",
    [switch]$CreateRuntime,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Resolve-Path (Join-Path $scriptDir "..")
$runtimeRoot = Join-Path $appDir "src-tauri\resources\ocr"
$serviceRoot = Join-Path $runtimeRoot "service"
$sourcePythonDir = Join-Path $appDir "src-tauri\python"
$sourceOcrPackage = Join-Path $sourcePythonDir "ivic_ocr"
$layoutService = Join-Path $sourcePythonDir "ivic_invoice_layout.py"
$requirements = Join-Path $appDir "ocr_requirements.txt"

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

if ($Clean -and (Test-Path $runtimeRoot)) {
    Get-ChildItem -LiteralPath $runtimeRoot -Force |
        Where-Object { $_.Name -notin @(".gitkeep", "README.md") } |
        Remove-Item -Recurse -Force
}

if (!(Test-Path $sourceOcrPackage)) {
    throw "Missing OCR package: $sourceOcrPackage"
}
if (!(Test-Path $layoutService)) {
    throw "Missing layout service: $layoutService"
}
if (!(Test-Path $requirements)) {
    throw "Missing OCR requirements: $requirements"
}

if (!$PythonRuntime) {
    $PythonRuntime = Join-Path $appDir ".ocr-runtime"
}
$PythonRuntime = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($PythonRuntime)

if ($CreateRuntime) {
    if (!(Get-Command python -ErrorAction SilentlyContinue)) {
        throw "python was not found on PATH. Install Python or pass -PythonRuntime to an existing OCR runtime."
    }
    if (!(Test-Path (Join-Path $PythonRuntime "Scripts\python.exe"))) {
        python -m venv $PythonRuntime
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create OCR Python runtime at: $PythonRuntime"
        }
    }
    $runtimePython = Join-Path $PythonRuntime "Scripts\python.exe"
    Invoke-Checked $runtimePython @("-m", "pip", "install", "--upgrade", "pip")
    Invoke-Checked $runtimePython @("-m", "pip", "install", "-r", $requirements)
}

if (!(Test-Path (Join-Path $PythonRuntime "Scripts\python.exe"))) {
    throw "Missing OCR Python runtime. Expected Scripts\python.exe under: $PythonRuntime. Use -CreateRuntime to create it."
}
$runtimePython = Join-Path $PythonRuntime "Scripts\python.exe"
Invoke-Checked $runtimePython @("-c", "import fitz, PIL, rapidocr, onnxruntime")

New-Item -ItemType Directory -Force -Path $runtimeRoot, $serviceRoot | Out-Null
Get-ChildItem -LiteralPath $serviceRoot -Force | Remove-Item -Recurse -Force

$pythonTarget = Join-Path $runtimeRoot "python"
if (Test-Path $pythonTarget) {
    Remove-Item -LiteralPath $pythonTarget -Recurse -Force
}
Copy-Item -LiteralPath $PythonRuntime -Destination $pythonTarget -Recurse -Force

$packageTarget = Join-Path $serviceRoot "ivic_ocr"
if (Test-Path $packageTarget) {
    Remove-Item -LiteralPath $packageTarget -Recurse -Force
}
Copy-Item -LiteralPath $sourceOcrPackage -Destination $packageTarget -Recurse -Force
Copy-Item -LiteralPath $layoutService -Destination (Join-Path $serviceRoot "ivic_invoice_layout.py") -Force
Get-ChildItem -LiteralPath $serviceRoot -Recurse -Directory -Filter "__pycache__" |
    Remove-Item -Recurse -Force

Write-Host "OCR runtime staged at: $runtimeRoot"
