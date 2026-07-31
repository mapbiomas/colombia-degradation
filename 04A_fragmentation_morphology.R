#!/usr/bin/env Rscript
# =============================================================
# Nombre: 04A_fragmentation_morphology.R
# Descripción: Calcula la morfología espacial (MSPA) de parches de
#              vegetación nativa usando GRASS GIS. Docker-ready.
#              Procesa por región para controlar el uso de disco.
#
#   Un año / varios:
#     Rscript 04A_fragmentation_morphology.R 30471 1985 1986
#   GNU parallel:
#     parallel -j 4 Rscript 04A_fragmentation_morphology.R 30471 ::: $(seq 1985 2024)
#
# Entradas:
#   ./gis/region_vector_buffer.geojson   (vector de regiones)
#   ./tif/nativeMask-classification_YYYY.tif  (descargado de GCS si falta)
# Salidas:
#   ./results/04A/morphology_YYYY_RRRR.tif
#     0 = Sin vegetación nativa (fondo)
#     1 = Núcleo       — interior del parche, lejos del borde
#     2 = Borde        — píxeles en el margen del parche nativo
#     3 = Corredor     — franja delgada que conecta dos núcleos
#     4 = Rama         — apéndice conectado solo por un extremo a un núcleo
#     5 = Piedra de paso — parche pequeño aislado, no conectado a núcleos
#     6 = Perforación  — borde interno alrededor de un hueco dentro del parche
#
# Porta lsm_aux_fill_hole y lsm_aux_grow directamente en R — sin depender
# del paquete lsmetrics de GitHub
# =============================================================

region_id_default <- 30471   # <-- cambiar aquí para correr otra región

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
years     <- if (length(args) > 1) args[-1] else as.character(years_list)

suppressPackageStartupMessages({
  library(rgrass)
  library(sf)
  library(terra)
})

# ---- GCS ----
bucket_name       <- "mbcolombia-degradacion"
gcs_input_prefix  <- "AUXILIARES/DEGRADACION/COL_3/temp"
gcs_output_prefix <- paste0("AUXILIARES/DEGRADACION/COL_3/results_04A/", region_id)
gcs_key_file      <- "key.json"
upload_to_gcs     <- TRUE
cleanup_grassdata  <- TRUE

# ---- Dirs ----
tif_dir     <- "./tif"
results_dir <- "./results/04A"
gisDbase    <- "./grassdata"
log_dir     <- "./logs"
gis_dir     <- "./gis"
for (d in c(tif_dir, results_dir, gisDbase, log_dir))
  dir.create(d, showWarnings = FALSE, recursive = TRUE)

# ---- GRASS ----
# Fallback para Windows: GRASS suele instalarse empaquetado dentro de QGIS
# en vez de quedar disponible como `grass` en el PATH.
grass_exec <- Sys.which("grass")
if (grass_exec == "" && file.exists("C:/Program Files/QGIS 4.0.3/bin/grass84.bat")) {
  grass_exec <- "C:/Program Files/QGIS 4.0.3/bin/grass84.bat"
}
if (grass_exec == "") stop("No se encontró GRASS GIS en el PATH")
grass_path <- system(paste(shQuote(grass_exec), "--config path"), intern = TRUE)

# ---- GCS auth ----
if (file.exists(gcs_key_file)) {
  suppressPackageStartupMessages(library(googleCloudStorageR))
  googleCloudStorageR::gcs_auth(gcs_key_file)
}

# ---- Cargar región ----
geojson_path <- file.path(gis_dir, "region_vector_buffer.geojson")
if (!file.exists(geojson_path))
  stop("No se encontró el GeoJSON de regiones: ", geojson_path)
regions_sf <- sf::st_read(geojson_path, quiet = TRUE)
region_sf  <- regions_sf[regions_sf$id_regionC == as.integer(region_id), ]
if (nrow(region_sf) == 0)
  stop("No se encontró id_regionC=", region_id, " en ", geojson_path)
