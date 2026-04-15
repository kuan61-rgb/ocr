$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

$libDir = Join-Path $PSScriptRoot 'lib'
if (-not (Test-Path $libDir)) { New-Item -ItemType Directory -Path $libDir | Out-Null }

$base = 'https://unpkg.com/tesseract.js@5.1.1/dist'
$coreBase = 'https://unpkg.com/tesseract.js-core@5.1.1'

$files = @{
  # tesseract.js 主檔
  'tesseract.min.js' = "$base/tesseract.min.js"
  'worker.min.js'    = "$base/worker.min.js"

  # tesseract.js-core: 4 套 .wasm.js 載入器 + 對應的 .wasm 二進位
  'tesseract-core.wasm.js'              = "$coreBase/tesseract-core.wasm.js"
  'tesseract-core.wasm'                 = "$coreBase/tesseract-core.wasm"
  'tesseract-core-simd.wasm.js'         = "$coreBase/tesseract-core-simd.wasm.js"
  'tesseract-core-simd.wasm'            = "$coreBase/tesseract-core-simd.wasm"
  'tesseract-core-lstm.wasm.js'         = "$coreBase/tesseract-core-lstm.wasm.js"
  'tesseract-core-lstm.wasm'            = "$coreBase/tesseract-core-lstm.wasm"
  'tesseract-core-simd-lstm.wasm.js'    = "$coreBase/tesseract-core-simd-lstm.wasm.js"
  'tesseract-core-simd-lstm.wasm'       = "$coreBase/tesseract-core-simd-lstm.wasm"

  # 英文語言檔
  'eng.traineddata.gz' = 'https://github.com/naptha/tessdata/raw/gh-pages/4.0.0/eng.traineddata.gz'
}

foreach ($name in $files.Keys) {
  $url = $files[$name]
  $out = Join-Path $libDir $name
  Write-Host "Downloading $name ..."
  Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
}

Write-Host ""
Write-Host "Done. Files in lib/:"
Get-ChildItem $libDir | Select-Object Name, @{Name='SizeKB';Expression={[math]::Round($_.Length/1KB,1)}} | Format-Table
