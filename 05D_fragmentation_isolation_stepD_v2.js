/****
 * Nombre: 05D_fragmentation_isolation_stepD_v2.js
 * Descripción: Paso D (final) del cálculo de aislamiento de parches.
 *              Para cada año, cruza:
 *                - el tamaño del fragmento PEQUEÑO (≤ 25 / 50 / 100 ha), y
 *                - qué tan lejos está ese fragmento del área fuente más
 *                  cercana (> 5 / 10 / 20 km), y
 *                - el tamaño de esa área fuente (≥ 100 / 500 / 1.000 ha)
 *              en un ÚNICO código categórico (1–10) de aislamiento por
 *              píxel. Produce 3 productos finales — uno por umbral de área
 *              fuente usado como referencia (100 ha, 500 ha, 1.000 ha).
 *
 *
 * Entradas (GEE — de 05C):
 *   05_isolation/natural_mask_maior{1000,500,100}ha_85_24_col{N}_v{V}
 *   05_isolation/distanceToNatural_maior{1000,500,100}ha_85_24_col{N}_v{V}
 *   (también reutiliza natural_mask_100m_col{N}_v{V}_conn de 05B, para volver
 *    a derivar los fragmentos pequeños en los umbrales de 25/50/100 ha)
 *
 * Códigos de salida (banda isolation_YYYY, por producto 100/500/1000ha):
 *   10 = es área fuente (del tamaño de referencia del producto)
 *    1–9 = fragmento pequeño (≤100/50/25 ha) a distintas distancias
 *          (>5/10/20 km) de un área fuente de un tamaño dado — ver la
 *          tabla de .where() más abajo para el detalle exacto por producto
 *
 * Salidas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/degradation_isolation_100ha_col{N}_v{V}
 *   DEGRADACION/.../BETA/PROCESS/degradation_isolation_500ha_col{N}_v{V}
 *   DEGRADACION/.../BETA/PROCESS/degradation_isolation_1000ha_col{N}_v{V}
 *
 *
 * Autor original: dhemerson.costa@ipam.org.br
 * Adaptación Colombia: mapbiomas-colombia
 * Fecha: 2026-07
****/

// ============================================================
// PARÁMETROS GENERALES
// ============================================================

var collectionId = 1;   // versión del producto de degradación (no la colección LULC)
var collectionId_in = 1; // collectionId usado por 05A/05B/05C al nombrar sus assets
var version       = 1;

var PROCESS_ROOT = 'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/';
var suffix_in     = '85_24_col' + collectionId_in + '_v' + version;

var years = [
  '1985', '1986', '1987', '1988', '1989', '1990', '1991', '1992', '1993', '1994',
  '1995', '1996', '1997', '1998', '1999', '2000', '2001', '2002', '2003', '2004',
  '2005', '2006', '2007', '2008', '2009', '2010', '2011', '2012', '2013', '2014',
  '2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024'
];

// ============================================================
// FONDO A ESCALA PAÍS
// ============================================================
// No hay un raster de biomas en Colombia con la estructura necesaria para
// derivar este fondo por remapeo, así que se construye directamente como
// un raster de valor constante recortado al país.

var colombia = ee.FeatureCollection(
  'users/mapbiomas_andessur/2024/Lim_Colombia'
).geometry().bounds();

var colombia_0    = ee.Image(0).clip(colombia);
var colombia_25k  = ee.Image(25001).clip(colombia);   // sentinel "sin dato / muy lejos"

// ============================================================
// CARGA DE INSUMOS (assets ya generados por 05B/05C)
// ============================================================

var nonforMap = ee.Image(
  PROCESS_ROOT + '05_isolation/natural_mask_100m_col' + collectionId_in + '_v' + version + '_conn'
);

var natural_mask_maior1000ha = ee.Image(PROCESS_ROOT + '05_isolation/natural_mask_maior1000ha_' + suffix_in);
var natural_mask_maior500ha  = ee.Image(PROCESS_ROOT + '05_isolation/natural_mask_maior500ha_'  + suffix_in);
var natural_mask_maior100ha  = ee.Image(PROCESS_ROOT + '05_isolation/natural_mask_maior100ha_'  + suffix_in);

var distanceTonatural_maior1000ha = ee.Image(PROCESS_ROOT + '05_isolation/distanceToNatural_maior1000ha_' + suffix_in);
var distanceTonatural_maior500ha  = ee.Image(PROCESS_ROOT + '05_isolation/distanceToNatural_maior500ha_'  + suffix_in);
var distanceTonatural_maior100ha  = ee.Image(PROCESS_ROOT + '05_isolation/distanceToNatural_maior100ha_'  + suffix_in);

