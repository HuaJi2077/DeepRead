# Functional parse test for GBK bats from both web zips
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = "f:\WebProject\DeepReadProject\DeepRead"
$staging = "$root\release\web\DeepRead"
$gbk = [Text.Encoding]::GetEncoding(936)

function Get-BatFromZip($zipPath) {
  $z = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $e = $z.Entries | Where-Object { $_.Name -eq "start-prod.bat" } | Select-Object -First 1
    $ms = New-Object System.IO.MemoryStream
    $e.Open().CopyTo($ms)
    ,$ms.ToArray()
  } finally { $z.Dispose() }
}

function Make-TestBat($srcBytes, $destPath) {
  $t = $gbk.GetString($srcBytes)
  if ($t -match [char]0xFFFD) { return "DECODE-FAIL" }
  $t = $t -replace [regex]::Escape('%NODE_EXE% server\index.js'), 'echo RUNLINE=%NODE_EXE%'
  $t = $t -replace [regex]::Escape('node server\index.js'), 'echo RUNLINE=node'
  $t = $t -replace [regex]::Escape('start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:38617"'), 'echo BROWSERSKIP'
  $t = $t -replace '(?m)^\s*pause\s*$', 'rem pause'
  [IO.File]::WriteAllText($destPath, $t, $gbk)
  return "OK"
}

# 1) byte-level: GBK decode of zip bat contains proper Chinese
$full = Get-BatFromZip "$root\release\DeepRead-Web-0.0.0.zip"
$lite = Get-BatFromZip "$root\release\DeepRead-Web-Lite-0.0.0.zip"
"full bat GBK decode: " + ($(if ($gbk.GetString($full).Contains('启动本地服务')) { 'Chinese OK' } else { 'Chinese BROKEN' }))
"lite bat GBK decode: " + ($(if ($gbk.GetString($lite).Contains('启动本地服务')) { 'Chinese OK' } else { 'Chinese BROKEN' }))

# 2) run modified copies inside staging (has server/ and dist/)
$r1 = Make-TestBat $full "$staging\zz-test-full.bat"
$r2 = Make-TestBat $lite "$staging\zz-test-lite.bat"
"prepare: full=$r1 lite=$r2"

if ($r1 -eq 'OK') {
  $out1 = (& "$env:ComSpec" /c "$staging\zz-test-full.bat") 2>&1 | Out-String
  "---- full bat run ----"
  "markers: RUNLINE=$(if ($out1 -match 'RUNLINE=') {'HIT'} else {'MISS'}) BROWSERSKIP=$(if ($out1 -match 'BROWSERSKIP') {'HIT'} else {'MISS'})"
  "garbled-cmd: $(if ($out1 -match 'is not recognized|\x86\xFD...') {'YES-FAIL'} else {'none'})"
  "exit=$LASTEXITCODE"
}
if ($r2 -eq 'OK') {
  $out2 = (& "$env:ComSpec" /c "$staging\zz-test-lite.bat") 2>&1 | Out-String
  "---- lite bat run ----"
  "markers: RUNLINE=$(if ($out2 -match 'RUNLINE=') {'HIT'} else {'MISS'}) BROWSERSKIP=$(if ($out2 -match 'BROWSERSKIP') {'HIT'} else {'MISS'})"
  "exit=$LASTEXITCODE"
}

Remove-Item "$staging\zz-test-full.bat", "$staging\zz-test-lite.bat" -Force -ErrorAction SilentlyContinue
"cleanup done"
