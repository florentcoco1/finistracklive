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

## Lancement automatique au démarrage (Windows)

1. Crée un fichier `start-uploader.bat` à côté de `uploader.py` :
   ```bat
   @echo off
   cd /d "%~dp0"
   python uploader.py
   pause
   ```
2. Mets un raccourci dans `shell:startup` (Win+R → `shell:startup`).

## Sécurité

`config.json` contient ton mot de passe — ne le partage pas et ne le mets pas sur un dépôt public.