cat("Región:", region_id,
    "| bioma:", unique(region_sf$bioma),
    "| features:", nrow(region_sf), "\n")

# =============================================================
# Puerto de lsm_aux_fill_hole (lsmetrics::lsm_aux_fill_hole)
# Rellena huecos internos de un raster binario. Un hueco es un
# componente conexo de fondo que toca exactamente un parche vecino.
# =============================================================
aux_fill_hole <- function(input_map, zero_as_null = FALSE) {

  execGRASS("g.region", flags = "a",
            parameters = list(raster = input_map))

  pfx            <- paste0(input_map, "_aux_fill_hole")
  null_map       <- paste0(pfx, "_null")
  binary_map     <- paste0(pfx, "_binary")
  id_map         <- paste0(pfx, "_id")
  matrix_null    <- paste0(pfx, "_matrix_null")
  matrix_id      <- paste0(pfx, "_matrix_id")
  id_dilation    <- paste0(pfx, "_id_dilation")
  matrix_id_fill <- paste0(pfx, "_matrix_id_fill")
  matrix_fill    <- paste0(pfx, "_matrix_fill")
  output_map     <- pfx
  rules_file     <- tempfile(fileext = ".txt")

  if (zero_as_null) {
    execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
              parameters = list(expression = paste0(null_map, " = ", input_map)))
    execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
              parameters = list(expression =
                paste0(binary_map, " = if(isnull(", input_map, "), 0, 1)")))
  } else {
    execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
              parameters = list(expression =
                paste0(null_map, " = if(", input_map, " == 1, 1, null())")))
    execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
              parameters = list(expression = paste0(binary_map, " = ", input_map)))
  }

  execGRASS("r.clump", flags = c("d", "overwrite", "quiet"),
            parameters = list(input = null_map, output = id_map))

  execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
            parameters = list(expression =
              paste0(matrix_null, " = if(isnull(", null_map, "), 1, null())")))

  execGRASS("r.clump", flags = c("d", "overwrite", "quiet"),
            parameters = list(input = matrix_null, output = matrix_id))

  execGRASS("r.neighbors", flags = c("overwrite", "quiet"),
            input = id_map, selection = binary_map, output = id_dilation,
            size = 3, method = "max")

  stats_lines <- execGRASS(
    "r.stats", flags = c("n", "quiet"),
    parameters = list(
      input     = paste0(matrix_id, ",", id_dilation),
      separator = "space"
    ),
    intern = TRUE
  )

  stats_clean <- stats_lines[nzchar(trimws(stats_lines))]

  if (length(stats_clean) > 0) {
    parts  <- strsplit(trimws(stats_clean), " ")
    mid    <- sapply(parts, `[[`, 1)
    counts <- as.data.frame(table(mid), stringsAsFactors = FALSE)
    colnames(counts) <- c("id", "n")
    writeLines(paste0(counts$id, " = ", counts$n), rules_file)

    execGRASS("r.reclass", flags = c("overwrite", "quiet"),
              parameters = list(input  = matrix_id,
                                output = matrix_id_fill,
                                rules  = rules_file))
    file.remove(rules_file)

    execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
              parameters = list(expression =
                paste0(matrix_fill, " = if(", matrix_id_fill, " == 1, 1, 0)")))
    execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
              parameters = list(expression =
                paste0(matrix_fill, " = if(isnull(", matrix_fill, "), 0, ", matrix_fill, ")")))
  } else {
    if (file.exists(rules_file)) file.remove(rules_file)
    execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
              parameters = list(expression =
                paste0(matrix_fill, " = ", binary_map, " * 0")))
  }

  execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
            parameters = list(expression =
              paste0(output_map, " = ", binary_map, " + ", matrix_fill)))

  if (zero_as_null) {
    execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
              parameters = list(expression =
                paste0(output_map, " = if(", binary_map, " == 0, null(), 1)")))
  }

  to_rm <- paste(c(null_map, binary_map, matrix_null, matrix_fill,
                   matrix_id_fill, matrix_id, id_map, id_dilation),
                 collapse = ",")
  execGRASS("g.remove", flags = "f",
            parameters = list(type = "raster", name = to_rm))

  invisible(output_map)
}

