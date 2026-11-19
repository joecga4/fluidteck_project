# Compara el texto de los Formula Node guardado dentro de una .vi con los archivos .c.
# No abre LabVIEW ni modifica nada: el .vi guarda el diagrama en bloques zlib y el texto
# de los nodos esta ahi en claro.
#
#   pwsh pruebas\comprueba_vi.ps1                                   (v16, PID.c y ParamPID.c)
#   pwsh pruebas\comprueba_vi.ps1 -Vi otra.vi -Textos Pid.c,Uph.c,Entradas.c
#
# Guardar la VI antes de comprobar. Sale con 0 si todos los textos coinciden.
param(
    [string]$Vi = (Join-Path $PSScriptRoot '..\FluidtekPrensaCONidentLEDI_v16.vi'),
    [string[]]$Textos = @((Join-Path $PSScriptRoot '..\PID.c'), (Join-Path $PSScriptRoot '..\ParamPID.c'))
)
$ErrorActionPreference = 'Stop'
$Textos = @($Textos | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$latin = [Text.Encoding]::GetEncoding(28591)

function Normaliza([string]$s) {
    # sin retornos de carro ni espacios al final de linea
    $l = $s.Replace("`r", '').Split("`n") | ForEach-Object { $_.TrimEnd() }
    while ($l.Count -gt 0 -and $l[-1] -eq '') { $l = $l[0..($l.Count - 2)] }
    return ,$l
}

# ---- bloques zlib de la .vi
$b = [IO.File]::ReadAllBytes((Resolve-Path $Vi))
$bloques = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $b.Length - 2; $i++) {
    if ($b[$i] -ne 0x78) { continue }
    $n = $b[$i + 1]
    if ($n -ne 0x01 -and $n -ne 0x5E -and $n -ne 0x9C -and $n -ne 0xDA) { continue }
    try {
        $ms = New-Object IO.MemoryStream($b, $i, ($b.Length - $i))
        $z = New-Object IO.Compression.ZLibStream($ms, [IO.Compression.CompressionMode]::Decompress)
        $o = New-Object IO.MemoryStream
        $z.CopyTo($o)
        if ($o.Length -gt 2000) { $bloques.Add($latin.GetString($o.ToArray())) }
    } catch { }
}
Write-Host ("{0}  ({1})" -f (Split-Path $Vi -Leaf), (Get-Item $Vi).LastWriteTime.ToString('yyyy-MM-dd HH:mm'))

$fallos = 0
foreach ($ruta in $Textos) {
    $nombre = Split-Path $ruta -Leaf
    $arch = Normaliza ($latin.GetString([IO.File]::ReadAllBytes((Resolve-Path $ruta))))
    # la segunda linea de la cabecera identifica el nodo (la primera es solo "/* ====")
    $clave = $arch[1].Trim()
    $hallado = $false
    foreach ($blk in $bloques) {
        $p = $blk.IndexOf($clave, [StringComparison]::Ordinal)
        if ($p -lt 0) { continue }
        $hallado = $true
        $ini = $blk.LastIndexOf('/*', $p, [StringComparison]::Ordinal)
        $nodo = Normaliza ($blk.Substring($ini, [Math]::Min($blk.Length - $ini, 200000)))
        $dif = @()
        for ($k = 0; $k -lt $arch.Count; $k++) {
            # la ultima linea del nodo va seguida de datos binarios: basta con que empiece igual
            $ok = if ($k -eq $arch.Count - 1) { $k -lt $nodo.Count -and $nodo[$k].StartsWith($arch[$k], [StringComparison]::Ordinal) } else { $k -lt $nodo.Count -and $nodo[$k] -ceq $arch[$k] }
            if (-not $ok) { $dif += $k + 1 }
        }
        if ($dif.Count -eq 0) {
            Write-Host ("  {0,-14} IGUAL ({1} lineas)" -f $nombre, $arch.Count)
        } else {
            $fallos++
            Write-Host ("  {0,-14} DISTINTO en {1} lineas; la primera, la {2}:" -f $nombre, $dif.Count, $dif[0])
            Write-Host ("      archivo: {0}" -f $arch[$dif[0] - 1])
            Write-Host ("      VI     : {0}" -f $(if ($dif[0] - 1 -lt $nodo.Count) { $nodo[$dif[0] - 1] } else { '(no hay)' }))
        }
        break
    }
    if (-not $hallado) { $fallos++; Write-Host ("  {0,-14} NO ESTA en la VI (se busco: '{1}')" -f $nombre, $clave) }
}
exit $fallos
