#!/usr/bin/env bash
# Stage Tracker : installation, mise à jour et lancement en une commande (macOS / Linux) :
#   curl -fsSL https://raw.githubusercontent.com/NathanSignoud/stage-tracker/main/install.sh | bash
# Relancer la même commande met l'app à jour et la redémarre ; data/ et .env.local ne sont jamais touchés.
set -euo pipefail

REPO="NathanSignoud/stage-tracker"
DIR="${STAGE_TRACKER_DIR:-$HOME/stage-tracker}"
PORT="${PORT:-3000}"
say() { printf '\n\033[36m> %s\033[0m\n' "$1"; }
node_major() { node -v | sed -E 's/^v([0-9]+).*/\1/'; }

# 1. Node.js 22 ou plus
if ! command -v node >/dev/null || [ "$(node_major)" -lt 22 ]; then
  if command -v brew >/dev/null; then
    read -r -p "Node.js 22+ est nécessaire. L'installer maintenant avec Homebrew ? (O/n) " answer < /dev/tty || answer=""
    case "$answer" in [nN]*) ;; *) brew install node ;; esac
  fi
  if ! command -v node >/dev/null || [ "$(node_major)" -lt 22 ]; then
    echo "Installe Node.js 22 ou plus depuis https://nodejs.org puis relance cette commande."
    exit 1
  fi
fi

# 2. Code : dernière version du dépôt (les dossiers de code sont remplacés en entier, les données restent).
say "Téléchargement de Stage Tracker dans $DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
source_url="${STAGE_TRACKER_TARBALL:-https://codeload.github.com/$REPO/tar.gz/refs/heads/main}"
if { [ -f "$source_url" ] && tar -xzf "$source_url" -C "$tmp"; } || curl -fsSL "$source_url" | tar -xz -C "$tmp"; then
  src="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  mkdir -p "$DIR"
  for d in src scripts tests drizzle public; do rm -rf "${DIR:?}/$d"; done
  cp -R "$src/." "$DIR/"
elif [ -f "$DIR/package.json" ]; then
  echo "Mise à jour impossible : lancement de la version déjà installée."
else
  echo "Téléchargement impossible : vérifie ta connexion puis relance la commande."
  exit 1
fi

# 3. Dépendances puis lancement ; le navigateur s'ouvre dès que l'app répond.
cd "$DIR"
say "Installation des dépendances (la première fois : 1 à 3 minutes)"
npm install --no-audit --no-fund

url="http://127.0.0.1:$PORT"
(
  for _ in $(seq 180); do
    if curl -fs -o /dev/null "$url"; then
      if command -v open >/dev/null; then open "$url"; elif command -v xdg-open >/dev/null; then xdg-open "$url"; fi
      exit 0
    fi
    sleep 1
  done
) >/dev/null 2>&1 &
say "Stage Tracker démarre sur $url (Ctrl+C pour l'arrêter ; relance cette même commande la prochaine fois)"
PORT="$PORT" exec npm run dev
