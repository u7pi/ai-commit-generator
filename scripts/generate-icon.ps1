Add-Type -AssemblyName System.Drawing

$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# Rounded-rectangle background
$radius = 110
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, ($radius * 2), ($radius * 2), 180, 90)
$path.AddArc(($size - $radius * 2), 0, ($radius * 2), ($radius * 2), 270, 90)
$path.AddArc(($size - $radius * 2), ($size - $radius * 2), ($radius * 2), ($radius * 2), 0, 90)
$path.AddArc(0, ($size - $radius * 2), ($radius * 2), ($radius * 2), 90, 90)
$path.CloseFigure()

# Violet -> indigo gradient
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(0, 0, $size, $size)),
    [System.Drawing.Color]::FromArgb(255, 124, 58, 237),
    [System.Drawing.Color]::FromArgb(255, 79, 70, 229),
    45.0
)
$g.FillPath($brush, $path)

# White 4-point sparkle (concave 8-gon, outer/outer radius alternating)
$cx = 256.0
$cy = 256.0
$outer = 170.0
$inner = 58.0
$pts = @()
for ($i = 0; $i -lt 8; $i++) {
    $ang = [Math]::PI / 4 * $i - [Math]::PI / 2
    $rad = $inner
    if ($i % 2 -eq 0) { $rad = $outer }
    $x = $cx + $rad * [Math]::Cos($ang)
    $y = $cy - $rad * [Math]::Sin($ang)
    $pts += (New-Object System.Drawing.PointF($x, $y))
}
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillPolygon($white, $pts)

$out = Join-Path $PSScriptRoot "..\icon.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "Saved $out"
