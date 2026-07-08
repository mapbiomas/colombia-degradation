/****
 * Nombre: 01B_fragmentation_edgeAge_v2.js
 * Descripción: Calcula la edad del borde (edge age) a partir de las áreas
 *              de borde generadas previamente en el proceso de
 *              fragmentación. La edad del borde representa cuántos años
 *              consecutivos un píxel ha permanecido como borde, permitiendo
 *              analizar la estabilidad o dinámica de la fragmentación.
 *
 * Entradas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/01_edge_area (de 01A)
 *
 * Salidas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/01_edge_age/EDGE-AGE-RRRR-YYYY-V
 *     → ee.Image (int8, años consecutivos como borde)
 *
 * Autor original: dhemerson.costa@ipam.org.br
 * Adaptación Colombia: mapbiomas-colombia
 * Fecha: 2026-05
 * Update-Colombia 2026-06: Adaptado para procesamiento por regiones
****/

// ============================================================
//   CONFIGURACIÓN DE PARÁMETROS
// ============================================================

var params = {
  region: 30471, // Ejemplo: Amazonia (1), Andes (2), etc., usando el id_regionC
  version_in: 1,
  version_out: 1,
  collectionId: 3
};

// Años a procesar
var years = [
  1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995,
  1996, 1997, 1998, 1999,
  2000, 2001, 2002, 2003, 2004, 2005, 2006,
  2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017,
  2018, 2019, 2020, 2021, 2022, 2023, 2024
];

var regionSelect = params.region;

// ============================================================
//   CARGA DE DIRECTORIOS Y VECTORES DE REGIONES
// ============================================================

// Cargar el vector de regiones desde el directorio centralizado
var paths_directory = require('users/kahuertas/mapbiomas-colombia:mapbiomas-colombia/collection-4/modules/CollectionDirectories.js').paths;
var regiones_ = ee.FeatureCollection(paths_directory.regionVectorBuffer);

// Filtrar por la región de interés
var region_filter = regiones_.filter(ee.Filter.eq('id_regionC', regionSelect));
var region_bounds = region_filter.geometry().bounds();

Map.addLayer(region_filter, {}, 'Region ' + String(regionSelect));

// ============================================================
//   LECTURA Y PREPARACIÓN DE DATOS DE BORDE
// ============================================================

// Cargar la colección de áreas de borde y binarizar (1 = borde, 0 = no borde)
// Se filtra por versión y por el territorio (región) generado en el paso 01A
var edge_i_bin = ee.ImageCollection('projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/01_edge_area')
  .filter(ee.Filter.eq('version', params.version_in)) 
  .filter(ee.Filter.eq('territory', String(regionSelect))) // Filtrar por la región específica
  .map(function(image) {
    // Binarizar cada imagen (valores >= 1 se asignan a 1)
    return image.gte(1).set({
      'year': image.get('year')
    });
  });

print('Años disponibles en la región ' + String(regionSelect) + ':', edge_i_bin.aggregate_array('year'));

// ============================================================
//   CÁLCULO DE LA EDAD DEL BORDE (EDGE AGE)
// ============================================================

// Inicializar imagen vacía para almacenar las edades
var ages_i = ee.Image([]);

// Iterar sobre todos los años definidos
years.forEach(function(year_j) {

  // Primer año (2000): se toma directamente la imagen binaria
  if (year_j == 1985) {
    var edge_ij_bin = edge_i_bin
      .filter(ee.Filter.eq('year', year_j))
      .mosaic();

    ages_i = ages_i.addBands(edge_ij_bin)
      .rename('edge_age_' + year_j)
      .unmask(0);

  } else {
    // Para años posteriores: acumular la edad del borde
    var edge_ij_bin = edge_i_bin
      .filter(ee.Filter.eq('year', year_j))
      .mosaic();

    var age_past = ages_i.select('edge_age_' + String(year_j - 1));

    // Reglas de actualización:
    //  - Si no hay borde antes ni ahora → 0
    //  - Si el píxel deja de ser borde → 0
    //  - Si el píxel es borde nuevo → 1
    //  - Si sigue siendo borde → edad anterior + 1
    var age_ij = ee.Image(0)
      .where(edge_ij_bin.eq(0).and(age_past.eq(0)), 0)
      .where(edge_ij_bin.eq(0).and(age_past.gte(1)), 0)
      .where(edge_ij_bin.eq(1).and(age_past.eq(0)), edge_ij_bin)
      .where(edge_ij_bin.eq(1).and(age_past.gte(1)), age_past.add(edge_ij_bin))
      .rename('edge_age_' + year_j);

    // Añadir la banda calculada al stack
    ages_i = ages_i.addBands(age_ij);
  }

});

// Aplicar máscara (ocultar valores nulos o cero)
ages_i = ages_i.selfMask();

// Visualización rápida
print(ages_i);
Map.addLayer(ages_i.select('edge_age_2024').clip(region_filter),
  {palette: ['green', 'yellow', 'red'], min: 1, max: 25},
  'Edad del borde 2024 - Región ' + String(regionSelect));
Map.addLayer(ages_i.clip(region_filter), {}, 'Serie temporal de edad de borde', false);

// ============================================================
//   EXPORTACIÓN DE RESULTADOS
// ============================================================

years.forEach(function(year_i) {
  
  // Seleccionar la imagen correspondiente al año
  var toExport = ages_i.select('edge_age_' + year_i)
    .rename('edge_age_' + year_i)
    .set('territory', String(regionSelect)) // Guardar el ID de la región
    .set('collection_id', params.collectionId)
    .set('version', params.version_out)
    .set('year', year_i)
    .set('description', 'EDGE AGE');

  var task_name = 'EDGE-AGE-' + String(regionSelect) + '-' + year_i + '-' + params.version_out;

  // Exportar a un asset de GEE
  Export.image.toAsset({
    image: toExport.int8(),
    description: task_name,
    assetId: 'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/01_edge_age/' + task_name,
    region: region_bounds,
    scale: 30,
    maxPixels: 1e13,
    priority: 999
  });
});