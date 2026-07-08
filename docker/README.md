# Docker — GRASS + R (local)

Imagen genérica (GRASS GIS + R + `rgrass` / `googleCloudStorageR` / `rgee` +
Google Cloud SDK + earthengine-api) para correr los scripts `.R` de la
tubería localmente. Los scripts se montan como volumen — se editan sin
reconstruir la imagen.

> **Todos los comandos de esta guía deben correrse desde el directorio
> `colombia-degradation/`**. Los `docker run` usan `"$(pwd)":/work` para
> montar el directorio actual — si se corre desde otro lugar, los paths
> de entrada/salida no funcionarán.

> **Windows**: la imagen corre bien (Docker Desktop + WSL2 backend, `linux/amd64`
> vía `--platform` en el Dockerfile). Pero `run_03A.sh`, `run_morph.sh` y
> `gcs_delete.sh` son scripts bash (`$(pwd)`, jobs en background, `kill -0`,
> `wait`) — no corren en PowerShell/cmd nativo. Correrlos desde una terminal
> **WSL2** (recomendado) o Git Bash.
>
> Sin bash, en PowerShell nativo usar `docker run` directo — pero con
> `${PWD}` en vez de `$(pwd)`. **`$(pwd)` es sintaxis bash y en PowerShell
> produce un volumen mal formado** (`docker: invalid reference format`,
> confirmado en la práctica, no solo en teoría). Cada comando `docker run`
> de esta guía trae su variante PowerShell equivalente. Sin bash también se
> pierde el pool paralelo de `run_03A.sh` y el watchdog de disco de
> `run_morph.sh` — correr un contenedor a la vez.

---

## 1. Service account (una vez)

1. `console.cloud.google.com` → proyecto `cloud-ee-lmedinaj`
2. IAM & Admin → Service Accounts → Create Service Account
3. Cloud Storage → Buckets → `mbcolombia-degradacion` → Permissions →
   Grant Access → la cuenta de servicio → rol **Storage Object Admin**
4. Para `03B` / `04B` (ingesta a Earth Engine): en el proyecto `mapbiomas-colombia`,
   asignar a la cuenta de servicio el rol **Earth Engine Resource Writer**
   (`roles/earthengine.writer`) — requiere permisos de administrador en ese proyecto
5. Keys → Add Key → Create new key → JSON
6. Guardar como `colombia-degradation/key.json` (no commitear)

---

## 2. Construir la imagen

Desde `colombia-degradation/`:
```bash
docker build -t degradacion-r-steps docker/grass-r 2>&1 | tee docker/build.log
```
El primer build tarda varios minutos (GRASS + Google Cloud SDK + Python earthengine-api + R).
Las siguientes veces usa caché y es rápido.

---

## 3. 🖥️ Workflow completo desde RStudio (sin terminal, recomendado)

**¿No querés lidiar con `docker run`, PowerShell, ni `$(pwd)` vs `${PWD}`?**
Los cuatro scripts `.R` (03A, 03B, 04A, 04B) se pueden correr enteros desde
una interfaz gráfica en el navegador, sin escribir un solo comando Docker
más después de este paso. Recomendado si el problema es justo la terminal
(errores de carpeta, `invalid reference format`, CLI de `gcloud` sin
instalar, etc.) — RStudio evita todo eso de una. Quien prefiera la terminal
puede saltar directo a la sección 4.

### 3.1 Levantar RStudio

Copiar el comando tal cual, sin cambiar nada (`mb-degradacion` ya es la
contraseña, no hace falta editarla). Este comando además abre el navegador
solo, apenas el servidor está listo:

🍎🐧 Mac / Linux / WSL2:
```bash
(sleep 3 && (open http://localhost:8787 || xdg-open http://localhost:8787)) &
docker run --rm --name rstudio_colombia -p 8787:8787 -e PASSWORD=mb-degradacion \
  -v "$(pwd)":/home/rstudio/work \
  --entrypoint /init \
  degradacion-r-steps
```
🪟 Windows (PowerShell):
```powershell
Start-Job { Start-Sleep -Seconds 3; Start-Process http://localhost:8787 } | Out-Null
docker run --rm --name rstudio_colombia -p 8787:8787 -e PASSWORD=mb-degradacion -v "${PWD}:/home/rstudio/work" --entrypoint /init degradacion-r-steps
```

