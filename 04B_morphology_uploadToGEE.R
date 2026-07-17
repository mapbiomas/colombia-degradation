# =============================================================
# Nombre: 04B_morphology_uploadToGEE.R
# Descripción: Ingesta los rasters de morfología (MSPA) generados en 04A
#              hacia GEE como ImageCollection. Los TIFs ya están en GCS
#              (04A los sube). Este script verifica, genera los manifests
#              y lanza la ingesta. Idempotente — omite assets ya existentes.
#
# Uso:
#   docker run --rm -v "$(pwd)":/work degradacion-r-steps 04B_morphology_uploadToGEE.R
#   docker run --rm -v "$(pwd)":/work degradacion-r-steps 04B_morphology_uploadToGEE.R 30471 1985 1986
#
# Entradas (GCS, subidas por 04A):
#   gs://mbcolombia-degradacion/AUXILIARES/DEGRADACION/COL_3/results_04A/RRRR/morphology_YYYY_RRRR.tif
# Salidas (GEE):
#   projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/04_morphology/morphology_YYYY_RRRR
#   (con propiedad year=YYYY para que 04C pueda filtrar con ee.Filter.eq('year', year_i))
#
# Autor: mapbiomas-colombia
# Fecha: 2026-07
# =============================================================

region_id_default <- 30210

years_list <- c(
  1985
  # ,1986,1987,1988,1989,1990,1991,1992,1993,1994,1995,
  # 1996,1997,1998,1999,
  # 2000,2001,2002,2003,2004,2005,2006,
  # 2007,2008,2009,2010,2011,2012,2013,
  # 2014,2015,2016,2017,2018,2019,2020,
  # 2021,2022,2023,2024
)

args      <- commandArgs(trailingOnly = TRUE)
region_id <- if (length(args) > 0) args[1] else as.character(region_id_default)
years     <- if (length(args) > 1) as.integer(args[-1]) else as.integer(years_list)

reticulate::py_require("earthengine-api")
library(rgee)
library(jsonlite)
library(googleCloudStorageR)

# -------------------------------------------------------------
# INICIALIZAR GEE + GCS
# -------------------------------------------------------------

gcs_key_file <- "key.json"

if (file.exists(gcs_key_file)) {
  key_info    <- jsonlite::fromJSON(gcs_key_file)
  credentials <- ee$ServiceAccountCredentials(
    email    = key_info$client_email,
    key_file = normalizePath(gcs_key_file)
  )
  ee$Initialize(credentials = credentials, project = "mapbiomas-colombia")
  
  # Autentica GCS con la misma service account. En Docker esto lo cubría
  # `gcloud auth activate-service-account` en entrypoint.sh — fuera de
  # Docker no hay ese paso previo, así que se hace aquí directamente.
  gcs_auth(json_file = gcs_key_file)
} else {
  ee_Initialize(project = "mapbiomas-colombia")
}

# -------------------------------------------------------------
# CONFIGURACIÓN
# -------------------------------------------------------------

tif_dir      <- "./results/04A"
bucket_name  <- "mbcolombia-degradacion"
gcs_prefix   <- paste0("AUXILIARES/DEGRADACION/COL_3/results_04A/", region_id)
collection_id <- paste0(
  "projects/mapbiomas-colombia/assets/DEGRADACION/",
  "COLECCION1/BETA/PROCESS/04_morphology"
)
manifest_dir <- "./manifests"
dir.create(manifest_dir, showWarnings = FALSE)

pyr_policy   <- "MODE"
# 255 = el NoData real que graba r.out.gdal para los pixeles fuera del
# poligono de la region (ver r.mask, Paso 5). NO usar 0 — 0 es una clase
# valida de la clasificacion ("Sin vegetacion nativa"), no dato faltante;
# declarar 0 como nodata hace que GEE oculte ~1/3 del raster.
nodata_value <- 255
overwrite    <- TRUE
batch_size   <- 50

cat("Región:", region_id, "| Años:", paste(years, collapse = " "), "\n")
cat("Colección GEE:", collection_id, "\n\n")

# -------------------------------------------------------------
# FUNCIONES AUXILIARES
# -------------------------------------------------------------

asset_exists <- function(asset_id) {
  tryCatch({ ee$data$getAsset(asset_id); TRUE }, error = function(e) FALSE)
}

# Reemplaza al CLI de gcloud por llamadas nativas de googleCloudStorageR —
# evita depender de que `gcloud` esté instalado y en PATH (bloqueante para
# quienes corren el script fuera de Docker sin el SDK instalado).
gcs_bucket_and_object <- function(gcs_uri) {
  parts <- sub("^gs://", "", gcs_uri)
  list(bucket = sub("/.*", "", parts), object = sub("^[^/]+/", "", parts))
}

