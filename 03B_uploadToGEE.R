# =============================================================
# Nombre: 03B_uploadToGEE.R
# Descripción: Sube los GeoTIFFs de ID y área de parches generados en 03A
#              a Google Cloud Storage y los ingesta en GEE como dos
#              ImageCollections separadas. Omite archivos ya existentes en
#              GCS o en GEE (idempotente).
#
#              Fusiona 03B_patchID_uploadToGEE.R + 03B_patchSize_uploadToGEE.R
#              en un solo script — misma lógica exacta para cada dataset,
#              sólo cambia el patrón de archivo / ruta GCS / colección GEE.
#
# Entradas:
#   ./results/fragment_id_YYYY.tif    (de 03A)
#   ./results/fragment_area_YYYY.tif  (de 03A)
# Salidas (GEE):
#   projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/
#     BETA/PROCESS/03_patch-id/fragment_id_YYYY
#   projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/
#     BETA/PROCESS/03_patch-size-all/fragment_area_YYYY
#
# Requisitos:
#   - R packages: rgee, jsonlite, googleCloudStorageR
#   - key.json (service account) en el directorio de trabajo, o sesión
#     interactiva de rgee/gargle ya autenticada
#   - earthengine CLI instalado y en PATH (pip install earthengine-api)
#
# Autor original: dhemerson.costa@ipam.org.br
# Adaptación Colombia: mapbiomas-colombia
# Fecha: 2026-06
# =============================================================

reticulate::py_require("earthengine-api")
library(rgee)
library(jsonlite)
library(googleCloudStorageR)

# -------------------------------------------------------------
# INICIALIZAR GEE + GCS
# -------------------------------------------------------------
# Si hay service account key (Docker / no interactivo), se registra como
# usuario rgee vía ee_utils_sak_copy() para evitar el flujo OAuth de
# navegador, que en un contenedor no tiene cómo completarse. Sin key.json
# (uso local normal) se mantiene el flujo interactivo de siempre.

gcs_key_file <- "key.json"

