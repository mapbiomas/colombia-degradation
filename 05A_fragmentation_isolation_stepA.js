/****
 * Nombre: 05A_fragmentation_isolation_stepA.js
 * Descripción: Paso A del cálculo de aislamiento de parches. Prepara la
 *              máscara de vegetación nativa a la RESOLUCIÓN que necesita el
 *              resto de la cadena de aislamiento: 100 m.
 *
 *              Resolución de 100 m (no 30 m como el resto del pipeline):
 *              05B calcula el tamaño de cada parche con connectedPixelCount(),
 *              que cuenta píxeles conectados, no hectáreas. A 100 m de
 *              resolución, 1 píxel = 100m × 100m = 10.000 m² = 1 hectárea,
 *              lo que permite a 05C/05D comparar tamaños de parche en
 *              hectáreas comparando directamente el conteo de píxeles
 *              (gte(1000) = parche de 1.000 ha o más), sin conversión de
 *              unidades.
 *
 * Entradas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/native_mask/nativeMask_col3_v1
 *     (asset multibanda de 02A, banda classification_YYYY, binario 1/0, 30 m)
 *
 * Salidas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/05_isolation/natural_mask_100m_col{N}_v{V}
 *     → ee.Image multi-banda: natural_YYYY (int16, 100 m)
 *
 * Autor original: dhemerson.costa@ipam.org.br
 * Adaptación Colombia: mapbiomas-colombia
 * Fecha: 2026-07
****/

// ============================================================
// PARÁMETROS GENERALES
// ============================================================

var collectionId = 1;   // colección de MapBiomas Colombia (insumo LULC/nativo)
var version_out  = 1;

var PROCESS_ROOT = 'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/';

// Años a procesar (deben existir como banda classification_YYYY en el asset
// de 02A)
var years_list = [
  1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995,
  1996, 1997, 1998, 1999,
  2000, 2001, 2002, 2003, 2004, 2005, 2006,
  2007, 2008, 2009, 2010, 2011, 2012, 2013,
  2014, 2015, 2016, 2017, 2018, 2019, 2020,
  2021, 2022, 2023, 2024
];

// ============================================================
// CARGA DEL INSUMO — máscara nativa nacional de 02A
// ============================================================

var nativeMask = ee.Image(PROCESS_ROOT + '02_native_mask/nativeMask_col3_v1');
print('Máscara nativa (30 m, de 02A):', nativeMask);

var colombia = ee.FeatureCollection(
  'users/mapbiomas_andessur/2024/Lim_Colombia'
).geometry().bounds();

// ============================================================
// RE-PROYECCIÓN A 100 M, AÑO POR AÑO
// ============================================================
// reproject() fija la resolución de trabajo a 100 m. El remuestreo por
// defecto de GEE (vecino más cercano) preserva los valores binarios (1/0)
// de la máscara — un remuestreo bilineal/cúbico introduciría valores
// intermedios no deseados.

var naturalMask100m = ee.Image([]);

years_list.forEach(function (year_j) {

  var natural_ano = nativeMask
    .select('classification_' + year_j)
    .reproject({ crs: 'EPSG:4326', scale: 100 })
    .rename('natural_' + year_j);

  naturalMask100m = naturalMask100m.addBands(natural_ano);

});

naturalMask100m = naturalMask100m.toInt16();

print('naturalMask100m:', naturalMask100m);
Map.addLayer(naturalMask100m.select('natural_2024'), {}, 'natural_2024 (100 m)', false);

// ============================================================
// EXPORTACIÓN
// ============================================================

var task_name = 'natural_mask_100m_col' + collectionId + '_v' + version_out;

Export.image.toAsset({
  image: naturalMask100m,
  description: task_name,
  assetId: PROCESS_ROOT + '05_isolation/' + task_name,
  region: colombia,
  scale: 100,
  pyramidingPolicy: { '.default': 'mode' },
  maxPixels: 1e13,
  priority: 999
});