# =============================================================
# Puerto de lsm_aux_grow (lsmetrics::lsm_aux_grow)
# Dilata un raster por 1 píxel vía r.grow.distance.
# =============================================================
aux_grow <- function(input_map, output_map,
                     radius = 1.01, metric = "euclidean") {

  reg_lines <- execGRASS("g.region", flags = "g", intern = TRUE)
  get_reg   <- function(key) {
    line <- grep(paste0("^", key, "="), reg_lines, value = TRUE)
    as.numeric(sub(paste0("^", key, "="), "", line))
  }
  scale     <- sqrt(get_reg("nsres") * get_reg("ewres"))
  radius_mu <- (radius + 0.01) * scale

  if (metric == "euclidean") {
    metric    <- "squared"
    radius_mu <- radius_mu ^ 2
  }

  pid       <- Sys.getpid()
  temp_dist <- paste0("r_grow_tmp_", pid, "_dist")
  temp_val  <- paste0("r_grow_tmp_", pid, "_val")

  execGRASS("r.grow.distance", flags = c("overwrite", "quiet"),
            parameters = list(input    = input_map,
                              metric   = metric,
                              distance = temp_dist,
                              value    = temp_val))

  execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
            parameters = list(expression = sprintf(
              "%s = if(!isnull(%s), %s, if(%s < %g, %s, null()))",
              output_map, input_map, input_map,
              temp_dist, radius_mu, temp_val
            )))

  execGRASS("g.remove", flags = "f",
            parameters = list(type = "raster",
                              name = paste0(temp_dist, ",", temp_val)))

  invisible(output_map)
}

# ---- Helpers ----
grass_has_raster <- function(name) {
  res <- tryCatch(
    execGRASS("g.findfile", flags = "quiet",
               parameters = list(element = "cell", file = name),
               intern = TRUE),
    error = function(e) character(0)
  )
  any(nzchar(sub("^file=", "", grep("^file=", res, value = TRUE))))
}

download_input_if_missing <- function(year) {
  dest <- file.path(tif_dir, paste0("nativeMask-classification_", year, ".tif"))
  if (file.exists(dest)) return(dest)
  if (!file.exists(gcs_key_file))
    stop(paste0("TIF no encontrado y no hay ", gcs_key_file, " para descargarlo de GCS."))
  obj <- paste0(gcs_input_prefix, "/nativeMask-classification_", year, ".tif")
  cat("Descargando", obj, "...\n")
  googleCloudStorageR::gcs_get_object(obj, bucket = bucket_name,
                                       saveToDisk = dest, overwrite = TRUE)
  if (!file.exists(dest)) stop(paste("No se pudo descargar:", obj))
  dest
}

