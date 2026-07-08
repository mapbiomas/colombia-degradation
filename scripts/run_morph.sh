#!/bin/bash
# Wrapper para correr 04A_fragmentation_morphology.R en Docker con un watchdog
# de espacio en disco. Mata el contenedor si ./grassdata supera MAX_GB.
#
# Uso:
#   ./run_morph.sh 1985
#   ./run_morph.sh 1985 1986 1987
#
# Ajusta MAX_GB según el espacio libre que tengas disponible.

set -euo pipefail

REGION=30471       # <-- cambiar aquí para correr otra región
MAX_GB=10          # Mata el contenedor si grassdata > este límite
INTERVAL=10        # Segundos entre cada chequeo de disco
WATCH_DIR="./grassdata"
IMAGE="degradacion-r-steps:latest"
CONTAINER="morph_$$"

if [ $# -eq 0 ]; then
  echo "Uso: $0 <año> [año2 ...]"
  exit 1
fi

# Limpiar grassdata de corridas anteriores antes de empezar
if [ -d "$WATCH_DIR" ]; then
  echo "Limpiando $WATCH_DIR de corridas anteriores..."
  rm -rf "$WATCH_DIR"
fi

echo "Iniciando contenedor '$CONTAINER' — región: $REGION — años: $*"
echo "Watchdog: mata si $WATCH_DIR > ${MAX_GB} GB (chequeo cada ${INTERVAL}s)"
echo ""

docker run --rm --name "$CONTAINER" \
  -v "$(pwd)":/work \
  "$IMAGE" \
  04A_fragmentation_morphology.R "$REGION" "$@" &

DOCKER_PID=$!

# Watchdog en background
(
  while kill -0 "$DOCKER_PID" 2>/dev/null; do
    sleep "$INTERVAL"
    SIZE_MB=$(du -sm "$WATCH_DIR" 2>/dev/null | awk '{print $1}')
    [ -z "$SIZE_MB" ] && continue
    echo "[watchdog] grassdata: ${SIZE_MB} MB"
    if [ "$SIZE_MB" -gt "$((MAX_GB * 1024))" ]; then
      echo ""
      echo "⛔  WATCHDOG: grassdata llegó a ${SIZE_MB} MB (límite: ${MAX_GB} GB)."
      echo "   Matando contenedor '$CONTAINER'..."
      docker stop "$CONTAINER" 2>/dev/null || true
      break
    fi
  done
) &

WATCHDOG_PID=$!

wait "$DOCKER_PID"
EXIT=$?

kill "$WATCHDOG_PID" 2>/dev/null || true

if [ "$EXIT" -eq 0 ]; then
  echo ""
  echo "✅ Completado con éxito."
else
  echo ""
  echo "❌ El contenedor terminó con error (código $EXIT) — posiblemente por el watchdog."
fi

exit "$EXIT"
