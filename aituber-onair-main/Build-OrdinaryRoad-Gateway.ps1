$ErrorActionPreference = 'Stop'

$workspaceRoot = Split-Path $PSScriptRoot -Parent
$runtimeDir = Join-Path $workspaceRoot '.runtime'
$mavenVersion = '3.9.16'
$mavenHome = Join-Path $runtimeDir "apache-maven-$mavenVersion"
$maven = Join-Path $mavenHome 'bin\mvn.cmd'
$gatewayRoot = Join-Path $PSScriptRoot 'tools\ordinaryroad-gateway'

if (-not (Test-Path -LiteralPath $maven -PathType Leaf)) {
  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  $archive = Join-Path $runtimeDir "apache-maven-$mavenVersion-bin.zip"
  $baseUrl = "https://dlcdn.apache.org/maven/maven-3/$mavenVersion/binaries/apache-maven-$mavenVersion-bin.zip"
  & curl.exe -L --fail --retry 3 --connect-timeout 15 -o $archive $baseUrl
  if ($LASTEXITCODE -ne 0) { throw 'Unable to download Apache Maven.' }
  $expected = (& curl.exe -L --fail --silent "$baseUrl.sha512").Trim().Split(' ')[0]
  $actual = (Get-FileHash -Algorithm SHA512 -LiteralPath $archive).Hash
  if ($expected.ToLowerInvariant() -ne $actual.ToLowerInvariant()) {
    throw 'Apache Maven checksum verification failed.'
  }
  Expand-Archive -LiteralPath $archive -DestinationPath $runtimeDir -Force
}

& $maven -q -DskipTests package -f (Join-Path $gatewayRoot 'pom.xml')
if ($LASTEXITCODE -ne 0) { throw 'OrdinaryRoad gateway build failed.' }

$jar = Join-Path $gatewayRoot 'target\ordinaryroad-gateway.jar'
if (-not (Test-Path -LiteralPath $jar -PathType Leaf)) {
  throw "OrdinaryRoad gateway jar was not produced: $jar"
}
Write-Output $jar
