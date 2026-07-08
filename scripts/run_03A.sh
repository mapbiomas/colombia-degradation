#!/bin/bash
# Corre 03A_fragmentation_id_size.R en paralelo — hasta MAX_JOBS contenedores
# simultáneos. Cuando uno termina, toma el siguiente año de la cola.
#
# Correr siempre desde colombia-degradation/:
#   ./scripts/run_03A.sh 1985 1986 1987 1988
#   ./scripts/run_03A.sh $(seq 1985 2024)
#
# Ajustar MAX_JOBS según RAM disponible (cada contenedor usa ~500 MB).

set -uo pipefail

MAX_JOBS=4        # <-- contenedores simultáneos
IMAGE="degradacion-r-steps:latest"

if [ $# -eq 0 ]; then
  echo "Uso: $0 <año> [año2 ...]"
  echo "Ejemplo: $0 \$(seq 1985 2024)"
  exit 1
fi

ts() { date '+%Y-%m-%d %H:%M:%S'; }

YEARS=("$@")
PIDS=()

echo "[$(ts)] ${#YEARS[@]} años — máx $MAX_JOBS contenedores en paralelo"
echo ""

for year in "${YEARS[@]}"; do

  # Purgar PIDs terminados y esperar si llegamos al límite
  while true; do
    ALIVE=()
    for pid in "${PIDS[@]+"${PIDS[@]}"}"; do
      kill -0 "$pid" 2>/dev/null && ALIVE+=("$pid")
    done
    PIDS=("${ALIVE[@]+"${ALIVE[@]}"}")
    [ ${#PIDS[@]} -lt "$MAX_JOBS" ] && break
    sleep 5
  done

  echo "[$(ts)] ▶ año $year  (${#PIDS[@]}/$MAX_JOBS slots ocupados)"
  docker run --rm \
    --name "03a_${year}" \
    -v "$(pwd)":/work \
    "$IMAGE" \
    03A_fragmentation_id_size.R "$year" &
  PIDS+=($!)

done

echo ""
echo "[$(ts)] Esperando últimos contenedores..."
wait
echo "[$(ts)] ✅ Todos los años completados."