// ============================================================
// PROCESAMIENTO POR AÑO
// ============================================================
// `for` clásico, no forEach(): las variables acumuladoras deben persistir
// entre iteraciones, y forEach() las encerraría en el scope de su callback.

for (var i_year = 0; i_year < years.length; i_year++) {
  var year = years[i_year];

  var natural_mask_maior1000ha_ano = natural_mask_maior1000ha.select('frag' + year);
  var natural_mask_maior500ha_ano  = natural_mask_maior500ha.select('frag' + year);
  var natural_mask_maior100ha_ano  = natural_mask_maior100ha.select('frag' + year);

  // Rellena píxeles sin dato con "muy lejos" (25.001 m) para que los
  // umbrales gt() de más abajo se comporten de forma predecible.
  var distanceTonatural_maior1000ha_ano = colombia_25k.blend(distanceTonatural_maior1000ha.select('dist' + year));
  var distanceTonatural_maior500ha_ano  = colombia_25k.blend(distanceTonatural_maior500ha.select('dist' + year));
  var distanceTonatural_maior100ha_ano  = colombia_25k.blend(distanceTonatural_maior100ha.select('dist' + year));

  // ---- Fragmentos pequeños re-derivados en los umbrales 25/50/100 ha ----
  var nonfor_25ha_ano  = nonforMap.select('conect_' + year).lte(25).remap([1], [1]);
  var nonfor_50ha_ano  = nonforMap.select('conect_' + year).lte(50).remap([1], [1]);
  var nonfor_100ha_ano = nonforMap.select('conect_' + year).lte(100).remap([1], [1]);

  var frag25  = colombia_0.blend(nonfor_25ha_ano).selfMask();
  var frag50  = colombia_0.blend(nonfor_50ha_ano).selfMask();
  var frag100 = colombia_0.blend(nonfor_100ha_ano).selfMask();

  var frag25_comp  = frag25.connectedComponents({ connectedness: ee.Kernel.plus(1), maxSize: 550 });
  var frag50_comp  = frag50.connectedComponents({ connectedness: ee.Kernel.plus(1), maxSize: 550 });
  var frag100_comp = frag100.connectedComponents({ connectedness: ee.Kernel.plus(1), maxSize: 550 });

  // ---- Distancia mínima de cada fragmento pequeño a cada nivel de área fuente ----
  // reduceConnectedComponents(min) agrupa por 'labels' y toma la distancia
  // mínima dentro de cada fragmento.

  var dist_frag25_1000 = distanceTonatural_maior1000ha_ano.rename('distance')
    .mask(frag25_comp.select('labels').gt(0)).addBands(frag25_comp.select('labels'));
  var dist_frag25_500 = distanceTonatural_maior500ha_ano.rename('distance')
    .mask(frag25_comp.select('labels').gt(0)).addBands(frag25_comp.select('labels'));
  var dist_frag25_100 = distanceTonatural_maior100ha_ano.rename('distance')
    .mask(frag25_comp.select('labels').gt(0)).addBands(frag25_comp.select('labels'));
  var frag25_dist_1000_ano = dist_frag25_1000.reduceConnectedComponents(ee.Reducer.min(), 'labels', 256).rename('min_dist_1000_' + year);
  var frag25_dist_500__ano = dist_frag25_500.reduceConnectedComponents(ee.Reducer.min(), 'labels', 256).rename('min_dist_500_' + year);
  var frag25_dist_100__ano = dist_frag25_100.reduceConnectedComponents(ee.Reducer.min(), 'labels', 256).rename('min_dist_100_' + year);

  var dist_frag50_1000 = distanceTonatural_maior1000ha_ano.rename('distance')
    .mask(frag50_comp.select('labels').gt(0)).addBands(frag50_comp.select('labels'));
  var dist_frag50_500 = distanceTonatural_maior500ha_ano.rename('distance')
    .mask(frag50_comp.select('labels').gt(0)).addBands(frag50_comp.select('labels'));
  var dist_frag50_100 = distanceTonatural_maior100ha_ano.rename('distance')
    .mask(frag50_comp.select('labels').gt(0)).addBands(frag50_comp.select('labels'));
  var frag50_dist_1000_ano = dist_frag50_1000.reduceConnectedComponents(ee.Reducer.min(), 'labels', 256).rename('min_dist_1000_' + year);
  var frag50_dist_500__ano = dist_frag50_500.reduceConnectedComponents(ee.Reducer.min(), 'labels', 256).rename('min_dist_500_' + year);
  var frag50_dist_100__ano = dist_frag50_100.reduceConnectedComponents(ee.Reducer.min(), 'labels', 256).rename('min_dist_100_' + year);

  var dist_frag100_1000 = distanceTonatural_maior1000ha_ano.rename('distance')
    .mask(frag100_comp.select('labels').gt(0)).addBands(frag100_comp.select('labels'));
  var dist_frag100_500 = distanceTonatural_maior500ha_ano.rename('distance')
    .mask(frag100_comp.select('labels').gt(0)).addBands(frag100_comp.select('labels'));
  // (frag100 × distancia-a-fuente-100ha se omite: comparar un fragmento
  // ≤100ha contra fuentes de ≥100ha es poco informativo)
  var frag100_dist_1000_ano = dist_frag100_1000.reduceConnectedComponents(ee.Reducer.min(), 'labels', 256).rename('min_dist_1000_' + year);
  var frag100_dist_500__ano = dist_frag100_500.reduceConnectedComponents(ee.Reducer.min(), 'labels', 256).rename('min_dist_500_' + year);

  // ---- Bins de distancia (> 5 / 10 / 20 km) por combinación fragmento×fuente ----
  var frag25_dist05_1000_ano = frag25_dist_1000_ano.gt(5000).remap([1], [1]).rename('frag_' + year);
  var frag25_dist10_1000_ano = frag25_dist_1000_ano.gt(10000).remap([1], [1]).rename('frag_' + year);
  var frag25_dist20_1000_ano = frag25_dist_1000_ano.gt(20000).remap([1], [1]).rename('frag_' + year);
  var frag25_dist05_500__ano = frag25_dist_500__ano.gt(5000).remap([1], [1]).rename('frag_' + year);
  var frag25_dist10_500__ano = frag25_dist_500__ano.gt(10000).remap([1], [1]).rename('frag_' + year);
  var frag25_dist20_500__ano = frag25_dist_500__ano.gt(20000).remap([1], [1]).rename('frag_' + year);
  var frag25_dist05_100__ano = frag25_dist_100__ano.gt(5000).remap([1], [1]).rename('frag_' + year);
  var frag25_dist10_100__ano = frag25_dist_100__ano.gt(10000).remap([1], [1]).rename('frag_' + year);
  var frag25_dist20_100__ano = frag25_dist_100__ano.gt(20000).remap([1], [1]).rename('frag_' + year);

  var frag50_dist05_1000_ano = frag50_dist_1000_ano.gt(5000).remap([1], [1]).rename('frag_' + year);
  var frag50_dist10_1000_ano = frag50_dist_1000_ano.gt(10000).remap([1], [1]).rename('frag_' + year);
  var frag50_dist20_1000_ano = frag50_dist_1000_ano.gt(20000).remap([1], [1]).rename('frag_' + year);
  var frag50_dist05_500__ano = frag50_dist_500__ano.gt(5000).remap([1], [1]).rename('frag_' + year);
  var frag50_dist10_500__ano = frag50_dist_500__ano.gt(10000).remap([1], [1]).rename('frag_' + year);
  var frag50_dist20_500__ano = frag50_dist_500__ano.gt(20000).remap([1], [1]).rename('frag_' + year);
  var frag50_dist05_100__ano = frag50_dist_100__ano.gt(5000).remap([1], [1]).rename('frag_' + year);
  var frag50_dist10_100__ano = frag50_dist_100__ano.gt(10000).remap([1], [1]).rename('frag_' + year);
  var frag50_dist20_100__ano = frag50_dist_100__ano.gt(20000).remap([1], [1]).rename('frag_' + year);

  var frag100_dist05_1000_ano = frag100_dist_1000_ano.gt(5000).remap([1], [1]).rename('frag_' + year);
  var frag100_dist10_1000_ano = frag100_dist_1000_ano.gt(10000).remap([1], [1]).rename('frag_' + year);
  var frag100_dist20_1000_ano = frag100_dist_1000_ano.gt(20000).remap([1], [1]).rename('frag_' + year);
  var frag100_dist05_500__ano = frag100_dist_500__ano.gt(5000).remap([1], [1]).rename('frag_' + year);
  var frag100_dist10_500__ano = frag100_dist_500__ano.gt(10000).remap([1], [1]).rename('frag_' + year);
  var frag100_dist20_500__ano = frag100_dist_500__ano.gt(20000).remap([1], [1]).rename('frag_' + year);

  // ---- Acumular bandas multi-año ----
  if (i_year === 0) {
    var frag25_dist05k_1000 = frag25_dist05_1000_ano;
    var frag25_dist10k_1000 = frag25_dist10_1000_ano;
    var frag25_dist20k_1000 = frag25_dist20_1000_ano;
    var frag25_dist05k_500  = frag25_dist05_500__ano;
    var frag25_dist10k_500  = frag25_dist10_500__ano;
    var frag25_dist20k_500  = frag25_dist20_500__ano;
    var frag25_dist05k_100  = frag25_dist05_100__ano;
    var frag25_dist10k_100  = frag25_dist10_100__ano;
    var frag25_dist20k_100  = frag25_dist20_100__ano;

    var frag50_dist05k_1000 = frag50_dist05_1000_ano;
    var frag50_dist10k_1000 = frag50_dist10_1000_ano;
    var frag50_dist20k_1000 = frag50_dist20_1000_ano;
    var frag50_dist05k_500  = frag50_dist05_500__ano;
    var frag50_dist10k_500  = frag50_dist10_500__ano;
    var frag50_dist20k_500  = frag50_dist20_500__ano;
    var frag50_dist05k_100  = frag50_dist05_100__ano;
    var frag50_dist10k_100  = frag50_dist10_100__ano;
    var frag50_dist20k_100  = frag50_dist20_100__ano;

    var frag100_dist05k_1000 = frag100_dist05_1000_ano;
    var frag100_dist10k_1000 = frag100_dist10_1000_ano;
    var frag100_dist20k_1000 = frag100_dist20_1000_ano;
    var frag100_dist05k_500  = frag100_dist05_500__ano;
    var frag100_dist10k_500  = frag100_dist10_500__ano;
    var frag100_dist20k_500  = frag100_dist20_500__ano;

  } else {
    frag25_dist05k_1000 = frag25_dist05k_1000.addBands(frag25_dist05_1000_ano);
    frag25_dist10k_1000 = frag25_dist10k_1000.addBands(frag25_dist10_1000_ano);
    frag25_dist20k_1000 = frag25_dist20k_1000.addBands(frag25_dist20_1000_ano);
    frag25_dist05k_500  = frag25_dist05k_500.addBands(frag25_dist05_500__ano);
    frag25_dist10k_500  = frag25_dist10k_500.addBands(frag25_dist10_500__ano);
    frag25_dist20k_500  = frag25_dist20k_500.addBands(frag25_dist20_500__ano);
    frag25_dist05k_100  = frag25_dist05k_100.addBands(frag25_dist05_100__ano);
    frag25_dist10k_100  = frag25_dist10k_100.addBands(frag25_dist10_100__ano);
    frag25_dist20k_100  = frag25_dist20k_100.addBands(frag25_dist20_100__ano);

    frag50_dist05k_1000 = frag50_dist05k_1000.addBands(frag50_dist05_1000_ano);
    frag50_dist10k_1000 = frag50_dist10k_1000.addBands(frag50_dist10_1000_ano);
    frag50_dist20k_1000 = frag50_dist20k_1000.addBands(frag50_dist20_1000_ano);
    frag50_dist05k_500  = frag50_dist05k_500.addBands(frag50_dist05_500__ano);
    frag50_dist10k_500  = frag50_dist10k_500.addBands(frag50_dist10_500__ano);
    frag50_dist20k_500  = frag50_dist20k_500.addBands(frag50_dist20_500__ano);
    frag50_dist05k_100  = frag50_dist05k_100.addBands(frag50_dist05_100__ano);
    frag50_dist10k_100  = frag50_dist10k_100.addBands(frag50_dist10_100__ano);
    frag50_dist20k_100  = frag50_dist20k_100.addBands(frag50_dist20_100__ano);

    frag100_dist05k_1000 = frag100_dist05k_1000.addBands(frag100_dist05_1000_ano);
    frag100_dist10k_1000 = frag100_dist10k_1000.addBands(frag100_dist10_1000_ano);
    frag100_dist20k_1000 = frag100_dist20k_1000.addBands(frag100_dist20_1000_ano);
    frag100_dist05k_500  = frag100_dist05k_500.addBands(frag100_dist05_500__ano);
    frag100_dist10k_500  = frag100_dist10k_500.addBands(frag100_dist10_500__ano);
    frag100_dist20k_500  = frag100_dist20k_500.addBands(frag100_dist20_500__ano);
  }
}

