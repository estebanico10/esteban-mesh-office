Add-Type -AssemblyName System.Drawing

$outDir = $PSScriptRoot
$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# Background rounded rect (dark slate -> deep emerald/indigo)
$bgRect = New-Object System.Drawing.Rectangle(8, 8, 240, 240)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 56
$path.AddArc(8, 8, $r, $r, 180, 90)
$path.AddArc(248 - $r, 8, $r, $r, 270, 90)
$path.AddArc(248 - $r, 248 - $r, $r, $r, 0, 90)
$path.AddArc(8, 248 - $r, $r, $r, 90, 90)
$path.CloseFigure()

$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(0, 0)),
  (New-Object System.Drawing.Point(256, 256)),
  ([System.Drawing.Color]::FromArgb(255, 11, 24, 38)),
  ([System.Drawing.Color]::FromArgb(255, 7, 15, 24))
)
$g.FillPath($bgBrush, $path)
$borderPen = New-Object System.Drawing.Pen(([System.Drawing.Color]::FromArgb(160, 16, 185, 129)), 6)
$g.DrawPath($borderPen, $path)

# Draw 6-node enterprise mesh ring + center hub
$cx = 128; $cy = 128; $rad = 68
$pts = @()
for ($i = 0; $i -lt 6; $i++) {
  $ang = ($i * 60 - 90) * [Math]::PI / 180.0
  $pts += New-Object System.Drawing.PointF(([float]($cx + $rad * [Math]::Cos($ang))), ([float]($cy + $rad * [Math]::Sin($ang))))
}

$linePen = New-Object System.Drawing.Pen(([System.Drawing.Color]::FromArgb(180, 52, 211, 153)), 6)
for ($i = 0; $i -lt 6; $i++) {
  $next = ($i + 1) % 6
  $g.DrawLine($linePen, $pts[$i], $pts[$next])
  $g.DrawLine($linePen, (New-Object System.Drawing.PointF($cx, $cy)), $pts[$i])
}

$nodeBrush = New-Object System.Drawing.SolidBrush(([System.Drawing.Color]::FromArgb(255, 56, 189, 248)))
foreach ($p in $pts) {
  $g.FillEllipse($nodeBrush, $p.X - 15, $p.Y - 15, 30, 30)
}

$hubBrush = New-Object System.Drawing.SolidBrush(([System.Drawing.Color]::FromArgb(255, 16, 185, 129)))
$g.FillEllipse($hubBrush, $cx - 26, $cy - 26, 52, 52)
$innerBrush = New-Object System.Drawing.SolidBrush(([System.Drawing.Color]::FromArgb(255, 9, 13, 20)))
$g.FillEllipse($innerBrush, $cx - 11, $cy - 11, 22, 22)

$pngPath = Join-Path $outDir "icon.png"
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Build multi-size ICO (32, 48, 64, 256) with PNG payload
$icoPath = Join-Path $outDir "icon.ico"
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $ms.ToArray()
$ms.Dispose()

$fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]1)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length)
$bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Close()
$fs.Close()

$g.Dispose()
$bmp.Dispose()
Write-Output "OFFICE_ICON_OK"
