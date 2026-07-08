/****
 * Nombre: 01A_fragmentation_edgeArea_v2.js
 * Descripción: Calcula las áreas de borde (edge area) asociadas al proceso
 *              de fragmentación de coberturas naturales por bioma y año.
 *              Identifica los píxeles localizados en los límites entre
 *              áreas naturales y antrópicas, considerando las clases de
 *              vegetación nativa definidas para cada región biogeográfica.
 *              Utiliza la colección 3 de MapBiomas Colombia como fuente
 *              principal de datos de cobertura.
 *
 * Entradas (GEE):
 *   LULC: projects/mapbiomas-colombia/assets/LULC/COLECCION3/INTEGRACION/COLOMBIA-1
 *   Vector de regiones: paths_directory.regionVectorBuffer (id_regionC)
 *
 * Salidas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/01_edge_area/EDGE-AREA-RRRR-YYYY-V
 *     → ee.Image (int16, distancia en m al límite antrópico más cercano)
 *
 * Autor original: dhemerson.costa@ipam.org.br
 * Adaptación Colombia: mapbiomas-colombia
 * Fecha: 2025-11-06
 * Update-Colombia 2026-06
****/

/// ============================================================
// PARÁMETROS GENERALES
// ============================================================

var params = {
  region: 30471, 
  dist_ecuclidian: 500,
  limit_dist: 550,
  // Clases de vegetación nativa a evaluar
  native_classes: [3, 6, 11, 50],

  // Clases a ignorar (sin generación de efecto de borde)
  ignore_classes: [13, 29, 32, 33],

  // Identificadores de colección
  collectionId: 3,     // Colección de MapBiomas Colombia
  version_edge: 1      // Versión de degradación (efecto de borde)
};

// ============================================================
// CONFIGURACIÓN DE VARIABLES
// ============================================================
var leyendaPanel = require(
'users/kahuertas/mapbiomas-colombia:mapbiomas-colombia/collection-4/utils/leyendaC4'
);
var collectionId = params.collectionId;
var regionSelect = params.region;
var native_classes = ee.List(params.native_classes);
var ignore_classes = ee.List(params.ignore_classes);
var version = params.version_edge;

// Años a procesar
var years_list = [
  // 1985, 1986, 1987, 1988, 1989, 1990,
  1991,
  // 1992, 1993, 1994, 1995, 1996, 1997, 1998,
  // 1999, 2000, 2001, 2002, 2003, 2004, 2005,
  // 2006, 2007, 2008, 2009, 2010, 2011, 2012,
  // 2013, 2014, 2015, 2016, 2017, 2018, 2019,
  // 2020, 2021, 2022, 2023, 2024//, 2025
];

// ============================================================
// CARGA DE DIRECTORIOS Y VECTORES DE REGIONES
// ============================================================
// Paleta de colores para visualización
var palette = require('users/kahuertas/mapbiomas-colombia:mapbiomas-colombia/collection-4/modules/Palettes.js').get('colombiaCol4');
var paths_functions = require('users/kahuertas/mapbiomas-colombia:mapbiomas-colombia/collection-4/modules/CollectionFunctions.js');
var paths_directory = require('users/kahuertas/mapbiomas-colombia:mapbiomas-colombia/collection-4/modules/CollectionDirectories.js').paths;

var getMosaic = paths_functions.getMosaic;
var regiones_ = ee.FeatureCollection(paths_directory.regionVectorBuffer);
var region_filter = regiones_
                      .filter(ee.Filter.eq('id_regionC', regionSelect));
// Convertir regiones a raster
var regionesRaster = region_filter.reduceToImage({
  properties: ['id_regionC'],
  reducer: ee.Reducer.first()
});

print('Regiones disponibles:', regiones_.aggregate_array('id_regionC').distinct());
print('Biomas disponibles:', regiones_.aggregate_array('bioma').distinct());

// Raster completo y filtrado
var biomes = regionesRaster;
var biomesFilter = biomes;

Map.addLayer(region_filter, {}, 'Region',false);

var mosaics = getMosaic(region_filter);

