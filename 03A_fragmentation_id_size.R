#!/usr/bin/env Rscript
# =============================================================
# Nombre: 03A_fragmentation_id_size.R
# Descripción: Calcula el ID único de cada parche de vegetación
#              nativa (r.clump) y su área total en hectáreas
#              (r.stats.zonal) usando GRASS GIS. Se ejecuta un
#              proceso por año, paralelizable con GNU parallel:
#
#   parallel -j 12 Rscript 03A_fragmentation_id_size.R ::: $(seq 2000 2024)
#
# También acepta varios años en una sola invocación:
#
#   Rscript 03A_fragmentation_id_size.R 1985 1986 1987
#
# Si se invoca sin argumentos, usa years_list (más abajo) en su lugar — útil
# para correrlo directo (Docker, RStudio) sin pasar años por línea de comandos.
#
# Entradas:
#   ./tif/nativeMask-classification_YYYY.tif
#   Si el archivo no existe localmente, se descarga de GCS (antes lo
#   pre-descargaba 02D para todos los años; ahora 03A descarga sólo los
#   años pedidos, vía service account key ./key.json).
# Salidas:
#   ./results/fragment_id_YYYY.tif
#   ./results/fragment_area_YYYY.tif
#
# Autor original: dhemerson.costa@ipam.org.br
# Adaptación Colombia: mapbiomas-colombia
# Fecha: 2026-05
# =============================================================

# ---- Años a procesar ----
# Sólo se usa si el script se invoca SIN argumentos (ver años por línea de
# comandos / GNU parallel arriba, que tienen prioridad). Comenta/descomenta
# los años o rangos que quieras incluir.
years_list <- c(
  1985
  # ,1986,1987,1988,1989,1990,1991,1992,1993,1994,1995,
  # 1996,1997,1998,1999,
  # 2000,2001,2002,2003,2004,2005,2006,
  # 2007,2008,2009,2010,2011,2012,2013,
  # 2014,2015,2016,2017,2018,2019,2020,
  # 2021,2022,2023,2024
)

args  <- commandArgs(trailingOnly = TRUE)
years <- if (length(args) > 0) args else as.character(years_list)

# ---- Qué generar ----
# c("id", "area") = ambos (default). c("id") o c("area") = sólo uno.
# El ID de parche siempre se calcula internamente (SUMA_ZONAL lo necesita
# como base para agrupar el área por parche) — esto sólo controla qué se
# EXPORTA/sube, y si vale la pena correr los pasos exclusivos de área
# (MASCARA, AREA_CELDA, SUMA_ZONAL, REMOVER_MASCARA).
generate_outputs <- c("id", "area")

if (length(generate_outputs) == 0 || !all(generate_outputs %in% c("id", "area"))) {
  stop("generate_outputs debe ser c('id'), c('area') o c('id', 'area')")
}

suppressPackageStartupMessages(library(rgrass))

# -------------------------------------------------------------
# DESCARGA DE ENTRADA (GCS)
# -------------------------------------------------------------
# Antes 02D pre-descargaba TODOS los .tif del bucket sin filtrar por año.
# Ahora 03A descarga sólo el TIF del año que efectivamente se va a procesar,
# usando el mismo service account key que 02D usaba en modo 'gcs'.

bucket_name      <- "mbcolombia-degradacion"
gcs_input_prefix <- "AUXILIARES/DEGRADACION/COL_3/temp"
gcs_key_file     <- "key.json"

# Subida opcional de resultados a GCS — apagada por defecto. Mismo prefijo
# combinado (fragment_id y fragment_area juntos) que usa la versión Python
# en .../COL_3/results — pero en results_r para no mezclar con esos outputs.
upload_to_gcs     <- TRUE
gcs_output_prefix <- "AUXILIARES/DEGRADACION/COL_3/results_03A"

# Borra grassdata/COL3_<year> tras exportar (y subir, si aplica) — es sólo
# la base de datos interna de GRASS, no un resultado. FALSE para conservarla
# (p.ej. para inspeccionar capas intermedias mientras se depura un año).
cleanup_grassdata <- TRUE

dir.create("./tif", showWarnings = FALSE, recursive = TRUE)