Si el navegador no abre solo (o da error de conexión por abrir demasiado
rápido), esperar unos segundos más y entrar manualmente a
`http://localhost:8787`. Iniciar sesión con:
- **Usuario:** `rstudio`
- **Contraseña:** `mb-degradacion`

**Para cerrar RStudio**: cerrar esta ventana de terminal, o volver a ella y
apretar `Ctrl+C`. Cerrar solo la pestaña del navegador **no** lo apaga — el
navegador es apenas una ventana hacia el contenedor, que sigue corriendo
hasta que se cierra la terminal.

La sesión de R arranca directo en `~/work` (vía `Rprofile.site` en la
imagen); si algún script no encuentra `./tif/...` o `key.json`, correr
`setwd("~/work")` una vez en la consola (pasa solo si la imagen se
construyó con una versión anterior del Dockerfile — reconstruir con
`docker build` lo arregla de forma permanente).

El panel **Files** muestra `work/` — es todo `colombia-degradation/` montado
en vivo: lo que se edite ahí se guarda directo en disco, sin reconstruir la
imagen.

### 3.2 Correr cada script (editar → Source)

En RStudio no hay argumentos de línea de comandos — cada script cae en su
`years_list` / `region_id_default` por defecto. El flujo para cada uno es:
abrir el archivo en el editor → editar esas variables al inicio del script →
clic en **Source** (arriba a la derecha del panel del editor) o seleccionar
todo y **Run**.

**03A** (`03A_fragmentation_id_size.R`) — editar `years_list` (descomentar
los años a procesar) → Source. Salidas en `results/03A/`.

**03B** (`03B_uploadToGEE.R`) — correr después de 03A. Editar `years_list` y
`upload_outputs` → Source. Sube a GCS e ingesta en GEE (`03_patch-id/`,
`03_patch-size-all/`).

**04A** (`04A_fragmentation_morphology.R`) — editar `region_id_default` y
`years_list` → Source. Salidas en `results/04A/`.

**04B** (`04B_morphology_uploadToGEE.R`) — correr después de 04A, con el
mismo `region_id_default` que se usó ahí. Editar `region_id_default` y
`years_list` → Source. Ingesta en GEE (`04_morphology/`).

**Varios años de una sola vez**: a diferencia de `run_03A.sh` (pool
paralelo) o `run_morph.sh` (watchdog de disco), Source corre todo
secuencialmente en un solo proceso R. Para una tanda grande (p.ej. los 40
años completos), simplemente dejar todos los años activos en `years_list`
antes de darle Source — más lento que el pool paralelo, pero funciona igual.

⚠️ Este modo es cómodo para pruebas puntuales o corridas de pocos años. Para
lotes grandes en paralelo (03A) o con watchdog de disco (04A), usar los
wrappers `run_03A.sh` / `run_morph.sh` de las secciones 4 y 6 en su lugar.

---

## 4. Correr 03A — Patch ID & Size (GRASS) — por terminal

Un año suelto:
```bash
docker run --rm -v "$(pwd)":/work degradacion-r-steps 03A_fragmentation_id_size.R 1985
```
PowerShell:
```powershell
docker run --rm -v "${PWD}:/work" degradacion-r-steps 03A_fragmentation_id_size.R 1985
```

Varios años en paralelo con `run_03A.sh` (recomendado, requiere WSL2/Git Bash):
```bash
./scripts/run_03A.sh 1985 1986 1987 1988
./scripts/run_03A.sh $(seq 1985 2024)
```
El script mantiene un pool de hasta `MAX_JOBS` contenedores simultáneos — cuando uno
termina, arranca automáticamente el siguiente año de la cola. Ajustar `MAX_JOBS` al
inicio de `run_03A.sh` según RAM disponible (~500 MB por contenedor, default: 4).

**Salidas:**
```
results/03A/fragment_id_YYYY.tif
results/03A/fragment_area_YYYY.tif
gs://mbcolombia-degradacion/AUXILIARES/DEGRADACION/COL_3/results_03A/fragment_id_YYYY.tif
gs://mbcolombia-degradacion/AUXILIARES/DEGRADACION/COL_3/results_03A/fragment_area_YYYY.tif
```

---

## 5. Correr 03B — Patch ID & Size (subir a GEE) — por terminal

Editar `years_list` y `upload_outputs` en `03B_uploadToGEE.R`, luego:
```bash
docker run --rm -v "$(pwd)":/work degradacion-r-steps 03B_uploadToGEE.R
```
PowerShell:
```powershell
docker run --rm -v "${PWD}:/work" degradacion-r-steps 03B_uploadToGEE.R
```

