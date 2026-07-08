/****
 * Nombre: 05B_fragmentation_isolation_stepB.js
 * Descripción: Paso B del cálculo de aislamiento de parches. Calcula, para
 *              cada año, el tamaño de cada parche de vegetación nativa en
 *              PÍXELES CONECTADOS (que a 100 m equivalen directamente a
 *              hectáreas — ver nota en 05A) usando connectedPixelCount(), y
 *              agrega ese resultado como una banda adicional junto a la
 *              máscara nativa.
 *
 * Entradas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/05_isolation/natural_mask_100m_col{N}_v{V}
 *     (de 05A)
 *
 * Salidas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/05_isolation/natural_mask_100m_col{N}_v{V}_conn
 *     → ee.Image multi-banda: natural_YYYY + conect_YYYY (int16, 100 m)
 *       conect_YYYY = tamaño del parche en píxeles conectados (≈ hectáreas)
 *
 *
 * Autor original: dhemerson.costa@ipam.org.br
 * Adaptación Colombia: mapbiomas-colombia
 * Fecha: 2026-07
****/

// ============================================================
// PARÁMETROS GENERALES
// ============================================================

var collectionId = 1;
var version       = 1;

var PROCESS_ROOT = 'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/';

var years_list = [
  1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995,
  1996, 1997, 1998, 1999,
  2000, 2001, 2002, 2003, 2004, 2005, 2006,
  2007, 2008, 2009, 2010, 2011, 2012, 2013,
  2014, 2015, 2016, 2017, 2018, 2019, 2020,
  2021, 2022, 2023, 2024
];

// ============================================================
// CARGA DEL INSUMO (05A)
// ============================================================

var naturalMask100m = ee.Image(
  PROCESS_ROOT + '05_isolation/natural_mask_100m_col' + collectionId + '_v' + version
);

var colombia = ee.FeatureCollection(
  'users/mapbiomas_andessur/2024/Lim_Colombia'
).geometry().bounds();

// ============================================================
// CONECTIVIDAD POR AÑO
// ============================================================

var naturalMask100mConn = ee.Image([]);

years_list.forEach(function (year_j) {

  var natural_ano = naturalMask100m.select('natural_' + year_j);

  // selfMask(): connectedPixelCount solo tiene sentido sobre los píxeles
  // nativos (1); el fondo (0) queda sin dato y no participa del conteo.
  // eightConnected=true: dos píxeles que solo se tocan por una esquina
  // cuentan como el mismo parche (igual criterio que r.clump -d en 03A/04A).
  var con_ano = natural_ano.selfMask()
    .connectedPixelCount(1024, true)
    .reproject('EPSG:4326', null, 100);

  natural_ano = natural_ano.addBands(con_ano.rename('conect_' + year_j));

  naturalMask100mConn = naturalMask100mConn.addBands(natural_ano);

});

naturalMask100mConn = naturalMask100mConn.toInt16();

print('naturalMask100mConn:', naturalMask100mConn);
Map.addLayer(naturalMask100mConn.select('conect_2024'),
  { min: 0, max: 1024, palette: ['red', 'yellow', 'green'] },
  'conect_2024 (px conectados ≈ ha)', false);

// ============================================================
// EXPORTACIÓN
// ============================================================

var task_name = 'natural_mask_100m_col' + collectionId + '_v' + version + '_conn';

Export.image.toAsset({
  image: naturalMask100mConn,
  description: task_name,
  assetId: PROCESS_ROOT + '05_isolation/' + task_name,
  region: colombia,
  scale: 100,
  pyramidingPolicy: { '.default': 'mode' },
  maxPixels: 1e13,
  priority: 999
});