// ============================================================
// CÓDIGO CATEGÓRICO FINAL (1–10) POR PRODUCTO DE REFERENCIA
// ============================================================

var newBands = natural_mask_maior100ha.bandNames().map(function (band) {
  return ee.String('isolation_').cat(ee.String(band).slice(-4));
});

// ---- Producto: referencia = área fuente ≥ 100 ha ----
var distances100ha = natural_mask_maior100ha.unmask(0).multiply(0)
  .where(natural_mask_maior100ha, 10)      // área fuente 100–500 ha
  .where(frag50_dist05k_100, 2)            // fragmento ≤50 ha, > 5 km de una fuente
  .where(frag25_dist05k_100, 3)            // fragmento ≤25 ha, > 5 km de una fuente
  .where(frag50_dist10k_100, 5)            // fragmento ≤50 ha, > 10 km
  .where(frag25_dist10k_100, 6)            // fragmento ≤25 ha, > 10 km
  .where(frag50_dist20k_100, 8)            // fragmento ≤50 ha, > 20 km
  .where(frag25_dist20k_100, 9)            // fragmento ≤25 ha, > 20 km
  .rename(newBands)
  .selfMask();

// ---- Producto: referencia = área fuente ≥ 500 ha ----
var distances500ha = natural_mask_maior500ha.unmask(0).multiply(0)
  .where(natural_mask_maior500ha, 10)      // área fuente 500–1.000 ha
  .where(frag100_dist05k_500, 1)           // fragmento ≤100 ha, > 5 km
  .where(frag50_dist05k_500, 2)            // fragmento ≤50 ha, > 5 km
  .where(frag25_dist05k_500, 3)            // fragmento ≤25 ha, > 5 km
  .where(frag100_dist10k_500, 4)           // fragmento ≤100 ha, > 10 km
  .where(frag50_dist10k_500, 5)            // fragmento ≤50 ha, > 10 km
  .where(frag25_dist10k_500, 6)            // fragmento ≤25 ha, > 10 km
  .where(frag50_dist20k_500, 8)            // fragmento ≤50 ha, > 20 km
  .where(frag25_dist20k_500, 9)            // fragmento ≤25 ha, > 20 km
  .rename(newBands)
  .selfMask();

