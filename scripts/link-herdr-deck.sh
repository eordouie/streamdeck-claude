#!/usr/bin/env bash
# Symlink the herdr deck's plugin folder into the Stream Deck app's Plugins
# folder. macOS only. The app loads a newly linked plugin at its next start.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="com.eordouie.herdrdeck.sdPlugin"
DEST="${HOME}/Library/Application Support/com.elgato.StreamDeck/Plugins/${NAME}"

if [ ! -f "${ROOT}/${NAME}/bin/plugin.js" ]; then
  echo "error: ${NAME}/bin/plugin.js is missing: run 'pnpm build:deck' first" >&2
  exit 1
fi
mkdir -p "$(dirname "$DEST")"
if [ -L "$DEST" ] && [ "$(readlink "$DEST")" = "${ROOT}/${NAME}" ]; then
  echo "already linked: $DEST"
  exit 0
fi
if [ -L "$DEST" ]; then
  rm "$DEST"
elif [ -e "$DEST" ]; then
  echo "error: $DEST exists and is not a symlink; not touching it" >&2
  exit 1
fi
ln -s "${ROOT}/${NAME}" "$DEST"
echo "linked: $DEST -> ${ROOT}/${NAME}"
