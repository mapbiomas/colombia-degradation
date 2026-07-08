/****
 * Nombre: 06_secondaryVegetation_age.js
 * Descripción: Calcula cuántos años consecutivos, contando desde el último
 *              año de la serie hacia atrás, un píxel ha pertenecido a la
 *              clase de vegetación secundaria. Distingue vegetación secundaria
 *              "vieja"/consolidada (edad alta) de conversión reciente (edad
 *              baja).
 *
 * Entradas (GEE):
 *   asset: projects/mapbiomas-colombia/assets/DEFORESTATION/deforestation-secondary-vegetation-ft
 *          (ImageCollection, mosaicked → Image multi-banda, 1 banda
 *          classification_YYYY por año; clases 3 y 5 = vegetación
 *          secundaria dentro de este asset dedicado — ver secondary_classes
 *          abajo)
 *   LULC: projects/mapbiomas-colombia/assets/LULC/COLECCION3/INTEGRACION/COLOMBIA-1
 *         (para el cruce final edad + clase)
 *
 * Salidas (GEE):
 *   DEGRADACION/.../BETA/PROCESS/degradation_secondaryVegetation_col{N}_v{V}
 *     → ee.Image multi-banda: age_YYYY (edad×100 + código LULC del año)
 *
 * Autor original: dhemerson.costa@ipam.org.br
 * Adaptación Colombia: mapbiomas-colombia
 * Fecha: 2026-07
****/

// ============================================================
// PARÁMETROS GENERALES
// ============================================================

var asset = 'projects/mapbiomas-colombia/assets/DEFORESTATION/deforestation-secondary-vegetation-ft';

// Códigos de clase que identifican "vegetación secundaria" DENTRO de este
// asset dedicado (no son necesariamente los mismos códigos que usa la
// clasificación LULC general) — 3 y 5.
var secondary_classes = [3, 5];

var collectionId = 1;   // versión del producto de degradación (no la colección LULC)
var version      = 1;

var bandPrefix = 'classification_';

// Empieza en 1987 (no 1985): el producto de transición necesita un par de
// años de historia previa para detectar el evento de conversión.
var years = [
  1987, 1988, 1989, 1990, 1991, 1992,
  1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000,
  2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008,
  2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016,
  2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024
];

var PROCESS_ROOT = 'projects/mapbiomas-colombia/assets/DEGRADACION/COLECCION1/BETA/PROCESS/';

// ============================================================
// CARGA Y BINARIZACIÓN DEL INSUMO
// ============================================================

var image = ee.ImageCollection(asset).mosaic();

// 1 donde el píxel es alguna de las clases de vegetación secundaria del
// asset dedicado, sin dato en el resto (selfMask).
var secondaryMask = ee.List(secondary_classes).iterate(function (cls, acc) {
  return ee.Image(acc).or(image.eq(ee.Number(cls)));
}, ee.Image(0));

image = ee.Image(secondaryMask).selfMask();

print('Máscara de vegetación secundaria (binaria):', image);

// ============================================================
// EDAD DE CLASE — acumulación vía ee.List.iterate()
// ============================================================
// Multiplicar (edad_anterior + 1) por la máscara binaria del año actual
// reinicia la edad a 0 automáticamente donde la máscara vale 0.

var getClassAge = function (img, targetClass, years_, bandPrefix_) {

  var classMask = ee.Image(img).gte(targetClass);

  var initialState = ee.Dictionary({
    ageImage: ee.Image(0),
    output: ee.Image([])
  });

  var result = ee.List(years_).iterate(
    function (year, state) {

      state = ee.Dictionary(state);
      year = ee.Number(year).format('%.0f');

      var ageImage = ee.Image(state.get('ageImage'));
      var output   = ee.Image(state.get('output'));

      var currentImageBand = ee.String(bandPrefix_).cat(year);
      var currentImage = classMask.select([currentImageBand]).unmask(0);

      var currentAge = ageImage.add(1)
        .multiply(currentImage)
        .rename(ee.String('age_').cat(year));

      return ee.Dictionary({
        ageImage: currentAge,
        output: output.addBands(currentAge)
      });
    },
    initialState
  );

  return ee.Image(ee.Dictionary(result).get('output'));
};

var targetClass = 1;   // clase objetivo dentro de la máscara ya binarizada

var ages = getClassAge(image, targetClass, years, bandPrefix).selfMask();

// Excluir píxeles "vegetación secundaria" en TODO el período: indica error
// de clasificación, no una serie real de regeneración.
var lastYear = years[years.length - 1];
ages = ages.updateMask(ages.select('age_' + lastYear).neq(years.length));

print('Edades de vegetación secundaria (todas las bandas):', ages);
Map.addLayer(ages.select('age_' + lastYear), {
  min: 1, max: years.length,
  palette: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b',
            '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850']
}, 'Edad veg. secundaria ' + lastYear, false);

// ============================================================
// CRUCE CON LA CLASIFICACIÓN LULC (edad × 100 + clase)
// ============================================================
// Codifica edad y clase LULC en un solo entero (edad*100 + clase) para no
// exportar dos bandas paralelas por año.

var recipe = ee.Image([]);

years.forEach(function (year) {

  var age_i = ages.select('age_' + year);

  var lulc_i = ee.Image(
    'projects/mapbiomas-colombia/assets/LULC/COLECCION3/INTEGRACION/COLOMBIA-1'
  ).select('classification_' + year).updateMask(age_i);

  var result_i = age_i.multiply(100).selfMask()
    .add(lulc_i)
    .rename('age_' + year);

  recipe = recipe.addBands(result_i);

});

print('Salida final (edad×100 + clase):', recipe);
Map.addLayer(recipe.select('age_' + lastYear), {}, 'age_' + lastYear + ' (edad×100+clase)', false);

// ============================================================
// EXPORTACIÓN
// ============================================================

var colombia = ee.FeatureCollection(
  'users/mapbiomas_andessur/2024/Lim_Colombia'
).geometry().bounds();

Export.image.toAsset({
  image: recipe,
  description: 'degradation_secondaryVegetation_col' + collectionId + '_v' + version,
  assetId: PROCESS_ROOT + 'degradation_secondaryVegetation_col' + collectionId + '_v' + version,
  region: colombia,
  pyramidingPolicy: 'mode',
  scale: 30,
  maxPixels: 1e13,
  priority: 999
});
