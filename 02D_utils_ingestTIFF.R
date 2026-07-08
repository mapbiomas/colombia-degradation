# =============================================================
# Nombre: 02D_utils_ingestTIFF.R
# Descripción: Descarga los mosaicos GeoTIFF generados en 02C
#              a la carpeta local ./tif/, que es el directorio
#              de entrada requerido por 03A (GRASS GIS).
#
#              Soporta dos fuentes según lo configurado en 02B/02C:
#                'drive' → descarga desde Google Drive
#                'gcs'   → descarga desde Google Cloud Storage
#
# Salida:
#   ./tif/nativeMask-classification_YYYY.tif  (un archivo por año)
#
# Requisitos:
#   drive: install.packages(c("googledrive", "parallel"))
#   gcs:   install.packages(c("googleCloudStorageR", "parallel"))
#
# Autor original: dhemerson.costa@ipam.org.br
# Adaptación Colombia: mapbiomas-colombia
# Fecha: 2026-05
# =============================================================

library(parallel)

# -------------------------------------------------------------
# CONFIGURACIÓN
# -------------------------------------------------------------

# Cambiar para que coincida con exportTarget de 02B y source_target de 02C
# 'drive' → Google Drive
# 'gcs'   → Google Cloud Storage
source_target <- 'drive'

# Carpeta de destino local (entrada para 03A)
output_dir <- './tif'
dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

# Número de núcleos para descarga en paralelo
n_cores <- max(1, detectCores() - 1)

# --- Google Drive ---
drive_folder_name <- 'mapbiomas-colombia-degradacion'  # carpeta raíz en Drive
drive_subfolder   <- 'mosaicos/nativeMask'             # subcarpeta con los mosaicos (de 02C)

# --- Google Cloud Storage ---
bucket_name  <- 'mbcolombia-degradacion'               # bucket GCS proyecto cloud-ee-lmedinaj
gcs_prefix   <- 'AUXILIARES/DEGRADACION/COL_3/temp'
gcs_key_file <- 'key.json'                             # archivo de credenciales GCS

# =============================================================
# MODO DRIVE
# =============================================================

if (source_target == 'drive') {

  library(googledrive)

  # Autenticar con Google Drive
  # En entorno interactivo: abre el navegador para autorización
  # En servidor/no interactivo: configurar con drive_auth(path = 'token.rds')
  drive_auth()

  # Ruta completa de la carpeta en Drive
  drive_path <- file.path(drive_folder_name, drive_subfolder)

  cat('Listando archivos en Drive:', drive_path, '\n')

  # Listar archivos .tif en la carpeta
  drive_files <- tryCatch(
    drive_ls(path = drive_path, pattern = '\\.tif$'),
    error = function(e) {
      stop(paste('No se pudo acceder a la carpeta Drive:', drive_path,
                 '\nVerificar que existe y que tienes acceso.\nError:', e$message))
    }
  )

  if (nrow(drive_files) == 0) {
    stop(paste('No se encontraron archivos .tif en:', drive_path))
  }

  cat('Archivos encontrados en Drive:', nrow(drive_files), '\n')

  # Descargar en paralelo
  mclapply(
    seq_len(nrow(drive_files)),
    function(i) {

      # Re-autenticar dentro del worker (buena práctica para mclapply)
      drive_auth()

      file_row  <- drive_files[i, ]
      file_name <- file_row$name
      dest_path <- file.path(output_dir, file_name)

      # Saltar si ya existe localmente
      if (file.exists(dest_path)) {
        cat('✓ Ya existe, omitiendo:', file_name, '\n')
        return(file_name)
      }

      tryCatch({
        drive_download(
          file      = as_id(file_row$id),
          path      = dest_path,
          overwrite = TRUE
        )
        cat('✅ Descargado:', file_name, '\n')
      }, error = function(e) {
        cat('❌ Error descargando', file_name, ':', e$message, '\n')
      })

      return(file_name)
    },
    mc.cores = n_cores
  )

# =============================================================
# MODO GCS
# =============================================================

} else if (source_target == 'gcs') {

  library(googleCloudStorageR)

  # Autenticar con GCS usando archivo de credenciales JSON
  gcs_auth(gcs_key_file)

  cat('Listando archivos en GCS:', bucket_name, '/', gcs_prefix, '\n')

  # Listar archivos .tif en el bucket
  files_df <- gcs_list_objects(
    bucket = bucket_name,
    prefix = gcs_prefix
  )

  tif_files <- files_df$name[grepl('\\.tif$', files_df$name)]

  if (length(tif_files) == 0) {
    stop(paste('No se encontraron archivos .tif en el bucket con prefijo:', gcs_prefix))
  }

  cat('Archivos encontrados en GCS:', length(tif_files), '\n')

  # Descargar en paralelo
  mclapply(
    tif_files,
    function(f) {

      # Re-autenticar dentro del worker
      gcs_auth(gcs_key_file)

      local_name <- basename(f)
      dest_path  <- file.path(output_dir, local_name)

      # Saltar si ya existe localmente
      if (file.exists(dest_path)) {
        cat('✓ Ya existe, omitiendo:', local_name, '\n')
        return(local_name)
      }

      tryCatch({
        gcs_get_object(
          object_name = f,
          bucket      = bucket_name,
          saveToDisk  = dest_path,
          overwrite   = TRUE
        )
        cat('✅ Descargado:', local_name, '\n')
      }, error = function(e) {
        cat('❌ Error descargando', local_name, ':', e$message, '\n')
      })

      return(local_name)
    },
    mc.cores = n_cores
  )

} else {
  stop(paste('source_target inválido:', source_target, '— debe ser "drive" o "gcs"'))
}

# -------------------------------------------------------------
# VERIFICACIÓN FINAL
# -------------------------------------------------------------

downloaded <- list.files(output_dir, pattern = '\\.tif$')
cat('\n============================================================\n')
cat('Archivos en ./tif/ listos para 03A:', length(downloaded), '\n')
cat(paste(' -', downloaded, collapse = '\n'), '\n')
cat('============================================================\n')
