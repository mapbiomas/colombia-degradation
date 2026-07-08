/****
 * Nombre: 04C_morphology_formatAsset.js
 * Descripción: Consolida la ImageCollection de morfología (04B) en un único
 *              asset multi-banda. Cada banda es el mosaico nacional de un año.
 *
 * Entradas (GEE — ingestadas por 04B):
 *   DEGRADACION/.../BETA/PROCESS/04_morphology/  → morphology_YYYY_RRRR por región/año
 *
 * Valores de banda (clases MSPA):
 *   0 = Sin vegetación nativa (fondo)
 *   1 = Núcleo        — interior del parche, lejos del borde
 *   2 = Borde         — píxeles en el margen del parche nativo
 *   3 = Corredor      — franja delgada que conecta dos núcleos
 *   4 = Rama          — apéndice conectado solo por un extremo
 *   5 = Piedra de paso — parche pequeño aislado
 *   6 = Perforación   — borde interno alrededor de un hueco
 *
 * Salidas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/public/degradation_morphology_col{N}_v{V}
 *     → ee.Image multi-banda: morphology_1985 … morphology_2024 (uint8)
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

var morphologyCollection = ee.ImageCollection(
  'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/04_morphology'
);

print('Total de imágenes en colección morfología:', morphologyCollection.size());

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

var recipeMorphology = ee.Image([]);

years_list.forEach(function(year_i) {

  var year_img = morphologyCollection
    .filter(ee.Filter.eq('year', year_i))
    .mosaic()
    .rename('morphology_' + year_i);

  // 0 = fondo, 255 = artefacto de borde entre regiones
  year_img = year_img.updateMask(year_img.neq(0).and(year_img.neq(255)));

  recipeMorphology = recipeMorphology.addBands(year_img);

});

recipeMorphology = recipeMorphology.uint8();

print('Morphology — bandas finales:', recipeMorphology.bandNames());

// ============================================================
// VISUALIZACIÓN  (un panel — dropdown por año)
// ============================================================

var mspa_vis = {
  min: 1, max: 6,
  palette: ['#1A9650', '#99D3B4', '#44AAB1', '#FFC941', '#FFADCE', '#A9DAE6']
};

var landsat_vis = {
  bands: ['swir1_median', 'nir_median', 'red_median'],
  gain:  [0.08, 0.06, 0.2]
};

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

  // Morfología: mosaico de todas las regiones del año
  var morph_yr = morphologyCollection
    .filter(ee.Filter.eq('year', year))
    .mosaic();
  morph_yr = morph_yr.updateMask(morph_yr.neq(0).and(morph_yr.neq(255)));
  Map.addLayer(morph_yr, mspa_vis, 'Morfología integrada ' + yearStr, true);
}

// -- Leyenda MSPA --
var mspa_classes = [
  { label: '1 — Núcleo',          color: '#1A9650' },
  { label: '2 — Borde',           color: '#99D3B4' },
  { label: '3 — Corredor',        color: '#44AAB1' },
  { label: '4 — Rama',            color: '#FFC941' },
  { label: '5 — Piedra de paso',  color: '#FFADCE' },
  { label: '6 — Perforación',     color: '#A9DAE6' }
];

var legend = ui.Panel({
  style: {
    position:        'bottom-left',
    padding:         '8px 12px',
    backgroundColor: 'rgba(255,255,255,0.9)',
    border:          '1px solid #ccc'
  }
});

legend.add(ui.Label('Clases MSPA', {
  fontWeight: 'bold',
  fontSize:   '13px',
  margin:     '0 0 6px 0'
}));

mspa_classes.forEach(function(cls) {
  legend.add(ui.Panel(
    [
      ui.Label('', {
        backgroundColor: cls.color,
        padding:         '8px',
        margin:          '0 8px 2px 0'
      }),
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

var colombia = ee.FeatureCollection(
  'projects/mapbiomas-colombia/assets/DATOS_AUXILIARES/VECTORES/CAPAS_AREAS/regiones_class_macro'
).geometry().bounds();

Export.image.toAsset({
  image:       recipeMorphology,
  description: 'degradation_morphology_col' + collectionId + '_v' + version,
  assetId:     'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/' +
               'degradation_morphology_col' + collectionId + '_v' + version,
  region:      colombia,
  scale:       30,
  maxPixels:   1e13,
  priority:    999
});