gcs_exists <- function(uri) {
  p <- gcs_bucket_and_object(uri)
  tryCatch({
    gcs_get_object(p$object, bucket = p$bucket, meta = TRUE)
    TRUE
  }, error = function(e) FALSE)
}

upload_if_needed <- function(local_path, uri, force = FALSE) {
  if (!force && gcs_exists(uri)) {
    cat("✓ Ya en GCS:", uri, "\n")
    return(invisible(NULL))
  }
  if (force && gcs_exists(uri)) {
    p <- gcs_bucket_and_object(uri)
    gcs_delete_object(p$object, bucket = p$bucket)
    cat("✗ Borrado objeto GCS existente:", uri, "\n")
  }
  cat("↑ Subiendo a GCS:", uri, "\n")
  p <- gcs_bucket_and_object(uri)
  gcs_upload(local_path, bucket = p$bucket, name = p$object,
             type = "image/tiff", predefinedAcl = "bucketLevel")
}

build_manifest <- function(asset_id, uri, year) {
  list(
    name             = asset_id,
    tilesets         = list(list(sources = list(list(uris = list(uri))))),
    pyramidingPolicy = pyr_policy,
    missingData      = list(values = list(nodata_value)),
    properties       = list(year = as.integer(year), region_id = as.integer(region_id))
  )
}

# -------------------------------------------------------------
# PROCESAR CADA AÑO
# -------------------------------------------------------------

manifest_paths <- c()

for (year in years) {
  
  tif_name  <- paste0("morphology_", year, "_", region_id, ".tif")
  tif_path  <- file.path(tif_dir, tif_name)
  asset_nm  <- tools::file_path_sans_ext(tif_name)
  asset_id  <- paste0(collection_id, "/", asset_nm)
  gcs_uri   <- paste0("gs://", bucket_name, "/", gcs_prefix, "/", tif_name)
  
  cat("-----------------------------\n")
  cat("Año:", year, "| TIF:", tif_name, "\n")
  
  if (asset_exists(asset_id)) {
    if (!overwrite) {
      cat("✓ Asset GEE ya existe, omitiendo:", asset_id, "\n")
      next
    }
    cat("✗ Asset GEE ya existe, borrando para reemplazar:", asset_id, "\n")
    ee$data$deleteAsset(asset_id)
  }

  # El TIF debe estar en GCS (04A lo sube). Si también existe localmente,
  # lo sube como respaldo por si 04A no completó la subida. Con
  # overwrite=TRUE se fuerza a resubir la version local (por si 04A generó
  # una corrida nueva y GCS todavia tiene la version vieja).
  if (overwrite && file.exists(tif_path)) {
    upload_if_needed(tif_path, gcs_uri, force = TRUE)
  } else if (!gcs_exists(gcs_uri)) {
    if (file.exists(tif_path)) {
      upload_if_needed(tif_path, gcs_uri)
    } else {
      cat("⚠️  No encontrado en GCS ni localmente — omitiendo:", tif_name, "\n")
      next
    }
  } else {
    cat("✓ Ya en GCS:", gcs_uri, "\n")
  }
  
  manifest      <- build_manifest(asset_id, gcs_uri, year)
  manifest_file <- file.path(manifest_dir, paste0(tif_name, ".json"))
  write_json(manifest, manifest_file, auto_unbox = TRUE, pretty = TRUE)
  manifest_paths <- c(manifest_paths, manifest_file)
}

cat("\nManifests listos:", length(manifest_paths), "\n")

if (length(manifest_paths) == 0) {
  cat("Nada que ingestar.\n")
  quit(save = "no", status = 0)
}

# -------------------------------------------------------------
# INGESTA EN GEE (en lotes)
# -------------------------------------------------------------

cat("\n== INICIANDO INGESTA ==\n")

ee_sa_flag <- if (file.exists(gcs_key_file)) {
  paste0("--service_account_file=", normalizePath(gcs_key_file))
} else ""

chunks <- split(manifest_paths, ceiling(seq_along(manifest_paths) / batch_size))

for (i in seq_along(chunks)) {
  cat("\nLote", i, "de", length(chunks), "\n")
  for (manifest in chunks[[i]]) {
    cmd <- paste("earthengine", ee_sa_flag,
                 "upload image --manifest", shQuote(manifest))
    system(paste(cmd, "&"))
  }
  Sys.sleep(10)
}

cat("\nTodas las tareas enviadas.\n")

# -------------------------------------------------------------
# VERIFICAR COLECCIÓN
# -------------------------------------------------------------

ic <- ee$ImageCollection(collection_id)
cat("\nTamaño de la colección", collection_id, ":\n")
print(ic$size()$getInfo())