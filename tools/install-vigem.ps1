<#
.SYNOPSIS
    Instalador automatizado do driver ViGEmBus para o SeeMyGame.
.DESCRIPTION
    Verifica a presença do serviço de driver ViGEmBus (Virtual Gamepad Emulation Bus)
    e, caso ausente, efetua o download e instalação silenciosa do instalador assinado WHQL.
#>

param (
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  SeeMyGame - Instalador do Driver ViGEmBus (Gamepad)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Verifica se o serviço já está instalado e ativo
$service = Get-Service -Name "ViGEmBus" -ErrorAction SilentlyContinue

if ($service -and -not $Force) {
    if ($service.Status -eq "Running") {
        Write-Host "[OK] Driver ViGEmBus já está instalado e em execução (Status: Running)!" -ForegroundColor Green
        Write-Host "Os controles virtuais Xbox 360 do SeeMyGame estão prontos para uso." -ForegroundColor Green
        exit 0
    } else {
        Write-Host "[INFO] Serviço ViGEmBus encontrado com status: $($service.Status). Tentando iniciar..." -ForegroundColor Yellow
        try {
            Start-Service -Name "ViGEmBus"
            Write-Host "[OK] Serviço ViGEmBus iniciado com sucesso!" -ForegroundColor Green
            exit 0
        } catch {
            Write-Host "[AVISO] Não foi possível iniciar o serviço automaticamente: $_" -ForegroundColor Yellow
        }
    }
}

# 2. Localização de download do instalador oficial WHQL da Nefarius
$downloadUrl = "https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe"
$tempFile = Join-Path $env:TEMP "ViGEmBus_Setup.exe"

Write-Host "[DOWNLOAD] Baixando instalador oficial ViGEmBus v1.22.0..." -ForegroundColor Cyan
Write-Host "URL: $downloadUrl" -ForegroundColor Gray

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -UseBasicParsing
    Write-Host "[OK] Download concluído com sucesso: $tempFile" -ForegroundColor Green
} catch {
    Write-Error "Falha ao baixar o instalador do ViGEmBus. Verifique sua conexão à internet: $_"
    exit 1
}

# Do not execute a downloaded driver installer unless Windows validates its
# Authenticode signature. The URL alone is not an integrity check.
$signature = Get-AuthenticodeSignature -LiteralPath $tempFile
if ($signature.Status -ne 'Valid') {
    $status = $signature.Status
    $detail = if ($signature.StatusMessage) { ": $($signature.StatusMessage)" } else { '' }
    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
    throw "A assinatura Authenticode do instalador ViGEmBus não é válida ($status)$detail"
}
if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch 'Nefarius') {
    $subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '<desconhecido>' }
    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
    throw "O instalador ViGEmBus foi assinado por um certificado inesperado: $subject"
}
Write-Host "[OK] Assinatura Authenticode validada: $($signature.SignerCertificate.Subject)" -ForegroundColor Green

# 3. Execução da instalação silenciosa
Write-Host "[INSTALL] Iniciando instalação silenciosa..." -ForegroundColor Cyan
Write-Host "Aguarde enquanto o Windows registra o driver virtual no kernel..." -ForegroundColor Gray

try {
    $proc = Start-Process -FilePath $tempFile -ArgumentList "/passive", "/norestart" -PassThru -Wait
    if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) {
        Write-Host "[SUCESSO] Driver ViGEmBus instalado com êxito (ExitCode: $($proc.ExitCode))!" -ForegroundColor Green
    } else {
        Write-Host "[AVISO] Instalador retornou código: $($proc.ExitCode). Verifique permissões de administrador." -ForegroundColor Yellow
    }
} catch {
    Write-Error "Falha ao executar o instalador do ViGEmBus: $_"
    exit 1
} finally {
    if (Test-Path $tempFile) {
        Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
    }
}

# 4. Verificação pós-instalação
Start-Sleep -Seconds 2
$finalService = Get-Service -Name "ViGEmBus" -ErrorAction SilentlyContinue
if ($finalService) {
    Write-Host "[CONFIRMADO] Driver ViGEmBus ativo e pronto para receber conexões de controle!" -ForegroundColor Green
} else {
    Write-Host "[ATENÇÃO] O serviço ViGEmBus ainda não foi detectado. Pode ser necessário reiniciar o computador." -ForegroundColor Yellow
}
