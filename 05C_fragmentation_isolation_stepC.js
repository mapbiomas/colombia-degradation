/****
 * Nombre: 05C_fragmentation_isolation_stepC.js
 * Descripción: Paso C del cálculo de aislamiento de parches. Para cada año:
 *              1) clasifica los parches nativos en 3 niveles de "área fuente"
 *                 según su tamaño (≥1.000 ha, ≥500 ha, ≥100 ha — recordar que
 *                 a 100 m, píxeles conectados = hectáreas, ver 05A/05B);
 *              2) calcula la distancia euclidiana (hasta 25 km) desde cada
 *                 nivel de área fuente hacia el resto del paisaje — mismo
 *                 principio de kernel euclidiano que usa 01A, aplicado desde
 *                 los bloques grandes de vegetación nativa en vez de desde
 *                 lo antrópico;
 *              3) etiqueta con un ID único (connectedComponents) cada
 *                 fragmento pequeño (≤ 1.000 ha) — insumo que 05D usará para
 *                 calcular, por fragmento, la distancia MÍNIMA a un área
 *                 fuente.
 *
 * Entradas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/05_isolation/natural_mask_100m_col{N}_v{V}_conn
 *     (de 05B)
 *
 * Salidas (GEE), todas multi-banda (1 banda por año), 100 m:
 *   05_isolation/distanceToNatural_maior1000ha_85_24_col{N}_v{V}  (int16, m)
 *   05_isolation/distanceToNatural_maior500ha_85_24_col{N}_v{V}   (int16, m)
 *   05_isolation/distanceToNatural_maior100ha_85_24_col{N}_v{V}   (int16, m)
 *   05_isolation/naturalFragments_menor1000ha_85_24_col{N}_v{V}   (ID de fragmento)
 *   05_isolation/natural_mask_maior1000ha_85_24_col{N}_v{V}       (máscara fuente)
 *   05_isolation/natural_mask_maior500ha_85_24_col{N}_v{V}        (máscara fuente)
 *   05_isolation/natural_mask_maior100ha_85_24_col{N}_v{V}        (máscara fuente)
 *
 * Autor original: dhemerson.costa@ipam.org.br
 * Adaptación Colombia: mapbiomas-colombia
 * Fecha: 2026-07
****/

// ============================================================
// PARÁMETROS GENERALES
// ============================================================

var collectionId  = 3;
var version        = 1;
var distanceRadius = 25000;   // metros — radio del kernel euclidiano (25 km)

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
// CARGA DEL INSUMO (05B)
// ============================================================

var naturalMaskConn = ee.Image(
  PROCESS_ROOT + '05_isolation/natural_mask_100m_col' + collectionId + '_v' + version + '_conn'
);

var colombia = ee.FeatureCollection(
  'users/mapbiomas_andessur/2024/Lim_Colombia'
).geometry().bounds();

// ============================================================
// PROCESAMIENTO POR AÑO
// ============================================================
// Los 7 acumuladores se declaran antes del forEach: `var` dentro del
// callback quedaría encerrado en el scope de esa función anónima y no
// sería visible después del loop. Se declaran afuera y se reasignan
// adentro vía closure — mismo patrón que 05A/05B.

var distanceTonatural_maior1000ha = ee.Image([]);
var distanceTonatural_maior500ha  = ee.Image([]);
var distanceTonatural_maior100ha  = ee.Image([]);
var naturalFragments_menor1000ha  = ee.Image([]);
var natural_mask_maior1000ha      = ee.Image([]);
var natural_mask_maior500ha       = ee.Image([]);
var natural_mask_maior100ha       = ee.Image([]);

