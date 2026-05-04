# ============================================================
#  FinisTrackLive — Installation de la tâche planifiée Windows
#  Lance uploader.py automatiquement au démarrage de la session
# ============================================================
#
#  Utilisation :
#    1. Clic droit sur ce fichier > "Exécuter avec PowerShell"
#       (ou ouvrir PowerShell dans ce dossier puis : .\install-task.ps1)
#    2. Pour désinstaller :   .\install-task.ps1 -Uninstall
#
#  La tâche s'appelle "FinisTrackLive Uploader" et démarre à l'ouverture
#  de session de l'utilisateur courant. Elle est relancée si elle plante.

param(
    [switch]$Uninstall
)

$TaskName = "FinisTrackLive Uploader"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BatPath = Join-Path $ScriptDir "start-uploader.bat"

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "✅ Tâche '$TaskName' supprimée." -ForegroundColor Green
    } else {
        Write-Host "ℹ️  Aucune tâche '$TaskName' à supprimer." -ForegroundColor Yellow
    }
    exit 0
}

if (-not (Test-Path $BatPath)) {
    Write-Host "❌ Fichier introuvable : $BatPath" -ForegroundColor Red
    exit 1
}

# Vérifie Python
try {
    $pythonVersion = (python --version) 2>&1
    Write-Host "✅ Python détecté : $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Python n'est pas installé ou pas dans le PATH." -ForegroundColor Red
    Write-Host "   Télécharge-le ici : https://www.python.org/downloads/" -ForegroundColor Yellow
    exit 1
}

# Vérifie config.json
$ConfigPath = Join-Path $ScriptDir "config.json"
if (-not (Test-Path $ConfigPath)) {
    Write-Host "❌ config.json manquant. Copie config.example.json et complète-le avant d'installer." -ForegroundColor Red
    exit 1
}

# Supprime l'ancienne tâche si elle existe
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "ℹ️  Ancienne tâche supprimée." -ForegroundColor Yellow
}

# Action : exécuter le .bat dans son dossier
$Action = New-ScheduledTaskAction `
    -Execute $BatPath `
    -WorkingDirectory $ScriptDir

# Déclencheur : à l'ouverture de session de l'utilisateur courant
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Paramètres : autorise le redémarrage en cas d'échec, pas de limite de durée
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

# Principal : exécute en tant qu'utilisateur connecté, sans privilèges admin
$Principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Envoie le fichier de chrono GMCAP à FinisTrackLive toutes les minutes." | Out-Null

Write-Host ""
Write-Host "✅ Tâche '$TaskName' installée avec succès !" -ForegroundColor Green
Write-Host "   Elle démarrera automatiquement à chaque ouverture de session." -ForegroundColor Cyan
Write-Host ""
Write-Host "👉 Pour la lancer maintenant sans redémarrer :" -ForegroundColor Yellow
Write-Host "      Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "👉 Pour voir les logs en direct :" -ForegroundColor Yellow
Write-Host "      Get-Content -Path '$ScriptDir\logs\uploader-*.log' -Tail 20 -Wait"
Write-Host ""
Write-Host "👉 Pour désinstaller :" -ForegroundColor Yellow
Write-Host "      .\install-task.ps1 -Uninstall"