# =============================================================
# process_year — corre el pipeline MSPA completo para un año/región
# =============================================================
process_year <- function(year, region_id, region_sf) {

  log_file <- file.path(log_dir, paste0(region_id, "_", year, "_morphology.log"))

  log_message <- function(msg) {
    line <- paste0("[", format(Sys.time(), "%Y-%m-%d %H:%M:%S", tz = "America/Bogota"), "] ", msg, "\n")
    cat(line)
    cat(line, file = log_file, append = TRUE)
  }

  log_step <- function(step_name, expr) {
    t0 <- Sys.time()
    log_message(paste("----", step_name, "START ----"))
    result <- withCallingHandlers(
      tryCatch(expr, error = function(e) {
        log_message(paste("ERROR en", step_name, ":", e$message))
        stop(e)
      }),
      warning = function(w) {
        log_message(paste("WARNING en", step_name, ":", conditionMessage(w)))
        invokeRestart("muffleWarning")
      }
    )
    dt <- round(as.numeric(difftime(Sys.time(), t0, units = "secs")), 1)
    log_message(paste0("---- ", step_name, " END (", dt, "s) ----"))
    result
  }

  log_message(paste("===== Procesando morfología región", region_id, "año", year, "====="))
  year_t0       <- Sys.time()
  location_name <- paste0("COL3_MORPH_", region_id, "_", year)
  location_path <- file.path(gisDbase, location_name)
  input_clipped <- NULL

  on.exit({
    if (!is.null(input_clipped) && file.exists(input_clipped))
      file.remove(input_clipped)
    if (cleanup_grassdata && dir.exists(location_path)) {
      unlink(location_path, recursive = TRUE)
      log_message(paste0("Limpieza: borrado ", location_path))
    }
    dt <- round(as.numeric(difftime(Sys.time(), year_t0, units = "secs")), 1)
    log_message(paste0("===== Región ", region_id, " Año ", year, " total: ", dt,
                        "s (", round(dt / 60, 1), " min) ====="))
  })

  output_file <- file.path(results_dir,
                           paste0("morphology_", year, "_", region_id, ".tif"))

  if (file.exists(output_file)) {
    log_message("Output ya existe localmente. Saltando cómputo GRASS.")
  } else {

    input_raster <- download_input_if_missing(year)

    # ------ Paso 0 — RECORTAR_RASTER ------
    # Recorta el TIF completo de Colombia al bbox de la región antes de
    # importar en GRASS, para que nunca se escriban los ~3.6 GB nacionales.
    input_clipped <- tempfile(fileext = ".tif")
    log_step("RECORTAR_RASTER", {
      region_pr <- sf::st_transform(region_sf,
                                    crs = terra::crs(terra::rast(input_raster)))
      bbox <- sf::st_bbox(region_pr)
      ret  <- system2("gdal_translate",
                      args   = c("-projwin",
                                 bbox["xmin"], bbox["ymax"],
                                 bbox["xmax"], bbox["ymin"],
                                 shQuote(input_raster),
                                 shQuote(input_clipped)),
                      stdout = TRUE, stderr = TRUE)
      if (!file.exists(input_clipped))
        stop("Falló gdal_translate: ", paste(ret, collapse = "\n"))
      size_mb <- round(file.info(input_clipped)$size / 1024^2, 1)
      log_message(paste0("  Recortado: ", size_mb, " MB → ", input_clipped))
    })

    base     <- paste0("nativeMask_", year)
    r_null   <- paste0(base, "_morphological_segmentation_null")
    r_bin    <- paste0(base, "_morphological_segmentation_binary")
    r_id     <- paste0(base, "_morphological_segmentation_id")
    r_matrix <- paste0(base, "_morphological_segmentation_matrix")
    r_core   <- paste0(base, "_morphological_segmentation_core")
    r_step   <- paste0(base, "_morphological_segmentation_stepping_stone")
    r_edge   <- paste0(base, "_morphological_segmentation_edge")
    r_bcp    <- paste0(base, "_morphological_segmentation_branch_corridor_perforation")
    r_bcb    <- paste0(base, "_morphological_segmentation_branch_corridor_binary")
    r_bcn    <- paste0(base, "_morphological_segmentation_branch_corridor_null")
    r_bcid   <- paste0(base, "_morphological_segmentation_branch_corridor_id")
    r_bcid_d <- paste0(base, "_morphological_segmentation_branch_corridor_id_dila")
    r_patchb <- paste0(base, "_morphological_segmentation_patch_binary")
    r_patchn <- paste0(base, "_morphological_segmentation_patch_null")
    r_patchi <- paste0(base, "_morphological_segmentation_patch_id")
    r_bcid_c <- paste0(base, "_morphological_segmentation_branch_corridor_id_dila_count")
    r_bcid_a <- paste0(base, "_morphological_segmentation_branch_corridor_id_dila_count_adj")
    r_perf   <- paste0(base, "_morphological_segmentation_perforation")
    r_perf_d <- paste0(base, "_morphological_segmentation_perforation_dila")
    r_corr   <- paste0(base, "_morphological_segmentation_corridor")
    r_branch <- paste0(base, "_morphological_segmentation_branch")
    r_final  <- paste0(base, "_morphological_segmentation")

    # ------ Paso 1 — CREAR_LOCATION ------
    log_step("CREAR_LOCATION", {
      if (!dir.exists(location_path)) {
        cmd <- sprintf("%s -c %s %s -e",
                       shQuote(grass_exec),
                       shQuote(input_clipped),
                       shQuote(location_path))
        if (system(cmd) != 0) stop("Falló la creación de la GRASS location")
      }
    })

    # ------ Paso 2 — INICIALIZAR_GRASS ------
    log_step("INICIALIZAR_GRASS", {
      initGRASS(gisBase = grass_path, home = tempdir(),
                gisDbase = gisDbase, location = location_name,
                mapset = "PERMANENT", override = TRUE)
    })

    # ------ Paso 3 — IMPORTAR_RASTER ------
    log_step("IMPORTAR_RASTER", {
      if (!grass_has_raster(base))
        execGRASS("r.in.gdal", flags = c("overwrite", "o"),
                  parameters = list(input = input_clipped, output = base))
    })

    # ------ Paso 4 — DEFINIR_REGION ------
    log_step("DEFINIR_REGION", {
      execGRASS("g.region", parameters = list(raster = base, align = base))
    })

    # ------ Paso 5 — APLICAR_MASCARA ------
    # Importar el polígono de la región como vector y aplicar r.mask,
    # para que todos los pasos solo procesen dentro del límite regional.
    log_step("APLICAR_MASCARA", {
      proj_wkt    <- execGRASS("g.proj", flags = c("w"), intern = TRUE)
      region_proj <- sf::st_transform(region_sf,
                                      crs = sf::st_crs(paste(proj_wkt, collapse = "\n")))
      region_tmp  <- tempfile(fileext = ".gpkg")
      sf::st_write(region_proj, region_tmp, quiet = TRUE)
      execGRASS("v.in.ogr", flags = c("overwrite", "quiet"),
                parameters = list(input = region_tmp, output = "region_mask"))
      file.remove(region_tmp)
      execGRASS("r.mask", flags = c("overwrite"),
                parameters = list(vector = "region_mask"))
    })

    # ------ Paso 6 — MORPH_NULL (nativo=1, resto=null) ------
    log_step("MORPH_NULL", {
      if (!grass_has_raster(r_null))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_null, " = if(", base, " == 1, 1, null())")))
    })

    # ------ Paso 7 — MORPH_BINARY ------
    log_step("MORPH_BINARY", {
      if (!grass_has_raster(r_bin))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_bin, " = ", base)))
    })

    # ------ Paso 8 — MORPH_CLUMP (ID único por parche) ------
    log_step("MORPH_CLUMP", {
      if (!grass_has_raster(r_id))
        execGRASS("r.clump", flags = c("d", "quiet", "overwrite"),
                  parameters = list(input = r_null, output = r_id))
    })

    # ------ Paso 9 — MORPH_MATRIX (invertir: nativo=0, fondo=1) ------
    log_step("MORPH_MATRIX", {
      if (!grass_has_raster(r_matrix))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_matrix, " = if(", r_bin, " == 1, 0, 1)")))
    })

    # ------ Paso 10 — MORPH_CORE (erosión: mínimo en vecindad 3x3) ------
    log_step("MORPH_CORE", {
      if (!grass_has_raster(r_core))
        execGRASS("r.neighbors", flags = c("overwrite", "quiet"),
                  input = r_bin, selection = r_bin, output = r_core,
                  size = 3, method = "min")
    })

    # ------ Paso 11 — MORPH_STEPPING_STONE ------
    log_step("MORPH_STEPPING_STONE", {
      if (!grass_has_raster(r_step)) {
        execGRASS("r.stats.zonal", flags = c("overwrite", "quiet"),
                  parameters = list(base   = r_id, cover = r_core,
                                    method = "sum", output = r_step))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_step, " = if(", r_step, " == 0, 1, null())")))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_step, " = if(isnull(", r_step, "), 0, 1)")))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_step, " = ", r_step, " * ", r_bin)))
      }
    })

    # ------ Paso 12 — MORPH_EDGE (usa aux_fill_hole) ------
    log_step("MORPH_EDGE", {
      if (!(grass_has_raster(r_edge) && grass_has_raster(r_patchb))) {
        log_message("  aux_fill_hole en curso (puede tardar varios minutos)...")
        aux_fill_hole(r_bin, zero_as_null = FALSE)
        fill_map  <- paste0(r_bin, "_aux_fill_hole")
        contr_map <- paste0(r_bin, "_fill_hole_contr")

        execGRASS("r.neighbors", flags = c("overwrite", "quiet"),
                  input = fill_map, selection = base,
                  output = contr_map, size = 3, method = "min")
        execGRASS("r.neighbors", flags = c("overwrite", "quiet"),
                  input = contr_map, selection = base,
                  output = r_patchb, size = 3, method = "max")
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression = paste0(
                    r_edge, " = if((", r_patchb, " - ",
                    contr_map, " - ", r_step, ") > 0, 1, 0)")))

        execGRASS("g.remove", flags = "f",
                  parameters = list(type = "raster",
                                    name = paste(fill_map, contr_map, sep = ",")))
      }
    })

    # ------ Paso 13 — MORPH_BCP ------
    log_step("MORPH_BCP", {
      if (!grass_has_raster(r_bcp))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_bcp, " = ", base, " - ", r_patchb, " - ", r_step)))
    })

    # ------ Paso 14 — MORPH_BC_BINARY ------
    log_step("MORPH_BC_BINARY", {
      if (!grass_has_raster(r_bcb))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_bcb, " = if(", r_bcp, " == 1, 1, 0)")))
    })

    # ------ Paso 15 — MORPH_BC_NULL ------
    log_step("MORPH_BC_NULL", {
      if (!grass_has_raster(r_bcn))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_bcn, " = if(", r_bcb, " == 1, 1, null())")))
    })

    # ------ Paso 16 — MORPH_BC_CLUMP ------
    log_step("MORPH_BC_CLUMP", {
      if (!grass_has_raster(r_bcid))
        execGRASS("r.clump", flags = c("d", "quiet", "overwrite"),
                  parameters = list(input = r_bcn, output = r_bcid))
    })

    # ------ Paso 17 — MORPH_BC_GROW (aux_grow / r.grow.distance) ------
    log_step("MORPH_BC_GROW", {
      if (!grass_has_raster(r_bcid_d)) {
        log_message("  aux_grow/r.grow.distance en curso (puede tardar varios minutos)...")
        # metric="maximum" truncaba la distancia a 0 en este CRS geografico,
        # dejando el crecimiento sin limite real. radius=1.42 con euclidean
        # cubre tambien las diagonales (sqrt(2)).
        aux_grow(r_bcid, r_bcid_d, radius = 1.42, metric = "euclidean")
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_bcid_d, " = int(", r_bcid_d, ")")))
      }
    })

    # ------ Paso 18 — MORPH_PATCH_NULL ------
    log_step("MORPH_PATCH_NULL", {
      if (!grass_has_raster(r_patchn))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_patchn, " = if(", r_patchb, " == 1, 1, null())")))
    })

    # ------ Paso 19 — MORPH_PATCH_CLUMP ------
    log_step("MORPH_PATCH_CLUMP", {
      if (!grass_has_raster(r_patchi))
        execGRASS("r.clump", flags = c("d", "quiet", "overwrite"),
                  parameters = list(input = r_patchn, output = r_patchi))
    })

    # ------ Paso 20 — MORPH_BC_ZONAL ------
    log_step("MORPH_BC_ZONAL", {
      if (!grass_has_raster(r_bcid_c))
        execGRASS("r.stats.zonal", flags = c("c", "overwrite", "quiet"),
                  parameters = list(base   = r_bcid_d, cover = r_patchi,
                                    method = "range", output = r_bcid_c))
    })

    # ------ Paso 21 — MORPH_BC_ADJ ------
    log_step("MORPH_BC_ADJ", {
      if (!grass_has_raster(r_bcid_a))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_bcid_a, " = ", r_bcid_c, " * ", r_bcn)))
    })

    # ------ Paso 22 — MORPH_PERFORATION ------
    log_step("MORPH_PERFORATION", {
      if (!grass_has_raster(r_perf)) {
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_perf, " = if(", r_bcp, " < 0, 1, 0)")))
        execGRASS("r.neighbors", flags = c("overwrite", "quiet"),
                  input = r_perf, selection = base,
                  output = r_perf_d, size = 3, method = "max")
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_perf, " = ", r_perf_d, " * ", r_null)))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_perf, " = ", r_perf, " - ", r_step, " - ", r_edge)))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_perf, " = if(", r_perf, " == -1, 0, ", r_perf, ")")))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_perf, " = if(isnull(", r_perf, "), 0, ", r_perf, ")")))
      }
    })

    # ------ Paso 23 — MORPH_CORRIDOR ------
    log_step("MORPH_CORRIDOR", {
      if (!grass_has_raster(r_corr)) {
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_corr, " = if(", r_bcid_a, " > 0, 1, null())")))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_corr, " = if(isnull(", r_corr, "), 0, 1)")))
      }
    })

    # ------ Paso 24 — MORPH_BRANCH ------
    log_step("MORPH_BRANCH", {
      if (!grass_has_raster(r_branch)) {
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_branch, " = if(", r_bcid_a, " == 0, 1, null())")))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression =
                    paste0(r_branch, " = if(isnull(", r_branch, "), 0, 1)")))
      }
    })

    # ------ Paso 25 — MORPH_FINAL ------
    log_step("MORPH_FINAL", {
      if (!grass_has_raster(r_final))
        execGRASS("r.mapcalc", flags = c("overwrite", "quiet"),
                  parameters = list(expression = paste0(
                    r_final, " = ",
                    r_core,   "*1 + ",
                    r_edge,   "*2 + ",
                    r_corr,   "*3 + ",
                    r_branch, "*4 + ",
                    r_step,   "*5 + ",
                    r_perf,   "*6"
                  )))
    })

    # ------ Paso 26 — EXPORTAR ------
    log_step("EXPORTAR", {
      execGRASS("r.out.gdal", flags = c("overwrite", "c"),
                parameters = list(input     = r_final,
                                  output    = output_file,
                                  createopt = "COMPRESS=DEFLATE,BIGTIFF=YES"))
    })

    size_mb <- round(file.info(output_file)$size / 1024 ^ 2, 1)
    log_message(paste0("Tamaño: ", size_mb, " MB → ", output_file))

  } # fin if (!file.exists(output_file))

  # ---- Subir a GCS ----
  if (upload_to_gcs) {
    log_step("SUBIR_GCS", {
      object_name <- paste0(gcs_output_prefix, "/", basename(output_file))
      tryCatch({
        existing <- googleCloudStorageR::gcs_list_objects(
          bucket = bucket_name, prefix = object_name)
        if (object_name %in% existing$name) {
          googleCloudStorageR::gcs_delete_object(object_name, bucket = bucket_name)
          log_message(paste0("Borrado objeto existente: ", object_name))
        }
        googleCloudStorageR::gcs_upload(
          output_file, bucket = bucket_name, name = object_name,
          type = "image/tiff", predefinedAcl = "bucketLevel"
        )
        log_message(paste0("Subido: gs://", bucket_name, "/", object_name))
      }, error = function(e) {
        stop(paste0("Falló subiendo ", object_name, ": ", conditionMessage(e)))
      })
    })
  }

  log_message(paste("===== Región", region_id, "Año", year, "finalizado con ÉXITO ====="))
}

# ---- Main ----
for (year in years) {
  process_year(year, region_id, region_sf)
}