// ============================================================
// PROCESAMIENTO POR AÑO
// ============================================================

print('Clases nativas:', native_classes);
print('Clases a ignorar:', ignore_classes);

// Preparar las listas de clases en Earth Engine
var native_list = native_classes;
var ignore_list = ignore_classes;
var combined_list = native_list.cat(ignore_list);

years_list.forEach(function (year_j) {

  // Imagen inicial del año
  var edge_degrad_year = ee.Image(0);

  // Cargar la colección de cobertura terrestre
  var collection = ee.Image('projects/mapbiomas-colombia/assets/LULC/COLECCION3/INTEGRACION/COLOMBIA-1')
    .select('classification_' + year_j);

  // Crear máscara de vegetación nativa usando la lista combinada
  var native_mask = collection
    .remap({
      from: combined_list,
      to: combined_list,
      defaultValue: 21
    })
    .updateMask(biomes);

  // Filtrar la colección para mantener solo clases naturales
  var collection_i = collection.updateMask(native_mask.neq(21));

  // Identificar áreas antrópicas (base para el cálculo del borde)
  var anthropogenic = native_mask.updateMask(native_mask.eq(21));

  // Calcular el efecto de borde (distancia hasta 7.5 km)
  var edge = anthropogenic.distance(ee.Kernel.euclidean(params.dist_ecuclidian, 'meters'), false);

  // Eliminar bordes sobre clases ignoradas (Lógica de Earth Engine Server-Side)
  // Creamos una máscara donde las clases ignoradas valen 1 y las demás 0
  var mask_ignore = collection_i.remap({
    from: ignore_list,
    to: ee.List.repeat(1, ignore_list.length()),
    defaultValue: 0
  });
  
  // Actualizamos el edge dejando solo los pixeles que NO son ignorados (valor 0)
  edge = edge.updateMask(mask_ignore.eq(0));
  edge = edge.updateMask(edge.lte(params.limit_dist));
  
  // Limitar el efecto a 7 km
  //edge_degrad_year = edge_degrad_year.updateMask(edge_degrad_year.lte(params.limit_dist));

  // Integrar resultado en la imagen final
  // edge_degrad_year = edge_degrad_year.blend(edge).selfMask();
  edge_degrad_year = edge_degrad_year.blend(edge).selfMask();
  

  // Configurar propiedades del resultado
  edge_degrad_year = edge_degrad_year
    .rename('edge_' + year_j)
    .set('territory', String(regionSelect)) // Convertido a string para evitar error en el asset
    .set('collection_id', collectionId)
    .set('version', version)
    .set('year', year_j)
    .set('description', 'Área de borde (Edge Area)');

  var mosaic_year = mosaics.filter(ee.Filter.eq('year', year_j)).mosaic().clip(region_filter);

  Map.addLayer(mosaic_year,
                      { bands: ['swir1_median', 'nir_median', 'red_median'], gain: [0.08, 0.06, 0.2] }, 
                      'Mosaic_Green ' + String(year_j), false);
  Map.addLayer(mosaic_year,
                      { bands: ['nir_median',  'swir1_median','red_median'], gain: [0.06, 0.08, 0.2] }, 
                      'Mosaic_Red ' + String(year_j), false); 
                      
  Map.addLayer(collection.clip(region_filter), { min: 0, max: palette.length - 1, palette: palette }, 'Integración ' + String(year_j), false);
  
  // Visualización en el mapa
  Map.addLayer(
    edge_degrad_year.round().int16(),
    { palette: ['red', 'yellow', 'green'], min: 1, max: 7000 },
    'edge area '+String(year_j),
    false
  );
  var task_name = 'EDGE-AREA-' + String(regionSelect) + '-' + year_j + '-' + version
  // Exportación del resultado
  Export.image.toAsset({
    image: edge_degrad_year.round().int16(),
    description: task_name,
    assetId: 'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/01_edge_area/' +
      task_name,
    region: region_filter.bounds(),
    scale: 30,
    maxPixels: 1e13,
    priority: 999
  });
});