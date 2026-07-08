/****
 * Nombre: 03C_patchID_patchSize_formatAsset.js
 * Descripción: Consolida las ImageCollections de IDs y áreas de parches
 *              (ingestadas en GEE por 03B) en dos assets multi-banda finales,
 *              uno por tipo de dato. Cada banda corresponde a un año.
 *
 * Entradas (GEE — ingestadas por 03B):
 *   DEGRADACION/.../BETA/PROCESS/03_patch-id/       → fragment_id_YYYY
 *   DEGRADACION/.../BETA/PROCESS/03_patch-size-all/ → fragment_area_YYYY
 *
 * Salidas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/degradation_patch_id_col{N}_v{V}
 *     → ee.Image multi-banda: id_1985 … id_2024 (int32)
 *   DEGRADACION/.../BETA/PROCESS/degradation_patch_size_col{N}_v{V}
 *     → ee.Image multi-banda: size_1985 … size_2024 (int32, hectáreas)
 *
 * Autor original: dhemerson.costa@ipam.org.br
 * Adaptación Colombia: mapbiomas-colombia
 * Fecha: 2026-07
 ****/

// ============================================================
// PARÁMETROS
// ============================================================

var collectionId = 1;
var version      = 1;

// ============================================================
// CARGA DE COLECCIONES
// ============================================================

var paths_directory = require('users/kahuertas/mapbiomas-colombia:mapbiomas-colombia/collection-4/modules/CollectionDirectories.js').paths;
var paths_functions = require('users/kahuertas/mapbiomas-colombia:mapbiomas-colombia/collection-4/modules/CollectionFunctions.js');
var palette_lulc    = require('users/kahuertas/mapbiomas-colombia:mapbiomas-colombia/collection-4/modules/Palettes.js').get('colombiaCol4');

var classificationCol3 = ee.Image(paths_directory.integrate_col3);
var mosaics            = paths_functions.getMosaic();

var native_mask = ee.ImageCollection(
  'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/02_native_mask'
).mosaic();

var patchID = ee.ImageCollection(
  'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/03_patch-id'
).toBands();

var patchSize = ee.ImageCollection(
  'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/03_patch-size-all'
).toBands();

print('patchID   — bandas disponibles:', patchID.bandNames());
print('patchSize — bandas disponibles:', patchSize.bandNames());

// ============================================================
// AÑOS A PROCESAR
// ============================================================

var years_list = [
  1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995,
  1996, 1997, 1998, 1999,
  2000, 2001, 2002, 2003, 2004, 2005, 2006,
  2007, 2008, 2009, 2010, 2011, 2012, 2013,
  2014, 2015, 2016, 2017, 2018, 2019, 2020,
  2021, 2022, 2023, 2024
];

// ============================================================
// CONSOLIDACIÓN AÑO A AÑO
// ============================================================

var recipeID   = ee.Image([]);
var recipeSize = ee.Image([]);

years_list.forEach(function(year_i) {

  recipeID = recipeID.addBands(
    patchID.select('fragment_id_' + year_i + '_b1')
      .rename('id_' + year_i)
      .selfMask()
      .round()
  );

  recipeSize = recipeSize.addBands(
    patchSize.select('fragment_area_' + year_i + '_b1')
      .rename('size_' + year_i)
      .selfMask()
      .round()
  );

});

recipeID   = recipeID.int32();
recipeSize = recipeSize.int32();

print('Patch ID   — bandas finales:', recipeID.bandNames());
print('Patch Size — bandas finales:', recipeSize.bandNames());

// ============================================================
// VISUALIZACIÓN  (un panel — dropdown por año)
// ============================================================

var landsat_vis = {
  bands: ['swir1_median', 'nir_median', 'red_median'],
  gain:  [0.08, 0.06, 0.2]
};

var patchSize_classes = [
  { label: '≤ 5 ha',       color: '#8b2a2e' },
  { label: '≤ 10 ha',      color: '#af4122' },
  { label: '≤ 25 ha',      color: '#d35e0e' },
  { label: '≤ 50 ha',      color: '#f0a900' },
  { label: '≤ 100 ha',     color: '#f9d800' },
  { label: '≤ 250 ha',     color: '#fff176' },
  { label: '≤ 500 ha',     color: '#b0d900' },
  { label: '≤ 1 000 ha',   color: '#86d017' },
  { label: '≤ 5 000 ha',   color: '#5dc734' },
  { label: '≤ 10 000 ha',  color: '#39bc68' },
  { label: '> 10 000 ha',  color: '#efefef' }
];

var patchSize_vis = {
  min: 1, max: 11,
  palette: patchSize_classes.map(function(c) { return c.color; })
};

// Reclasifica tamaño continuo (ha) en 11 clases discretas
function classifyPatchSize(img) {
  var out = ee.Image(11);                              // clase 11 por defecto
  out = out.where(img.lte(5),                                          1);
  out = out.where(img.gt(5).and(img.lte(10)),                          2);
  out = out.where(img.gt(10).and(img.lte(25)),                         3);
  out = out.where(img.gt(25).and(img.lte(50)),                         4);
  out = out.where(img.gt(50).and(img.lte(100)),                        5);
  out = out.where(img.gt(100).and(img.lte(250)),                       6);
  out = out.where(img.gt(250).and(img.lte(500)),                       7);
  out = out.where(img.gt(500).and(img.lte(1000)),                      8);
  out = out.where(img.gt(1000).and(img.lte(5000)),                     9);
  out = out.where(img.gt(5000).and(img.lte(10000)),                   10);
  return out.updateMask(img.mask());
}