if (file.exists(gcs_key_file)) {
  suppressPackageStartupMessages(library(googleCloudStorageR))
  googleCloudStorageR::gcs_auth(gcs_key_file)
}

download_input_if_missing <- function(year) {
  dest_path <- paste0("./tif/nativeMask-classification_", year, ".tif")
  if (file.exists(dest_path)) return(dest_path)

  if (!file.exists(gcs_key_file)) {
    stop(paste0("Archivo de entrada no encontrado: ", dest_path,
                "\nTampoco hay ", gcs_key_file, " en el directorio de trabajo para descargarlo de GCS."))
  }

  object_name <- paste0(gcs_input_prefix, "/nativeMask-classification_", year, ".tif")
  cat("Descargando", object_name, "...\n")
  googleCloudStorageR::gcs_get_object(object_name, bucket = bucket_name,
                                       saveToDisk = dest_path, overwrite = TRUE)
  if (!file.exists(dest_path)) stop(paste("No se pudo descargar:", object_name))
  dest_path
}

# -------------------------------------------------------------
# CONFIGURACIÓN COMÚN (no depende del año)
# -------------------------------------------------------------

grass_exec <- Sys.which("grass")
if (grass_exec == "") stop("No se encontró el ejecutable de GRASS GIS en el PATH")

grass_path <- system("grass --config path", intern = TRUE)

gisDbase <- "./grassdata"
dir.create(gisDbase, showWarnings = FALSE, recursive = TRUE)

results_dir <- "./results/03A"
dir.create(results_dir, showWarnings = FALSE, recursive = TRUE)

log_dir <- "logs"
dir.create(log_dir, recursive = TRUE, showWarnings = FALSE)

mapset_name <- "PERMANENT"

# -------------------------------------------------------------
# PROCESAMIENTO POR AÑO
# -------------------------------------------------------------