years_list.forEach(function (year_j) {

  var conect_ano = naturalMaskConn.select('conect_' + year_j);

  // ---- Niveles de "área fuente" por tamaño de parche (en ha, vía px) ----
  var natural_mask_maior1000ha_ano = conect_ano.gte(1000);
  var natural_mask_maior500ha_ano  = conect_ano.gte(500);
  var natural_mask_maior100ha_ano  = conect_ano.gte(100);

  // Máscara de fragmentos pequeños (≤ 1.000 ha): remap([1],[0]) traduce
  // el valor 1 de .lte() a 0 y enmascara cualquier valor no listado en
  // `from` (sin defaultValue). Resultado: footprint binario de "pertenece
  // a un fragmento ≤1000ha", insumo de connectedComponents() más abajo.
  var con_menor_1000ha_ano = conect_ano.lte(1000).remap([1], [0]);

  // ---- Distancia euclidiana (hasta 25 km) desde cada nivel de área fuente ----
  var distanceTonatural_maior1000ha_ano = natural_mask_maior1000ha_ano
    .distance(ee.Kernel.euclidean(distanceRadius, 'meters'));
  var distanceTonatural_maior500ha_ano = natural_mask_maior500ha_ano
    .distance(ee.Kernel.euclidean(distanceRadius, 'meters'));
  var distanceTonatural_maior100ha_ano = natural_mask_maior100ha_ano
    .distance(ee.Kernel.euclidean(distanceRadius, 'meters'));

  // ---- Etiquetar fragmentos pequeños con un ID único de componente conexo ----
  // ee.Kernel.plus(1): conectividad de 4 vecinos (cruz), no diagonal.
  // maxSize 1001 es un límite de seguridad del
  // algoritmo (debe ser ≥ el tamaño máximo esperado de fragmento, aquí 1000 ha).
  var naturalFragments_menor1000ha_ano = con_menor_1000ha_ano
    .connectedComponents({ connectedness: ee.Kernel.plus(1), maxSize: 1001 });

  // ---- Acumular bandas multi-año ----
  var dist1000_b = distanceTonatural_maior1000ha_ano.rename('dist' + year_j);
  var dist500_b  = distanceTonatural_maior500ha_ano.rename('dist' + year_j);
  var dist100_b  = distanceTonatural_maior100ha_ano.rename('dist' + year_j);
  var frag_lbl_b = naturalFragments_menor1000ha_ano.select('labels').rename('frag' + year_j);
  var mask1000_b = natural_mask_maior1000ha_ano.rename('frag' + year_j);
  var mask500_b  = natural_mask_maior500ha_ano.rename('frag' + year_j);
  var mask100_b  = natural_mask_maior100ha_ano.rename('frag' + year_j);

  // ee.Image([]) (banda vacía) + addBands() funciona igual en la primera
  // iteración que en las siguientes — no hace falta un caso especial para
  // el primer año.
  distanceTonatural_maior1000ha = distanceTonatural_maior1000ha.addBands(dist1000_b);
  distanceTonatural_maior500ha  = distanceTonatural_maior500ha.addBands(dist500_b);
  distanceTonatural_maior100ha  = distanceTonatural_maior100ha.addBands(dist100_b);
  naturalFragments_menor1000ha  = naturalFragments_menor1000ha.addBands(frag_lbl_b);
  natural_mask_maior1000ha      = natural_mask_maior1000ha.addBands(mask1000_b);
  natural_mask_maior500ha       = natural_mask_maior500ha.addBands(mask500_b);
  natural_mask_maior100ha       = natural_mask_maior100ha.addBands(mask100_b);

});

print('distanceTonatural_maior1000ha:', distanceTonatural_maior1000ha);

// ============================================================
// EXPORTACIÓN
// ============================================================

var suffix = '85_24_col' + collectionId + '_v' + version;

Export.image.toAsset({
  image: distanceTonatural_maior1000ha.toInt16(),
  description: 'distanceToNatural_maior1000ha_' + suffix,
  assetId: PROCESS_ROOT + '05_isolation/distanceToNatural_maior1000ha_' + suffix,
  region: colombia, scale: 100, pyramidingPolicy: { '.default': 'mode' },
  maxPixels: 1e13, priority: 999
});

Export.image.toAsset({
  image: distanceTonatural_maior500ha.toInt16(),
  description: 'distanceToNatural_maior500ha_' + suffix,
  assetId: PROCESS_ROOT + '05_isolation/distanceToNatural_maior500ha_' + suffix,
  region: colombia, scale: 100, pyramidingPolicy: { '.default': 'mode' },
  maxPixels: 1e13, priority: 999
});

Export.image.toAsset({
  image: distanceTonatural_maior100ha.toInt16(),
  description: 'distanceToNatural_maior100ha_' + suffix,
  assetId: PROCESS_ROOT + '05_isolation/distanceToNatural_maior100ha_' + suffix,
  region: colombia, scale: 100, pyramidingPolicy: { '.default': 'mode' },
  maxPixels: 1e13, priority: 999
});

Export.image.toAsset({
  image: naturalFragments_menor1000ha,
  description: 'naturalFragments_menor1000ha_' + suffix,
  assetId: PROCESS_ROOT + '05_isolation/naturalFragments_menor1000ha_' + suffix,
  region: colombia, scale: 100, pyramidingPolicy: { '.default': 'mode' },
  maxPixels: 1e13, priority: 999
});

Export.image.toAsset({
  image: natural_mask_maior1000ha.toInt16(),
  description: 'natural_mask_maior1000ha_' + suffix,
  assetId: PROCESS_ROOT + '05_isolation/natural_mask_maior1000ha_' + suffix,
  region: colombia, scale: 100, pyramidingPolicy: { '.default': 'mode' },
  maxPixels: 1e13, priority: 999
});

Export.image.toAsset({
  image: natural_mask_maior500ha.toInt16(),
  description: 'natural_mask_maior500ha_' + suffix,
  assetId: PROCESS_ROOT + '05_isolation/natural_mask_maior500ha_' + suffix,
  region: colombia, scale: 100, pyramidingPolicy: { '.default': 'mode' },
  maxPixels: 1e13, priority: 999
});

Export.image.toAsset({
  image: natural_mask_maior100ha.toInt16(),
  description: 'natural_mask_maior100ha_' + suffix,
  assetId: PROCESS_ROOT + '05_isolation/natural_mask_maior100ha_' + suffix,
  region: colombia, scale: 100, pyramidingPolicy: { '.default': 'mode' },
  maxPixels: 1e13, priority: 999
});
