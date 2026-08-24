$ErrorActionPreference = "Stop"
$projectRoot = "C:\Users\Usuario\Desktop\GC"
$batchesDir = Join-Path $projectRoot "scripts\kamino-live-batches"
$startFrom = if ($env:START_FROM) { [int]$env:START_FROM } else { 1 }

function Invoke-SupabaseQueryFile {
  param([string]$FilePath)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $output = & npx supabase db query --linked -f $FilePath 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  return @{ Output = $output; ExitCode = $code }
}

function Invoke-SupabaseQuerySql {
  param([string]$Sql)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $output = & npx supabase db query --linked $Sql 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  return @{ Output = $output; ExitCode = $code }
}

$batches = Get-ChildItem (Join-Path $batchesDir "batch-*.sql") |
  Sort-Object { [int]($_.BaseName -replace 'batch-','') }

$executed = 0
$failedBatch = $null
$errorMsg = $null

foreach ($batch in $batches) {
  $num = [int]($batch.BaseName -replace 'batch-','')
  if ($num -lt $startFrom) { continue }

  Write-Host "Executing $($batch.Name)..."
  try {
    Push-Location $projectRoot
    $result = Invoke-SupabaseQueryFile -FilePath $batch.FullName
    if ($result.ExitCode -ne 0) {
      throw $result.Output
    }
    $executed++
    Write-Host "OK $($batch.Name)"
  } catch {
    $failedBatch = $batch.Name
    $errorMsg = if ($_.Exception.Message) { $_.Exception.Message } else { ($_ | Out-String) }
    Write-Host "FAIL $($batch.Name): $errorMsg"
    @{
      batchesExecuted = $executed
      failedBatch = $failedBatch
      error = $errorMsg
    } | ConvertTo-Json
    exit 1
  } finally {
    Pop-Location
  }
}

Write-Host "Executing 99-run-sync.sql..."
Push-Location $projectRoot
$syncResult = Invoke-SupabaseQueryFile -FilePath (Join-Path $batchesDir "99-run-sync.sql")
if ($syncResult.ExitCode -ne 0) {
  Write-Host "Sync failed: $($syncResult.Output)"
  exit 1
}

$countResult = Invoke-SupabaseQuerySql -Sql "SELECT COUNT(*)::int AS staging_count FROM public._kamino_sync_staging;"
$recentResult = Invoke-SupabaseQuerySql -Sql "SELECT COUNT(*)::int AS updated_recently FROM public.students WHERE updated_at >= NOW() - INTERVAL '1 hour';"
Pop-Location

@{
  batchesExecuted = $executed
  syncOutput = $syncResult.Output.Trim()
  stagingCountOutput = $countResult.Output.Trim()
  studentsUpdatedOutput = $recentResult.Output.Trim()
  failedBatch = $null
  error = $null
} | ConvertTo-Json -Depth 5
