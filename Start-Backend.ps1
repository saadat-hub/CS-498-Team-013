$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$portable=Get-ChildItem -Path (Join-Path $PSScriptRoot '.tools\node-*\node.exe') -ErrorAction SilentlyContinue | Select-Object -First 1
if($portable){$env:PATH=$portable.DirectoryName+';'+$env:PATH}
if(-not (Get-Command node -ErrorAction SilentlyContinue)){throw 'Install Node.js 22 or newer, then run this script again.'}
if(-not (Test-Path -LiteralPath '.env')){throw 'Configure the required service environment before starting the API. See docs/DEPLOYMENT.md.'}
if(-not (Test-Path -LiteralPath 'node_modules')){& npm.cmd ci; if($LASTEXITCODE){exit $LASTEXITCODE}}
& npm.cmd run build
if($LASTEXITCODE){exit $LASTEXITCODE}
& npm.cmd start
