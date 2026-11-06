Add-Type -AssemblyName System.Data
$config = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
$config['Data Source'] = "$($env:STAGING_HOST),$($env:STAGING_PORT)"
$config['Initial Catalog'] = $env:STAGING_DATABASE
$config['User ID'] = $env:STAGING_USER
$config['Password'] = $env:STAGING_PASSWORD
$config['Integrated Security'] = $false
$config['Encrypt'] = $false
$config['TrustServerCertificate'] = $true
$config['Connect Timeout'] = 10
$connection = New-Object System.Data.SqlClient.SqlConnection($config.ConnectionString)
try {
  $connection.Open()
  $command = $connection.CreateCommand()
  $command.CommandText = 'SELECT DB_NAME()'
  Write-Output "Microsoft SqlClient connected: $($command.ExecuteScalar())"
} catch {
  $errorObject = $_.Exception.GetBaseException()
  if ($errorObject -is [System.Data.SqlClient.SqlException]) {
    foreach ($item in $errorObject.Errors) {
      Write-Output "Microsoft SqlClient error: code=$($item.Number), state=$($item.State), message=$($item.Message.Replace($env:STAGING_PASSWORD, '[REDACTED]'))"
    }
  } else {
    Write-Output 'Microsoft SqlClient tidak dapat menjalankan pemeriksaan.'
  }
  exit 1
} finally {
  $connection.Dispose()
}
