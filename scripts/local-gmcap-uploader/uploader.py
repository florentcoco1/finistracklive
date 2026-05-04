#!/usr/bin/env python3
"""
FinisTrackLive — Uploader GMCAP local
=====================================

Relit un fichier de résultats GMCAP toutes les minutes et l'envoie automatiquement
à FinisTrackLive pour mettre à jour le classement.

Usage :
    1. Installe Python 3.9+ sur le PC de chrono.
    2. Installe la dépendance :
           pip install requests
    3. Copie config.example.json vers config.json et complète tes infos.
    4. Lance :
           python uploader.py

Le script tourne en boucle. Ferme la fenêtre (Ctrl+C) pour l'arrêter.
"""

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("❌ Le module 'requests' est requis. Installe-le avec : pip install requests")
    sys.exit(1)

CONFIG_PATH = Path(__file__).parent / "config.json"
INTERVAL_SECONDS = 60  # 1 minute


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        log(f"❌ Fichier de config introuvable : {CONFIG_PATH}")
        log("   Copie config.example.json vers config.json et complète-le.")
        sys.exit(1)
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    required = ["supabase_url", "supabase_anon_key", "email", "password", "race_id", "file_path"]
    missing = [k for k in required if not cfg.get(k)]
    if missing:
        log(f"❌ Champs manquants dans config.json : {', '.join(missing)}")
        sys.exit(1)
    return cfg


def sign_in(cfg: dict) -> dict:
    """Connexion email/password → renvoie {access_token, refresh_token, expires_at}."""
    url = f"{cfg['supabase_url']}/auth/v1/token?grant_type=password"
    r = requests.post(
        url,
        headers={"apikey": cfg["supabase_anon_key"], "Content-Type": "application/json"},
        json={"email": cfg["email"], "password": cfg["password"]},
        timeout=15,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Échec authentification ({r.status_code}) : {r.text}")
    data = r.json()
    return {
        "access_token": data["access_token"],
        "refresh_token": data["refresh_token"],
        "expires_at": time.time() + int(data.get("expires_in", 3600)) - 60,
    }


def refresh_token(cfg: dict, refresh_token_value: str) -> dict:
    url = f"{cfg['supabase_url']}/auth/v1/token?grant_type=refresh_token"
    r = requests.post(
        url,
        headers={"apikey": cfg["supabase_anon_key"], "Content-Type": "application/json"},
        json={"refresh_token": refresh_token_value},
        timeout=15,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Échec refresh token ({r.status_code}) : {r.text}")
    data = r.json()
    return {
        "access_token": data["access_token"],
        "refresh_token": data["refresh_token"],
        "expires_at": time.time() + int(data.get("expires_in", 3600)) - 60,
    }


def read_file_content(path: str) -> str:
    """Lit le fichier en essayant plusieurs encodages (Windows / GMCAP exports)."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Fichier introuvable : {path}")
    raw = p.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def send_to_backend(cfg: dict, session: dict, content: str) -> tuple[bool, str]:
    url = f"{cfg['supabase_url']}/functions/v1/import-gmcap-rfid"
    file_name = Path(cfg["file_path"]).name
    r = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {session['access_token']}",
            "apikey": cfg["supabase_anon_key"],
            "Content-Type": "application/json",
        },
        json={"race_id": cfg["race_id"], "content": content, "file_name": file_name},
        timeout=60,
    )
    try:
        body = r.json()
    except Exception:
        body = {"raw": r.text}

    if r.status_code == 200 and body.get("ok"):
        msg = f"✅ Import OK — {body.get('imported', 0)} ligne(s), {body.get('matched', 0)} associée(s)"
        return True, msg
    return False, f"❌ HTTP {r.status_code} — {body}"


def main() -> None:
    cfg = load_config()
    log(f"📂 Fichier surveillé : {cfg['file_path']}")
    log(f"🏁 Race ID : {cfg['race_id']}")
    log(f"⏱  Envoi toutes les {INTERVAL_SECONDS}s. Ctrl+C pour arrêter.")

    log("🔐 Connexion à FinisTrackLive...")
    session = sign_in(cfg)
    log(f"✅ Connecté en tant que {cfg['email']}")

    last_hash = None
    while True:
        cycle_start = time.time()
        try:
            # Refresh token si proche expiration
            if time.time() >= session["expires_at"]:
                log("🔄 Rafraîchissement de la session...")
                session = refresh_token(cfg, session["refresh_token"])

            content = read_file_content(cfg["file_path"])
            content_hash = hash(content)

            if content_hash == last_hash:
                log("⏭  Aucun changement détecté — envoi sauté.")
            else:
                ok, msg = send_to_backend(cfg, session, content)
                log(msg)
                if ok:
                    last_hash = content_hash

        except FileNotFoundError as e:
            log(f"⚠️  {e}")
        except RuntimeError as e:
            log(f"⚠️  {e}")
            # Si auth perdue, on retente une connexion complète
            if "401" in str(e) or "auth" in str(e).lower():
                try:
                    session = sign_in(cfg)
                    log("✅ Reconnecté.")
                except Exception as e2:
                    log(f"❌ Reconnexion échouée : {e2}")
        except Exception as e:
            log(f"💥 Erreur inattendue : {e}")

        elapsed = time.time() - cycle_start
        sleep_for = max(1.0, INTERVAL_SECONDS - elapsed)
        time.sleep(sleep_for)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("👋 Arrêt demandé. Bye.")
