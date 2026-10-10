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

# Two 4-point sparkles (concave 8-gon, outer/inner radius alternating).
# Big star at upper-left, small star at lower-right with clear spacing.
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)

function Add-Sparkle($cx, $cy, $outer, $inner) {
    $pts = @()
    for ($i = 0; $i -lt 8; $i++) {
        $ang = [Math]::PI / 4 * $i - [Math]::PI / 2
        $rad = $inner
        if ($i % 2 -eq 0) { $rad = $outer }
        $x = $cx + $rad * [Math]::Cos($ang)
        $y = $cy - $rad * [Math]::Sin($ang)
        $pts += (New-Object System.Drawing.PointF($x, $y))
    }
    $script:g.FillPolygon($script:white, $pts)
}

Add-Sparkle 210 210 96 33
Add-Sparkle 326 326 72 25

$out = Join-Path $PSScriptRoot "..\icon.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "Saved $out"
