/****
 * Nombre: 02A_utils_nativeMask.js
 * Descripción: Genera la máscara binaria de vegetación nativa para Colombia,
 *              combinando todas las regiones biogeográficas en un único asset.
 *              La máscara incluye tanto las clases de vegetación nativa como las
 *              clases ignoradas (agua, afloramientos rocosos, etc.) que no
 *              fragmentan la vegetación. Se utiliza como insumo para el cálculo
 *              de métricas de paisaje (LSMetrics) en los pasos posteriores
 *              de fragmentación (patch size, morphology, isolation).
 *              Utiliza la colección 3 de MapBiomas Colombia.
 *
 * Entradas (GEE):
 *   LULC: projects/mapbiomas-colombia/assets/LULC/COLECCION3/INTEGRACION/COLOMBIA-1
 *
 * Salidas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/native_mask/nativeMask_col3_v1
 *     → ee.Image multi-banda: classification_YYYY (binario 1/0)
 *
 * Autor original: dhemerson.costa@ipam.org.br / mrosa@arcplan.com.br
 * Adaptación Colombia: mapbiomas-colombia
 * Fecha: 2026-05
****/

// ============================================================
// PARÁMETROS GENERALES
// ============================================================

var params = {
  collectionId: 3,  // Colección de MapBiomas Colombia
  version: 1,       // Versión del output

  // Clases de vegetación nativa por región
  // 3 (bosque), 5 (manglar), 6 (bosque inundable), 11 (humedal), 12 (pastizal), 49, 50
  native_classes: {
    'Amazonia':         [3, 5, 6, 49, 11, 50],
    'Andes':            [3, 5, 6, 49, 11, 50],
    'Caribe':           [3, 5, 6, 49, 11, 50],
    'Caribe Insular':   [3, 5, 6, 49, 11, 50],
    'Orinoquia':        [3, 5, 6, 49, 11, 12, 50],
    'Pacifico':         [3, 5, 6, 49, 11, 50],
    'Pacifico insular': [3, 5, 6, 49, 11, 50]
  },

  // Clases ignoradas: no fragmentan la vegetación nativa
  // 13 (otras no forestales), 29 (afloramiento rocoso), 32 (planicie salina), 33 (agua)
  ignore_classes: {
    'Amazonia':         [13, 29, 32, 33],
    'Andes':            [13, 29, 32, 33],
    'Caribe':           [13, 29, 32, 33],
    'Caribe Insular':   [13, 29, 32, 33],
    'Orinoquia':        [13, 29, 32, 33],
    'Pacifico':         [13, 29, 32, 33],
    'Pacifico insular': [13, 29, 32, 33]
  }
};

// ============================================================
// CONFIGURACIÓN DE VARIABLES
// ============================================================

var collectionId   = params.collectionId;
var version        = params.version;
var native_classes = params.native_classes;
var ignore_classes = params.ignore_classes;

// Años a procesar (1985–1999 disponibles si se activa la colección completa)
var years_list = [
  // 1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995,
  // 1996, 1997, 1998, 1999,
  2000, 2001, 2002, 2003, 2004, 2005, 2006,
  2007, 2008, 2009, 2010, 2011, 2012, 2013,
  2014, 2015, 2016, 2017, 2018, 2019, 2020,
  2021, 2022, 2023, 2024
];

// Códigos numéricos de cada región (id_bioma en el vector)
var regiones_codigo = {
  'Amazonia':         1,
  'Andes':            2,
  'Caribe':           3,
  'Caribe Insular':   4,
  'Orinoquia':        5,
  'Pacifico':         6,
  'Pacifico insular': 7
};

var regiones_name = Object.keys(regiones_codigo);

// ============================================================
// CARGA DE VECTORES Y RASTER DE REGIONES
// ============================================================

var pathRegion = 'projects/mapbiomas-colombia/assets/DATOS_AUXILIARES/VECTORES/CAPAS_AREAS/regiones_class_macro';

var regiones_class = ee.FeatureCollection(pathRegion);

// Geometría de Colombia completa (todas las regiones)
var assetCountry = 'users/mapbiomas_andessur/2024/Lim_Colombia';

var colombia = ee.FeatureCollection(assetCountry)
                    .geometry().bounds();

// Convertir vector de regiones a raster (id_bioma como valor de píxel)
var regionesRaster = regiones_class.reduceToImage({
  properties: ['id_bioma'],
  reducer: ee.Reducer.first()
});

// ============================================================
// PROCESAMIENTO POR AÑO
// ============================================================

var recipe = ee.Image([]);

years_list.forEach(function(year_j) {

  var recipe_year = ee.Image(0);

  // Cargar clasificación de cobertura del año
  var collection = ee.Image('projects/mapbiomas-colombia/assets/LULC/COLECCION3/INTEGRACION/COLOMBIA-1')
    .select('classification_' + year_j);

  // Para cada región, generar máscara de vegetación nativa + clases ignoradas
  regiones_name.forEach(function(region_k) {

    // Remap: clases nativas + ignoradas → 1, resto → 0; restringir a la región
    var native_mask = collection
      .remap({
        from: native_classes[region_k].concat(ignore_classes[region_k]),
        to: ee.List.repeat(
              1,
              ee.List(native_classes[region_k].concat(ignore_classes[region_k])).length()
            ),
        defaultValue: 0
      })
      .updateMask(regionesRaster.eq(regiones_codigo[region_k]))
      .selfMask();

    // Acumular región en la imagen del año
    recipe_year = recipe_year.blend(native_mask).selfMask();
  });

  recipe_year = recipe_year.rename('classification_' + year_j);
  recipe = recipe.addBands(recipe_year);

});

// ============================================================
// VISUALIZACIÓN
// ============================================================

print('Máscara nativa Colombia:', recipe);
Map.addLayer(regiones_class, {}, 'Regiones', false);
Map.addLayer(recipe.select('classification_2000').randomVisualizer(), {}, '2000');
Map.addLayer(recipe.select('classification_2024').randomVisualizer(), {}, '2024');

// ============================================================
// EXPORTACIÓN
// ============================================================

Export.image.toAsset({
  image: recipe,
  description: 'nativeMask_col' + collectionId + '_v' + version,
  assetId: 'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/native_mask/' +
           'nativeMask_col' + collectionId + '_v' + version,
  region: colombia,
  scale: 30,
  maxPixels: 1e13,
  priority: 999
});
