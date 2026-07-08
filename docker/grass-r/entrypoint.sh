#!/bin/sh
set -e

# Entorno genérico GRASS + R, reusable para cualquier script de la tubería
# (03A, 03B, 04 más adelante). El primer argumento es el .R a correr, el
# resto se pasa tal cual a ese script (p.ej. los años).
script="$1"
shift

# Si hay service account key, autenticar gcloud/gsutil de forma no
# interactiva (lo usa 03B_uploadToGEE.R vía system2("gsutil", ...)) y
# exponer GOOGLE_APPLICATION_CREDENTIALS para cualquier librería que la
# busque por Application Default Credentials. `|| true` porque 03A no
# necesita esto — sólo usa key.json directo en R, sin gcloud/gsutil CLI.
if [ -f "key.json" ]; then
  export GOOGLE_APPLICATION_CREDENTIALS="$(pwd)/key.json"
  gcloud auth activate-service-account --key-file=key.json --quiet || true
fi

Rscript "$script" "$@"
