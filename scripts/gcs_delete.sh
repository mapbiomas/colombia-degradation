#!/bin/bash
# Elimina archivos en GCS. Usa el contenedor Docker para la autenticación.
#
# Uso:
#   ./gcs_delete.sh <gcs_path>
#
# Ejemplos:
#   ./gcs_delete.sh gs://mbcolombia-degradacion/AUXILIARES/DEGRADACION/COL_3/results_morphology/30471/
#   ./gcs_delete.sh gs://mbcolombia-degradacion/AUXILIARES/DEGRADACION/COL_3/results_morphology/30471/morphology_1985_30471.tif

set -euo pipefail

# <-- cambiar aquí la ruta a borrar (se puede sobreescribir pasándola como argumento)
GCS_PATH="gs://mbcolombia-degradacion/AUXILIARES/DEGRADACION/COL_3/results/"

IMAGE="degradacion-r-steps:latest"

# Si se pasa un argumento, tiene prioridad sobre el valor de arriba
if [ $# -gt 0 ]; then
  GCS_PATH="$1"
fi

# Listar lo que se va a borrar
echo "Archivos encontrados en: $GCS_PATH"
echo ""
docker run --rm \
  -v "$(pwd)":/work \
  --entrypoint bash \
  "$IMAGE" -c "
    export PATH=\$PATH:/opt/google-cloud-sdk/bin
    gcloud auth activate-service-account --key-file=/work/key.json --quiet 2>/dev/null
    gcloud storage ls -r '$GCS_PATH' 2>&1
  "

echo ""
read -r -p "¿Confirmar eliminación? [s/N] " confirm
if [[ ! "$confirm" =~ ^[sS]$ ]]; then
  echo "Cancelado."
  exit 0
fi

echo ""
echo "Eliminando..."
docker run --rm \
  -v "$(pwd)":/work \
  --entrypoint bash \
  "$IMAGE" -c "
    export PATH=\$PATH:/opt/google-cloud-sdk/bin
    gcloud auth activate-service-account --key-file=/work/key.json --quiet 2>/dev/null
    gcloud storage rm -r '$GCS_PATH' 2>&1
  "

echo ""
echo "Listo."
