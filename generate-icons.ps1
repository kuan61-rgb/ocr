Add-Type -AssemblyName System.Drawing

$iconDir = Join-Path $PSScriptRoot 'icons'
if (-not (Test-Path $iconDir)) { New-Item -ItemType Directory -Path $iconDir | Out-Null }

function New-Icon($size, $path) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

  # 圓角藍底
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(37, 99, 235))
  $g.FillRectangle($bg, 0, 0, $size, $size)

  # 白色文字 "OCR"
  $fontSize = [int]($size * 0.38)
  $font = New-Object System.Drawing.Font 'Arial', $fontSize, ([System.Drawing.FontStyle]::Bold)
  $fg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
  $g.DrawString('OCR', $font, $fg, $rect, $sf)

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $font.Dispose(); $bg.Dispose(); $fg.Dispose()
  Write-Host "Created $path"
}

New-Icon 16  (Join-Path $iconDir 'icon16.png')
New-Icon 48  (Join-Path $iconDir 'icon48.png')
New-Icon 128 (Join-Path $iconDir 'icon128.png')
