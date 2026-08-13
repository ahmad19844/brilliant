<#
.SYNOPSIS
  Inventories devices on an authorized private LAN.

.DESCRIPTION
  This agent sends one ICMP echo request to each address in an explicitly supplied
  CIDR range (or the active adapter's /24 by default), then reads the local ARP/
  neighbour cache to associate discovered IPv4 addresses with MAC addresses. It
  never performs port scans, authentication attempts, remote commands, or file access.

.EXAMPLE
  .\tools\network-discovery-agent.ps1
  .\tools\network-discovery-agent.ps1 -Cidr 192.168.1.0/24 -CsvPath .\network-inventory.csv
#>
[CmdletBinding()]
param(
  [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}/([8-9]|1\d|2\d|30)$')]
  [string]$Cidr,
  [ValidateRange(50, 1000)]
  [int]$ThrottleLimit = 100,
  [string]$CsvPath = (Join-Path $PSScriptRoot '..\network-inventory.csv')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertTo-UInt32Ip([string]$IpAddress) {
  $bytes = [System.Net.IPAddress]::Parse($IpAddress).GetAddressBytes()
  [array]::Reverse($bytes)
  return [BitConverter]::ToUInt32($bytes, 0)
}

function ConvertFrom-UInt32Ip([uint32]$Value) {
  $bytes = [BitConverter]::GetBytes($Value)
  [array]::Reverse($bytes)
  return ([System.Net.IPAddress]::new($bytes)).ToString()
}

function Get-DefaultCidr {
  $config = Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled = True' |
    Where-Object { $_.IPAddress -match '^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\.' } |
    Select-Object -First 1
  if (-not $config) { throw 'No active private IPv4 network adapter was found. Supply -Cidr explicitly.' }
  $ip = $config.IPAddress | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -First 1
  $parts = $ip.Split('.'); return "$($parts[0]).$($parts[1]).$($parts[2]).0/24"
}

if (-not $Cidr) { $Cidr = Get-DefaultCidr }
$networkIp, $prefixText = $Cidr.Split('/')
$prefix = [int]$prefixText
$hostCount = [math]::Pow(2, 32 - $prefix) - 2
if ($hostCount -gt 4094) { throw "Refusing to scan $hostCount addresses. Use a CIDR of /20 or smaller to keep discovery safe and manageable." }

$base = ConvertTo-UInt32Ip $networkIp
$mask = [uint32](([uint64]0xffffffff) -shl (32 - $prefix))
$network = $base -band $mask
$targets = 1..$hostCount | ForEach-Object { ConvertFrom-UInt32Ip ([uint32]($network + $_)) }

Write-Host "Scanning $Cidr ($hostCount addresses) with ICMP discovery only..." -ForegroundColor Cyan
# Use .NET asynchronous pings so the agent works in both Windows PowerShell 5.1
# and PowerShell 7, without launching remote sessions or requiring extra modules.
$reachable = [System.Collections.Generic.List[string]]::new()
foreach ($batch in ($targets | ForEach-Object -Begin { $items = @() } -Process { $items += $_; if ($items.Count -ge $ThrottleLimit) { ,$items; $items = @() } } -End { if ($items.Count) { ,$items } })) {
  $requests = foreach ($ip in $batch) {
    $ping = [System.Net.NetworkInformation.Ping]::new()
    [pscustomobject]@{ IPAddress = $ip; Ping = $ping; Task = $ping.SendPingAsync($ip, 900) }
  }
  [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]($requests.Task), 2000) | Out-Null
  foreach ($request in $requests) {
    if ($request.Task.Status -eq 'RanToCompletion' -and $request.Task.Result.Status -eq 'Success') { $reachable.Add($request.IPAddress) }
    $request.Ping.Dispose()
  }
}

# Query Windows' neighbour table after pinging. This is safer and more reliable than
# parsing command-line output, and includes MAC addresses learned by ARP.
$neighbours = @{}
Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.LinkLayerAddress -and $_.LinkLayerAddress -notmatch '^00-00-00-00-00-00$') {
    $neighbours[$_.IPAddress] = $_.LinkLayerAddress
  }
}

$inventory = foreach ($ip in $reachable) {
  $hostname = try { [System.Net.Dns]::GetHostEntry($ip).HostName } catch { $null }
  [pscustomobject]@{
    IPAddress = $ip
    MACAddress = $neighbours[$ip]
    Hostname = $hostname
    Reachable = $true
    ScannedAt = (Get-Date).ToString('s')
  }
}

$inventory = $inventory | Sort-Object { ConvertTo-UInt32Ip $_.IPAddress }
$outputPath = [System.IO.Path]::GetFullPath($CsvPath)
$inventory | Export-Csv -Path $outputPath -NoTypeInformation -Encoding utf8
$inventory | Format-Table IPAddress, MACAddress, Hostname, Reachable -AutoSize
Write-Host "`nFound $($inventory.Count) reachable device(s). Saved inventory to: $outputPath" -ForegroundColor Green