// ---- Producto: referencia = área fuente ≥ 1.000 ha ----
var distances1000ha = natural_mask_maior1000ha.unmask(0).multiply(0)
  .where(natural_mask_maior1000ha, 10)     // área fuente ≥ 1.000 ha
  .where(frag100_dist05k_1000, 1)          // fragmento ≤100 ha, > 5 km
  .where(frag50_dist05k_1000, 2)           // fragmento ≤50 ha, > 5 km
  .where(frag25_dist05k_1000, 3)           // fragmento ≤25 ha, > 5 km
  .where(frag100_dist10k_1000, 4)          // fragmento ≤100 ha, > 10 km
  .where(frag50_dist10k_1000, 5)           // fragmento ≤50 ha, > 10 km
  .where(frag25_dist10k_1000, 6)           // fragmento ≤25 ha, > 10 km
  .where(frag100_dist20k_1000, 7)          // fragmento ≤100 ha, > 20 km
  .where(frag50_dist20k_1000, 8)           // fragmento ≤50 ha, > 20 km
  .where(frag25_dist20k_1000, 9)           // fragmento ≤25 ha, > 20 km
  .rename(newBands)
  .selfMask();

print('distances1000ha:', distances1000ha);
Map.addLayer(distances1000ha.select(0).randomVisualizer(), {}, 'distances1000ha (banda 0)', false);