function updateMap(yearStr) {
  Map.layers().reset();
  var year      = parseInt(yearStr, 10);
  var classBand = 'classification_' + yearStr;

  // Mosaico Landsat del año
  var landsatMosaic = mosaics.filter(ee.Filter.eq('year', year)).mosaic();
  Map.addLayer(landsatMosaic, landsat_vis, 'Mosaico Landsat ' + yearStr, false);

  // Integrado (clasificación de cobertura)
  Map.addLayer(
    classificationCol3.select(classBand),
    { min: 0, max: palette_lulc.length - 1, palette: palette_lulc },
    'Integrado ' + yearStr,
    false
  );

  // Máscara de vegetación nativa
  var native_mask_yr = native_mask.select(classBand);
  Map.addLayer(native_mask_yr, { palette: ['445D07'] }, 'Máscara natural ' + yearStr, false);

  // Patch ID enmascarado con vegetación nativa
  var patchId_yr = recipeID.select('id_' + year).updateMask(native_mask_yr);
  Map.addLayer(patchId_yr.randomVisualizer(), {}, 'Patch ID ' + yearStr, false);

  // Patch Size reclasificado (11 clases) y enmascarado
  var patchSize_yr = recipeSize.select('size_' + year).updateMask(native_mask_yr);
  Map.addLayer(classifyPatchSize(patchSize_yr), patchSize_vis, 'Patch Size (ha) ' + yearStr, true);
}

// -- Leyenda Patch Size --
var legend = ui.Panel({
  style: {
    position:        'bottom-left',
    padding:         '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.9)',
    border:          '1px solid #ccc'
  }
});

legend.add(ui.Label('Tamaño de parche (ha)', {
  fontWeight: 'bold',
  fontSize:   '13px',
  margin:     '0 0 4px 0'
}));

patchSize_classes.forEach(function(cls) {
  legend.add(ui.Panel(
    [
      ui.Label('', { backgroundColor: cls.color, padding: '8px', margin: '0 8px 2px 0' }),
      ui.Label(cls.label, { margin: '2px 0', fontSize: '12px' })
    ],
    ui.Panel.Layout.Flow('horizontal')
  ));
});

// -- Dropdown de año --
var availableYears = [];
for (var y = 1985; y <= 2024; y++) availableYears.push(y.toString());

var selectYear = ui.Select({
  items:       availableYears,
  placeholder: 'Seleccione un año…',
  onChange:    updateMap,
  style:       { position: 'top-left', width: '160px' }
});

Map.setOptions('SATELLITE');
Map.add(selectYear);
Map.add(legend);

// Render inicial
selectYear.setValue('1985');

// ============================================================
// EXPORTACIÓN
// ============================================================

// .bounds() reduce la geometría a un rectángulo simple y evita el error
// "Request payload size exceeds the limit" que ocurre con geometrías complejas.
var colombia = ee.FeatureCollection(
  'projects/mapbiomas-colombia/assets/DATOS_AUXILIARES/VECTORES/CAPAS_AREAS/regiones_class_macro'
).geometry().bounds();

Export.image.toAsset({
  image:       recipeID,
  description: 'degradation_patch_id_col' + collectionId + '_v' + version,
  assetId:     'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/' +
               'degradation_patch_id_col' + collectionId + '_v' + version,
  region:      colombia,
  scale:       30,
  maxPixels:   1e13,
  priority:    999
});

Export.image.toAsset({
  image:       recipeSize,
  description: 'degradation_patch_size_col' + collectionId + '_v' + version,
  assetId:     'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/' +
               'degradation_patch_size_col' + collectionId + '_v' + version,
  region:      colombia,
  scale:       30,
  maxPixels:   1e13,
  priority:    999
});

// ============================================================
// ANÁLISIS ROI  (opcional — generar nuevos IDs de parche en un área dibujada)
// ============================================================
// Requiere un polígono dibujado manualmente en el mapa llamado 'roi'.

/*
var targetYear = 1985;
var targetBand = 'id_' + targetYear;

var imageInRoi = recipeID.select(targetBand).clip(roi);

var binaryMask = imageInRoi.unmask(0).gt(0);

var newPatchIDs = binaryMask.connectedComponents({
  connectedness: ee.Kernel.square(1),
  maxSize: 1024
});

// Tamaño en píxeles de cada nuevo parche
var pixelCount = newPatchIDs.connectedPixelCount({
  maxSize: 1024,
  eightConnected: true
});

Map.addLayer(roi, { color: 'red' }, 'ROI', false);
Map.addLayer(
  newPatchIDs.select('labels').randomVisualizer(),
  {},
  'Nuevos IDs (al vuelo)'
);
// Map.addLayer(
//   pixelCount,
//   { min: 1, max: 100, palette: ['blue', 'cyan', 'green', 'yellow', 'red'] },
//   'Tamaño nuevos parches',
//   false
// );
*/
