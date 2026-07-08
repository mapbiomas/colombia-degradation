/****
 * Nombre: 02B_utils_exportToBucket.js
 * Descripción: Exporta la máscara de vegetación nativa (generada en 02A) desde
 *              GEE hacia un bucket de Google Cloud Storage o Google Drive,
 *              descomponiendo la imagen multi-banda en un GeoTIFF por año.
 *              Estos archivos son el insumo para el cálculo de métricas de
 *              paisaje en R (pasos 03–05): tamaño de parches, morfología e
 *              isolamiento (ENN).
 *
 *              Seleccionar el destino con la variable `exportTarget`:
 *                'gcs'   → Google Cloud Storage (recomendado para producción)
 *                'drive' → Google Drive         (útil para pruebas / sin bucket)
 *
 * Entradas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/02_native_mask/nativeMask_col3_v1 (de 02A)
 *
 * Salidas (GCS o Drive):
 *   temp/nativeMask-classification_YYYY.tif (1 GeoTIFF por año)
 *
 * Autor original: dhemerson.costa@ipam.org.br
 * Adaptación Colombia: mapbiomas-colombia
 * Fecha: 2026-05
****/

// ============================================================
// PARÁMETROS
// ============================================================

// Asset de entrada: máscara nativa generada en 02A
var address = 'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/02_native_mask/' +
              'nativeMask_col3_v1';

// Destino de exportación: 'gcs' o 'drive'
var exportTarget = 'gcs';

// --- Google Cloud Storage ---
var bucket_name    = 'mbcolombia-degradacion';               // bucket GCS del proyecto cloud-ee-lmedinaj
var bucket_address = 'AUXILIARES/DEGRADACION/COL_3/temp/';  // Ruta dentro del bucket

// --- Google Drive ---
var drive_folder = 'mapbiomas-colombia-degradacion';  // Carpeta en Drive (se crea si no existe)

// ============================================================
// FUNCIONES DE EXPORTACIÓN
// ============================================================

// Exporta cada banda como GeoTIFF a Google Cloud Storage
function exportToGCS(image, name) {
  image.bandNames().evaluate(function(bandnames) {
    bandnames.forEach(function(bandname) {

      Export.image.toCloudStorage({
        image:          image.select(bandname),
        description:    name + '-' + bandname,
        bucket:         bucket_name,
        fileNamePrefix: bucket_address + name + '-' + bandname,
        region:         image.geometry(),
        scale:          30,
        maxPixels:      1e13,
        fileFormat:     'GeoTIFF'
      });

    });
  });
}

// Exporta cada banda como GeoTIFF a Google Drive
function exportToDrive(image, name) {
  image.bandNames().evaluate(function(bandnames) {
    bandnames.forEach(function(bandname) {

      Export.image.toDrive({
        image:          image.select(bandname),
        description:    name + '-' + bandname,
        folder:         drive_folder,
        fileNamePrefix: name + '-' + bandname,
        region:         image.geometry(),
        scale:          30,
        maxPixels:      1e13,
        fileFormat:     'GeoTIFF'
      });

    });
  });
}

// Enrutador: llama la función correcta según exportTarget
function exporting(image, name) {
  if (exportTarget === 'gcs') {
    exportToGCS(image, name);
  } else if (exportTarget === 'drive') {
    exportToDrive(image, name);
  } else {
    print('ERROR: exportTarget debe ser "gcs" o "drive". Valor actual: ' + exportTarget);
  }
}

// ============================================================
// EJECUCIÓN
// ============================================================

var nativeMask = ee.Image(address);
print('nativeMask Colombia:', nativeMask);
print('Destino de exportación:', exportTarget);

exporting(nativeMask, 'nativeMask');