// ============================================================
// EXPORTACIÓN
// ============================================================

Export.image.toAsset({
  image: distances100ha.toInt16(),
  description: 'degradation_isolation_100ha_col' + collectionId + '_v' + version,
  assetId: PROCESS_ROOT + 'degradation_isolation_100ha_col' + collectionId + '_v' + version,
  region: colombia, scale: 100, pyramidingPolicy: { '.default': 'mode' },
  maxPixels: 1e13, priority: 999
});

Export.image.toAsset({
  image: distances500ha.toInt16(),
  description: 'degradation_isolation_500ha_col' + collectionId + '_v' + version,
  assetId: PROCESS_ROOT + 'degradation_isolation_500ha_col' + collectionId + '_v' + version,
  region: colombia, scale: 100, pyramidingPolicy: { '.default': 'mode' },
  maxPixels: 1e13, priority: 999
});

Export.image.toAsset({
  image: distances1000ha.toInt16(),
  description: 'degradation_isolation_1000ha_col' + collectionId + '_v' + version,
  assetId: PROCESS_ROOT + 'degradation_isolation_1000ha_col' + collectionId + '_v' + version,
  region: colombia, scale: 100, pyramidingPolicy: { '.default': 'mode' },
  maxPixels: 1e13, priority: 999
});
