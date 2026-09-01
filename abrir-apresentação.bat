@echo off
setlocal
title Apresentacao CMT - servidor local
set "PRES_ROOT=%~dp0"
set "PRES_SELF=%~f0"
echo.
echo  Iniciando a apresentacao...
echo  Mantenha esta janela ABERTA enquanto estiver apresentando.
echo  Feche esta janela ao terminar para encerrar o servidor local.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:PRES_SELF); $m=$t -split (':::'+'PS'+':::'),2; iex $m[1]"
endlocal
exit /b
:::PS:::
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($env:PRES_ROOT.TrimEnd('\'))
$alvo = [IO.Directory]::GetFiles($root, 'apresenta*.html'); $pagina = if ($alvo.Length -gt 0) { Get-Item -LiteralPath $alvo[0] -Force } else { $null }
if (-not $pagina) { Write-Host 'ERRO: pagina principal nao encontrada nesta pasta.'; Start-Sleep 10; exit 1 }

$listener = $null; $port = 0
foreach ($cand in 8123, 8124, 8125, (Get-Random -Minimum 49152 -Maximum 65500)) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$cand/")
    $l.Start(); $listener = $l; $port = $cand; break
  } catch { }
}
if (-not $listener) {
  Write-Host 'Nao foi possivel iniciar o servidor local; abrindo o arquivo diretamente.'
  Start-Process $pagina.FullName; exit 0
}

$mime = @{
  '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'
  '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8'
  '.json'='application/json; charset=utf-8'; '.svg'='image/svg+xml'
  '.webp'='image/webp'; '.avif'='image/avif'; '.png'='image/png'
  '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.gif'='image/gif'; '.ico'='image/x-icon'
  '.woff2'='font/woff2'; '.woff'='font/woff'; '.ttf'='font/ttf'
  '.mp4'='video/mp4'; '.webm'='video/webm'; '.pdf'='application/pdf'
  '.txt'='text/plain; charset=utf-8'; '.xml'='application/xml'
}

$url = "http://localhost:$port/"
Write-Host "Servidor local ativo em $url"
Write-Host 'Feche esta janela para encerrar.'
if ($env:PRES_NOBROWSER -ne '1') { Start-Process $url }

while ($true) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/') -replace '/', '\'
    $full = if ($rel -eq '') { $pagina.FullName } else { [IO.Path]::GetFullPath((Join-Path $root $rel)) }
    if (-not $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($full)) {
      $res.StatusCode = 404
    } else {
      $info = Get-Item -LiteralPath $full -Force
      $stamp = $info.LastWriteTimeUtc.ToString('R')
      $desde = $ctx.Request.Headers['If-Modified-Since']
      if ($desde -eq $stamp) {
        $res.StatusCode = 304
      } else {
        $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
        $tipo = $mime[$ext]; if (-not $tipo) { $tipo = 'application/octet-stream' }
        $res.ContentType = $tipo
        $res.Headers['Last-Modified'] = $stamp
        $res.Headers['Cache-Control'] = 'no-cache'
        $bytes = [IO.File]::ReadAllBytes($full)
        $res.ContentLength64 = $bytes.Length
        if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
      }
    }
  } catch {
    try { $res.StatusCode = 500 } catch { }
  } finally {
    try { $res.Close() } catch { }
  }
}