process_year <- function(year) {

  log_file <- file.path(log_dir, paste0(year, ".log"))

  log_message <- function(msg) {
    timestamp <- format(Sys.time(), "%Y-%m-%d %H:%M:%S", tz = "America/Bogota")
    line <- paste0("[", timestamp, "] ", msg, "\n")
    cat(line)
    cat(line, file = log_file, append = TRUE)
  }

  log_step <- function(step, expr) {
    log_message(paste("----", step, "START ----"))
    # R difiere los warnings y los imprime todos juntos al final del script,
    # fuera de cualquier log_message() — por eso no quedaban en el archivo
    # de log. withCallingHandlers() los intercepta en el momento en que
    # ocurren (sin abortar el step) para que sí queden escritos.
    result <- withCallingHandlers(
      tryCatch(
        expr,
        error = function(e) {
          log_message(paste("ERROR en", step, ":", e$message))
          stop(e)
        }
      ),
      warning = function(w) {
        log_message(paste("WARNING en", step, ":", conditionMessage(w)))
        invokeRestart("muffleWarning")
      }
    )
    log_message(paste("----", step, "END ----"))
    return(result)
  }

  log_message(paste("===== Procesando año", year, "====="))

  year_t0 <- Sys.time()
  on.exit({
    # Va en on.exit (no al final del cuerpo de la función) para que corra
    # SIEMPRE, incluso si algo más adelante falla (p.ej. la subida a GCS) —
    # si no, un error upstream se salta esta limpieza por completo.
    if (cleanup_grassdata && exists("location_path", inherits = FALSE) &&
        dir.exists(location_path)) {
      unlink(location_path, recursive = TRUE)
      log_message(paste0("Limpieza local: borrado ", location_path))
    }
    dt_sec <- round(as.numeric(difftime(Sys.time(), year_t0, units = "secs")), 1)
    log_message(paste0("===== Año ", year, " — duración total: ", dt_sec,
                        "s (", round(dt_sec / 60, 1), " min) ====="))
  })

  location_name <- paste0("COL3_", year)
  location_path <- file.path(gisDbase, location_name)

  input_raster <- download_input_if_missing(year)

  output_fragment_id   <- file.path(results_dir, paste0("fragment_id_",   year, ".tif"))
  output_fragment_area <- file.path(results_dir, paste0("fragment_area_", year, ".tif"))

  want_id   <- "id"   %in% generate_outputs
  want_area <- "area" %in% generate_outputs

  needed_outputs <- c(
    if (want_id)   output_fragment_id,
    if (want_area) output_fragment_area
  )

  # Sólo se salta el cómputo GRASS si ya existe localmente — la subida a GCS
  # (más abajo) corre independientemente, así ya esté recién calculado o
  # ya existiera de antes, para no quedar pendiente sólo por haber saltado
  # el cómputo.
  already_done <- all(file.exists(needed_outputs))

  if (already_done) {
    log_message("Outputs ya existen localmente. Saltando cómputo GRASS.")
  } else {

  # -------------------------------------------------------------
  # 01 CREAR LOCATION GRASS
  # -------------------------------------------------------------

  log_step("CREAR_LOCATION", {

    if (!dir.exists(location_path)) {

      cmd <- sprintf(
        "%s -c %s %s -e",
        shQuote(grass_exec),
        shQuote(input_raster),
        shQuote(location_path)
      )

      status <- system(cmd)
      if (status != 0) stop("Falló la creación de la GRASS location")
    }

  })

  # -------------------------------------------------------------
  # 02 INICIALIZAR GRASS
  # -------------------------------------------------------------

  log_step("INICIALIZAR_GRASS", {

    initGRASS(
      gisBase  = grass_path,
      home     = tempdir(),
      gisDbase = gisDbase,
      location = location_name,
      mapset   = mapset_name,
      override = TRUE
    )

  })

  # -------------------------------------------------------------
  # 03 IMPORTAR RASTER
  # -------------------------------------------------------------

  base_name   <- paste0("nativeMask_", year)
  fragment    <- paste0(base_name, "_fragment")
  fragment_id <- paste0(base_name, "_fragment_id")
  area_cell   <- paste0(fragment, "_area_cell")
  area_map    <- paste0(fragment, "_area")

  log_step("IMPORTAR_RASTER", {

    execGRASS(
      "r.in.gdal",
      flags = c("overwrite", "o"),
      parameters = list(
        input  = input_raster,
        output = base_name
      )
    )

    rlist <- execGRASS("g.list", parameters = list(type = "raster"), intern = TRUE)
    if (!(base_name %in% rlist)) stop("La importación del raster falló")

  })

  # -------------------------------------------------------------
  # 04 DEFINIR REGIÓN
  # -------------------------------------------------------------

  log_step("DEFINIR_REGION", {

    execGRASS(
      "g.region",
      parameters = list(raster = base_name, align = base_name)
    )

  })

  # -------------------------------------------------------------
  # 05 CREAR BINARIO (1 = nativo, null = no nativo)
  # -------------------------------------------------------------

  log_step("CREAR_BINARIO", {

    execGRASS(
      "r.mapcalc",
      flags = "overwrite",
      parameters = list(
        expression = sprintf("%s = if(%s == 1, 1, null())", fragment, base_name)
      )
    )

  })

  # -------------------------------------------------------------
  # 06 CLUMP — asignar ID único a cada parche conectado
  # -------------------------------------------------------------

  log_step("CLUMP", {

    execGRASS(
      "r.clump",
      flags = c("overwrite", "d"),   # -d incluye conectividad diagonal (8 vecinos)
      parameters = list(
        input  = fragment,
        output = fragment_id
      )
    )

  })

  # -------------------------------------------------------------
  # 07 MÁSCARA — restringir cálculos a píxeles nativos
  # (07-10 sólo corren si se pide "area" — el ID no los necesita)
  # -------------------------------------------------------------

  if (want_area) {
    log_step("MASCARA", {

      execGRASS(
        "r.mask",
        flags = "overwrite",
        parameters = list(raster = fragment)
      )

    })

    # -------------------------------------------------------------
    # 08 ÁREA POR CELDA (en hectáreas)
    # -------------------------------------------------------------

    log_step("AREA_CELDA", {

      execGRASS(
        "r.mapcalc",
        flags = "overwrite",
        parameters = list(
          expression = sprintf("%s = area()/10000.0", area_cell)
        )
      )

    })

    # -------------------------------------------------------------
    # 09 SUMA ZONAL — área total por parche
    # -------------------------------------------------------------

    log_step("SUMA_ZONAL", {

      execGRASS(
        "r.stats.zonal",
        flags = "overwrite",
        parameters = list(
          base   = fragment_id,
          cover  = area_cell,
          method = "sum",
          output = area_map
        )
      )

      # Convertir a entero
      execGRASS(
        "r.mapcalc",
        flags = "overwrite",
        parameters = list(
          expression = sprintf("%s = int(%s)", area_map, area_map)
        )
      )

    })

    # -------------------------------------------------------------
    # 10 REMOVER MÁSCARA
    # -------------------------------------------------------------

    log_step("REMOVER_MASCARA", {
      execGRASS("r.mask", flags = "r")
    })
  }

  # -------------------------------------------------------------
  # 11 EXPORTAR
  # -------------------------------------------------------------

  log_step("EXPORTAR", {

    if (want_id) {
      execGRASS(
        "r.out.gdal",
        flags = c("overwrite", "c"),
        parameters = list(
          input     = fragment_id,
          output    = output_fragment_id,
          createopt = "COMPRESS=DEFLATE,BIGTIFF=YES"
        )
      )
    }

    if (want_area) {
      execGRASS(
        "r.out.gdal",
        flags = c("overwrite", "c"),
        parameters = list(
          input     = area_map,
          output    = output_fragment_area,
          createopt = "COMPRESS=DEFLATE,BIGTIFF=YES"
        )
      )
    }

  })

  # -------------------------------------------------------------
  # 12 LIMPIEZA
  # -------------------------------------------------------------

  log_step("LIMPIEZA", {

    rasters_to_remove <- c(base_name, fragment, fragment_id)
    if (want_area) rasters_to_remove <- c(rasters_to_remove, area_cell, area_map)

    execGRASS(
      "g.remove",
      flags = "f",
      parameters = list(
        type = "raster",
        name = paste(rasters_to_remove, collapse = ",")
      )
    )

  })

  } # fin de `if (!already_done)`

  # -------------------------------------------------------------
  # 11B SUBIR A GCS (opcional — corre siempre que upload_to_gcs=TRUE, ya se
  # haya calculado recién o ya existiera localmente de antes. Requiere
  # permiso de escritura en el service account, Storage Object Viewer no
  # alcanza)
  # -------------------------------------------------------------

  if (upload_to_gcs) {
    log_step("SUBIR_GCS", {

      # Cada archivo en su propio tryCatch — si uno falla, queda claro cuál
      # fue y no impide intentar el otro. type="image/tiff" explícito para
      # no depender de que gcs_upload() lo autodetecte. Si el objeto ya
      # existe se borra antes de subir: confirmado que sobrescribir en el
      # mismo nombre rompe la subida resumable de gcs_upload() (el intento
      # de "resume" falla con "Couldn't get upload status"); subir sobre un
      # nombre nuevo/vacío sí funciona.
      upload_one <- function(path) {
        object_name <- paste0(gcs_output_prefix, "/", basename(path))
        tryCatch({
          existing <- googleCloudStorageR::gcs_list_objects(bucket = bucket_name, prefix = object_name)
          if (object_name %in% existing$name) {
            googleCloudStorageR::gcs_delete_object(object_name, bucket = bucket_name)
            log_message(paste0("Borrado objeto existente antes de subir: ", object_name))
          }
          googleCloudStorageR::gcs_upload(
            path, bucket = bucket_name, name = object_name,
            type = "image/tiff", predefinedAcl = "bucketLevel"
          )
          log_message(paste0("Subido: gs://", bucket_name, "/", object_name))
        }, error = function(e) {
          stop(paste0("Falló subiendo ", object_name, ": ", conditionMessage(e)))
        })
      }

      if (want_id)   upload_one(output_fragment_id)
      if (want_area) upload_one(output_fragment_area)
    })
  }

  log_message(paste("===== Año", year, "finalizado con ÉXITO ====="))
}

for (year in years) {
  process_year(year)
}