Lee los TIFs desde GCS (`results_03A/`) y los ingesta en GEE como ImageCollections:
```
projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/03_patch-id/
projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/03_patch-size-all/
```

Requiere `roles/earthengine.writer` en el proyecto `mapbiomas-colombia`.

---

## 6. Correr 04A — Morphology (GRASS, por región) — por terminal

04A procesa por región para controlar el uso de disco. El script clipa el raster
al bbox de la región antes de importar en GRASS, evitando el spike de ~3.6 GB del
raster nacional completo.

**Parámetros a editar en el script o en `run_morph.sh`:**
- `region_id_default` en `04A_fragmentation_morphology.R` — región a procesar
- `REGION=` en `run_morph.sh` — mismo efecto desde el wrapper
- `years_list` en `04A_fragmentation_morphology.R`

Usar el wrapper `run_morph.sh` (incluye watchdog de disco — mata el contenedor
si `./grassdata` supera 10 GB; requiere WSL2/Git Bash):
```bash
./scripts/run_morph.sh 1985
./scripts/run_morph.sh 1985 1986 1987
```

Los años dentro de un mismo `run_morph.sh` corren **secuencialmente** (un año a la vez)
para la región fijada en `REGION=`. Para procesar varias regiones en paralelo, abrir
una terminal por región, ajustar `REGION=` en el script y correr simultáneamente.

O directamente con Docker (sin watchdog):
```bash
docker run --rm -v "$(pwd)":/work degradacion-r-steps 04A_fragmentation_morphology.R 30471 1985
```
PowerShell (sin watchdog de disco — vigilar `grassdata/` manualmente):
```powershell
docker run --rm -v "${PWD}:/work" degradacion-r-steps 04A_fragmentation_morphology.R 30471 1985
```

**Salidas:**
```
results/04A/morphology_YYYY_RRRR.tif
gs://mbcolombia-degradacion/AUXILIARES/DEGRADACION/COL_3/results_04A/RRRR/morphology_YYYY_RRRR.tif
```

---

## 7. Correr 04B — Morphology (subir a GEE) — por terminal

Los TIFs ya están en GCS (04A los sube). 04B genera los manifests y lanza la ingesta.

```bash
docker run --rm -v "$(pwd)":/work degradacion-r-steps 04B_morphology_uploadToGEE.R
docker run --rm -v "$(pwd)":/work degradacion-r-steps 04B_morphology_uploadToGEE.R 30471 1985 1986
```
PowerShell:
```powershell
docker run --rm -v "${PWD}:/work" degradacion-r-steps 04B_morphology_uploadToGEE.R
docker run --rm -v "${PWD}:/work" degradacion-r-steps 04B_morphology_uploadToGEE.R 30471 1985 1986
```

Editar `region_id_default` y `years_list` al inicio del script, o pasar como argumentos:
`region_id` primero, luego los años.

**Salida (GEE):**
```
projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/04_morphology/morphology_YYYY_RRRR
```
Cada asset lleva las propiedades `year` y `region_id` para que `04C` pueda filtrar.

---

## Utilidades

**Eliminar archivos en GCS:**
```bash
./scripts/gcs_delete.sh gs://mbcolombia-degradacion/AUXILIARES/DEGRADACION/COL_3/results_04A/30471/
```
Editar `GCS_PATH=` al inicio del script para fijar la ruta por defecto.

---

## Estructura de archivos

```
colombia-degradation/
  key.json                          ← service account (no commitear)
  gis/
    region_vector_buffer.geojson    ← 155 regiones (id_regionC)
  tif/
    nativeMask-classification_YYYY.tif   ← descargado de GCS por 03A/04A
  results/
    03A/   fragment_id_YYYY.tif · fragment_area_YYYY.tif
    04A/   morphology_YYYY_RRRR.tif
  logs/
    YYYY.log                        ← 03A (un archivo por año)
    RRRR_YYYY_morphology.log        ← 04A (región + año)
  manifests/                        ← JSONs de ingesta GEE (03B / 04B)
  grassdata/                        ← scratch de GRASS (se borra automáticamente)
  scripts/
    run_03A.sh                      ← pool paralelo para 03A (N años a la vez)
    run_morph.sh                    ← wrapper Docker + watchdog para 04A
    gcs_delete.sh                   ← utilidad para borrar archivos en GCS
```
