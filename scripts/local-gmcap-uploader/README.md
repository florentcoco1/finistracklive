# Uploader GMCAP local — FinisTrackLive

Petit script Python qui relit un fichier d'export GMCAP toutes les minutes et l'envoie automatiquement à FinisTrackLive pour rafraîchir le classement.

## Prérequis

- Python 3.9 ou supérieur ([télécharger](https://www.python.org/downloads/))
- Un compte organisateur sur FinisTrackLive (le même que celui utilisé pour gérer la course)

## Installation

1. Installe la dépendance :
   ```bash
   pip install requests
   ```

2. Copie `config.example.json` en `config.json` et complète :
   - `email` / `password` : ton compte organisateur FinisTrackLive
   - `race_id` : visible dans l'URL de la page d'admin de la course (`/races/<RACE_ID>`)
   - `file_path` : chemin absolu du fichier produit par ton logiciel de chrono
     - Windows : `"C:/GMCAP/exports/resultats.txt"` (utilise `/` ou double `\\`)
     - macOS/Linux : `"/Users/moi/exports/resultats.txt"`

## Lancement

```bash
python uploader.py
```

Le script :
- se connecte à ton compte
- toutes les 60 s, relit le fichier
- l'envoie au backend **uniquement si le contenu a changé**
- affiche le statut dans la console

Ferme la fenêtre ou `Ctrl+C` pour arrêter.

## Lancement automatique au démarrage (Windows — Planificateur de tâches)

Deux fichiers sont fournis :
- `start-uploader.bat` : lance `uploader.py` et écrit la sortie dans `logs/uploader-AAAA-MM-JJ.log`
- `install-task.ps1` : crée la tâche planifiée Windows qui exécute le `.bat` à chaque ouverture de session

### Installation (une seule fois)

1. Vérifie que `config.json` existe et est complété.
2. Clic droit sur `install-task.ps1` → **Exécuter avec PowerShell**.
   - Si Windows bloque le script, ouvre PowerShell dans le dossier et lance :
     ```powershell
     Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
     .\install-task.ps1
     ```
3. Une tâche **« FinisTrackLive Uploader »** est créée. Elle :
   - démarre automatiquement à chaque ouverture de session Windows
   - redémarre toute seule si elle plante (3 essais à 1 min d'intervalle)
   - tourne sans privilèges admin

### Commandes utiles

```powershell
# Lancer maintenant sans redémarrer
Start-ScheduledTask -TaskName "FinisTrackLive Uploader"

# Arrêter
Stop-ScheduledTask -TaskName "FinisTrackLive Uploader"

# Voir les logs en direct
Get-Content -Path .\logs\uploader-*.log -Tail 20 -Wait

# Désinstaller
.\install-task.ps1 -Uninstall
```

### Vérifier dans l'interface graphique

`Win+R` → `taskschd.msc` → **Bibliothèque du Planificateur de tâches** → tu y vois « FinisTrackLive Uploader ».

## Sécurité

`config.json` contient ton mot de passe — ne le partage pas et ne le mets pas sur un dépôt public.