if (file.exists(gcs_key_file)) {
  # En Docker no hay flujo OAuth interactivo. Se inicializa EE directamente vía
  # el API Python (ee ya está importado por library(rgee)) con ServiceAccount.
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
# CONFIGURACIÓN — un elemento de datasets por colección a subir
# -------------------------------------------------------------

tif_dir      <- "./results/03A"
bucket_name  <- "mbcolombia-degradacion"       # bucket GCS proyecto cloud-ee-lmedinaj
manifest_dir <- "./manifests"
dir.create(manifest_dir, showWarnings = FALSE)

pyr_policy   <- "MODE"
nodata_value <- 0
overwrite    <- FALSE
batch_size   <- 50

# ---- Qué subir ----
# c("id", "area") = ambas colecciones (default). c("id") o c("area") = sólo una.
upload_outputs <- c("id", "area")

if (length(upload_outputs) == 0 || !all(upload_outputs %in% c("id", "area"))) {
  stop("upload_outputs debe ser c('id'), c('area') o c('id', 'area')")
}

# ---- Años a subir ----
# Sólo se suben los años de esta lista — comenta/descomenta los que quieras.
# Si un archivo esperado no existe en ./results/, se omite con un aviso.
years_list <- c(
  # 1985,
  # 1986,1987,1988,1989,1990,1991,1992,1993,1994,1995,
  # 1996,1997,1998,1999,
  # 2000
  2001,2002,2003,2004,2005,2006,
  2007,2008,2009,2010,2011,2012,2013,
  2014,2015,2016,2017,2018,2019,2020,
  2021,2022,2023
  # ,2024
)

# Prefijo GCS combinado (fragment_id y fragment_area juntos), igual a como
# 03A_fragmentation_id_size.R sube y como 03B_uploadToGEE_grasspython.ipynb
# (versión Python) ya lee desde .../COL_3/results — se usa results_03A para
# no mezclar con esos outputs.
gcs_prefix <- "AUXILIARES/DEGRADACION/COL_3/results_03A"

datasets <- list(
  list(
    key           = "id",
    pattern_name  = "fragment_id",
    prefix        = gcs_prefix,
    collection_id = paste0(
      "projects/mapbiomas-colombia/assets/DEGRADACION/",
      "COLECCION1/BETA/PROCESS/03_patch-id"
    )
  ),
  list(
    key           = "area",
    pattern_name  = "fragment_area",
    prefix        = gcs_prefix,
    collection_id = paste0(
      "projects/mapbiomas-colombia/assets/DEGRADACION/",
      "COLECCION1/BETA/PROCESS/03_patch-size-all"
    )
  )
)

# -------------------------------------------------------------
# FUNCIONES AUXILIARES (idénticas a las de los scripts originales)
# -------------------------------------------------------------

asset_from_path <- function(ic_id, tif) {
  nm <- tools::file_path_sans_ext(basename(tif))
  nm <- gsub("[^A-Za-z0-9_\\-]", "_", nm)
  paste0(ic_id, "/", nm)
}

asset_exists <- function(asset_id) {
  tryCatch({
    ee$data$getAsset(asset_id)
    TRUE
  }, error = function(e) FALSE)
}

gcs_uri_from_tif <- function(tif, prefix) {
  paste0("gs://", bucket_name, "/", prefix, "/", basename(tif))
}

# Reemplaza al CLI de gcloud por llamadas nativas de googleCloudStorageR —
# evita depender de que `gcloud` esté instalado y en PATH (bloqueante para
# quienes corren el script fuera de Docker sin el SDK instalado).
gcs_bucket_and_object <- function(gcs_uri) {
  parts <- sub("^gs://", "", gcs_uri)
  list(bucket = sub("/.*", "", parts), object = sub("^[^/]+/", "", parts))
}

gcs_exists <- function(gcs_uri) {
  p <- gcs_bucket_and_object(gcs_uri)
  tryCatch({
    gcs_get_object(p$object, bucket = p$bucket, meta = TRUE)
    TRUE
  }, error = function(e) FALSE)
}

upload_if_needed <- function(tif, gcs_uri) {
  if (gcs_exists(gcs_uri)) {
    cat("✓ Ya existe en GCS, omitiendo:", gcs_uri, "\n")
    return("skip_gcs")
  }
  cat("↑ Subiendo:", gcs_uri, "\n")
  p <- gcs_bucket_and_object(gcs_uri)
  gcs_upload(tif, bucket = p$bucket, name = p$object,
             type = "image/tiff", predefinedAcl = "bucketLevel")
  return("uploaded")
}

build_manifest <- function(asset_id, gcs_uri) {
  list(
    name     = asset_id,
    tilesets = list(
      list(sources = list(list(uris = list(gcs_uri))))
    ),
    pyramidingPolicy = pyr_policy,
    missingData      = list(values = list(nodata_value))
  )
}

# -------------------------------------------------------------
# SUBIR + INGESTAR UN DATASET (fragment_id o fragment_area)
# -------------------------------------------------------------

upload_dataset <- function(pattern_name, prefix, collection_id, years) {

  cat("\n=============================================\n")
  cat("Dataset:", pattern_name, "\n")
  cat("=============================================\n")

  expected   <- file.path(tif_dir, paste0(pattern_name, "_", years, ".tif"))
  tifs       <- expected[file.exists(expected)]
  faltantes  <- expected[!file.exists(expected)]

  if (length(faltantes) > 0) {
    cat("⚠️  No encontrados en", tif_dir, "(omitidos):",
        paste(basename(faltantes), collapse = ", "), "\n")
  }
  if (length(tifs) == 0) {
    cat("Nada para subir de", pattern_name, "— omitiendo.\n")
    return(invisible(NULL))
  }
  cat("Archivos encontrados:", length(tifs), "\n")

  # ---- Subir a GCS y generar manifests ----
  manifest_paths <- c()

  for (tif in tifs) {

    cat("\n-----------------------------\n")
    cat("Procesando:", tif, "\n")

    asset_id <- asset_from_path(collection_id, tif)

    if (asset_exists(asset_id) && !overwrite) {
      cat("✓ Asset GEE ya existe, omitiendo:", asset_id, "\n")
      next
    }

    gcs_uri <- gcs_uri_from_tif(tif, prefix)
    upload_if_needed(tif, gcs_uri)

    manifest      <- build_manifest(asset_id, gcs_uri)
    manifest_file <- file.path(manifest_dir, paste0(basename(tif), ".json"))

    write_json(manifest, manifest_file, auto_unbox = TRUE, pretty = TRUE)
    manifest_paths <- c(manifest_paths, manifest_file)
  }

  cat("\nManifests listos:", length(manifest_paths), "\n")

  if (length(manifest_paths) == 0) {
    cat("Nada que ingestar para", pattern_name, ".\n")
    return(invisible(NULL))
  }

  # ---- Ingesta en GEE (en lotes) ----
  cat("\n== INICIANDO INGESTA:", pattern_name, "==\n")

  chunks <- split(manifest_paths, ceiling(seq_along(manifest_paths) / batch_size))

  for (i in seq_along(chunks)) {
    cat("\nLote", i, "de", length(chunks), "\n")
    for (manifest in chunks[[i]]) {
      ee_sa_flag <- if (file.exists(gcs_key_file)) paste0("--service_account_file=", normalizePath(gcs_key_file)) else ""
      cmd <- paste("earthengine", ee_sa_flag, "upload image --manifest", shQuote(manifest))
      system(paste(cmd, "&"))
    }
    Sys.sleep(10)  # Pausa para evitar throttling de la API de GEE
  }

  cat("\nTodas las tareas de", pattern_name, "enviadas.\n")

  # ---- Verificar colección ----
  ic <- ee$ImageCollection(collection_id)
  cat("\nTamaño de la colección", collection_id, ":\n")
  print(ic$size()$getInfo())
}

# -------------------------------------------------------------
# CORRER PARA CADA DATASET PEDIDO EN upload_outputs
# -------------------------------------------------------------

datasets <- Filter(function(ds) ds$key %in% upload_outputs, datasets)

for (ds in datasets) {
  upload_dataset(ds$pattern_name, ds$prefix, ds$collection_id, years_list)
}
