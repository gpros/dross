/**
 * seed_foods.gs — a one-off starter catalog of common Mediterranean-diet foods.
 *
 * HOW TO USE (runs as the sheet owner from the editor — no password/OAuth):
 *   1. In the Apps Script editor, add a new script file, name it "seed_foods", and paste this.
 *   2. Make sure Code.gs is present too (this reuses its helpers) and that setupSheet() has
 *      been run at least once (so the Foods tab and its name_es/name_free columns exist).
 *   3. Pick `seedFoods` in the function dropdown and click Run. Check View ▸ Executions:
 *      you'll see e.g. "seeded 200 foods, skipped 0 existing".
 *   4. Reload the app — the foods appear in the Foods tab. You can delete this file afterwards.
 *
 * VALUES: each row is per 100 g, RAW / as-purchased (i.e. what a package label shows). Weigh
 * food raw and multiply; cooking afterwards doesn't change the totals. Foods normally eaten raw
 * are unaffected. Pasta/rice/legumes are the DRY values; meat/fish are raw. Numbers are standard
 * reference values (USDA/BEDCA-style) — adjust any to match your own labels.
 *
 * Column order per row:
 *   [ name (English), name (Spanish), kcal, protein_g, carbs_g, fat_g, serving_g | null ]
 * serving_g is filled only where a portion is widely accepted (a tbsp of oil, a slice of bread,
 * an egg, a handful of nuts, a glass of milk …); null means "weigh it directly".
 *
 * Re-running is safe: foods whose English name already exists are skipped.
 */

var SEED_FOODS = [
  // ---- Meat & poultry (raw), incl. cured ----
  ["Pork loin", "Lomo de cerdo", 209, 19, 0, 14, null],
  ["Pork tenderloin", "Solomillo de cerdo", 120, 21, 0, 3.5, null],
  ["Pork belly", "Panceta de cerdo", 518, 9, 0, 53, null],
  ["Pork chop", "Chuleta de cerdo", 231, 22, 0, 15, null],
  ["Pork ribs", "Costillas de cerdo", 277, 20, 0, 22, null],
  ["Bacon", "Bacon", 541, 37, 1.4, 42, null],
  ["Cooked ham", "Jamón cocido", 145, 18, 1.5, 7, null],
  ["Serrano ham", "Jamón serrano", 241, 31, 1, 12, 30],
  ["Chorizo", "Chorizo", 455, 24, 2, 38, 30],
  ["Beef tenderloin", "Solomillo de ternera", 180, 20, 0, 11, null],
  ["Beef steak", "Filete de ternera", 201, 22, 0, 12, null],
  ["Ground beef", "Carne picada de ternera", 254, 17, 0, 20, null],
  ["Beef brisket", "Falda de ternera", 210, 20, 0, 14, null],
  ["Veal", "Ternera", 172, 21, 0, 9, null],
  ["Beef liver", "Hígado de ternera", 135, 20, 3.9, 3.6, null],
  ["Chicken breast", "Pechuga de pollo", 120, 23, 0, 2.6, null],
  ["Chicken thigh", "Muslo de pollo", 177, 18, 0, 11, null],
  ["Chicken wings", "Alitas de pollo", 203, 18, 0, 14, null],
  ["Whole chicken", "Pollo entero", 215, 18, 0, 15, null],
  ["Turkey breast", "Pechuga de pavo", 111, 24, 0, 1.7, null],
  ["Lamb chop", "Chuleta de cordero", 282, 17, 0, 23, null],
  ["Lamb leg", "Pierna de cordero", 230, 18, 0, 17, null],
  ["Rabbit", "Conejo", 173, 22, 0, 9, null],
  ["Duck breast", "Magret de pato", 135, 18, 0, 6, null],
  ["Blood sausage", "Morcilla", 379, 15, 3, 34, 50],
  ["Salami", "Salchichón", 336, 22, 2, 27, 30],
  ["Fresh sausage", "Salchicha fresca", 297, 16, 1, 26, null],
  ["Longaniza", "Longaniza", 420, 22, 2, 36, 30],

  // ---- Fish & seafood (raw) ----
  ["Sardine", "Sardina", 160, 20, 0, 9, null],
  ["Fresh anchovy", "Boquerón", 131, 20, 0, 5, null],
  ["Tuna", "Atún", 144, 23, 0, 5, null],
  ["Canned tuna in oil", "Atún en aceite", 190, 25, 0, 10, 56],
  ["Canned tuna in water", "Atún al natural", 116, 26, 0, 1, 56],
  ["Hake", "Merluza", 90, 17, 0, 2, null],
  ["Cod", "Bacalao fresco", 82, 18, 0, 0.7, null],
  ["Salt cod", "Bacalao salado", 290, 62, 0, 2, null],
  ["Sea bass", "Lubina", 97, 18, 0, 2.5, null],
  ["Sea bream", "Dorada", 96, 19, 0, 2, null],
  ["Salmon", "Salmón", 208, 20, 0, 13, null],
  ["Trout", "Trucha", 141, 20, 0, 6, null],
  ["Mackerel", "Caballa", 205, 19, 0, 14, null],
  ["Swordfish", "Pez espada", 144, 20, 0, 7, null],
  ["Monkfish", "Rape", 76, 15, 0, 1.5, null],
  ["Sole", "Lenguado", 91, 18, 0, 1.5, null],
  ["Prawn", "Gamba", 85, 20, 0, 0.5, null],
  ["King prawn", "Langostino", 99, 24, 0, 0.3, null],
  ["Mussel", "Mejillón", 86, 12, 3.7, 2.2, null],
  ["Clam", "Almeja", 86, 14, 2.6, 1, null],
  ["Squid", "Calamar", 92, 16, 3, 1.4, null],
  ["Octopus", "Pulpo", 82, 15, 2.2, 1, null],
  ["Cuttlefish", "Sepia", 79, 16, 0.8, 0.7, null],
  ["Anchovy fillets", "Anchoas", 210, 29, 0, 10, 15],
  ["Smoked salmon", "Salmón ahumado", 117, 18, 0, 4.3, 50],

  // ---- Eggs & dairy ----
  ["Egg", "Huevo", 143, 13, 1.1, 9.5, 50],
  ["Egg white", "Clara de huevo", 52, 11, 0.7, 0.2, null],
  ["Egg yolk", "Yema de huevo", 322, 16, 3.6, 27, null],
  ["Whole milk", "Leche entera", 61, 3.2, 4.8, 3.3, 200],
  ["Semi-skimmed milk", "Leche semidesnatada", 46, 3.3, 4.8, 1.6, 200],
  ["Skimmed milk", "Leche desnatada", 34, 3.4, 5, 0.1, 200],
  ["Plain yogurt", "Yogur natural", 61, 3.5, 4.7, 3.3, 125],
  ["Greek yogurt", "Yogur griego", 97, 9, 3.9, 5, 125],
  ["Skimmed yogurt", "Yogur desnatado", 43, 4.3, 6, 0.2, 125],
  ["Kefir", "Kéfir", 64, 3.3, 4.8, 3.5, 200],
  ["Butter", "Mantequilla", 717, 0.9, 0.1, 81, 10],
  ["Manchego cheese", "Queso manchego", 392, 26, 0.5, 32, 30],
  ["Mozzarella", "Mozzarella", 280, 22, 2.2, 21, 30],
  ["Feta cheese", "Queso feta", 264, 14, 4, 21, 30],
  ["Fresh cheese", "Queso fresco", 174, 13, 3, 12, 30],
  ["Cottage cheese", "Requesón", 98, 11, 3.4, 4.3, 100],
  ["Cured cheese", "Queso curado", 430, 29, 1, 35, 30],
  ["Cream cheese", "Queso crema", 342, 6, 4, 34, 30],
  ["Parmesan", "Parmesano", 431, 38, 4, 29, 15],
  ["Goat cheese", "Queso de cabra", 364, 22, 2.5, 30, 30],
  ["Cooking cream", "Nata para cocinar", 292, 2.5, 3.4, 30, 30],

  // ---- Vegetables (raw) ----
  ["Potato", "Patata", 77, 2, 17, 0.1, null],
  ["Onion", "Cebolla", 40, 1.1, 9, 0.1, null],
  ["Carrot", "Zanahoria", 41, 0.9, 10, 0.2, null],
  ["Tomato", "Tomate", 20, 0.9, 3.9, 0.2, null],
  ["Red pepper", "Pimiento rojo", 31, 1, 6, 0.3, null],
  ["Green pepper", "Pimiento verde", 20, 0.9, 4.6, 0.2, null],
  ["Zucchini", "Calabacín", 17, 1.2, 3.1, 0.3, null],
  ["Eggplant", "Berenjena", 25, 1, 6, 0.2, null],
  ["Cucumber", "Pepino", 15, 0.7, 3.6, 0.1, null],
  ["Lettuce", "Lechuga", 15, 1.4, 2.9, 0.2, null],
  ["Spinach", "Espinaca", 23, 2.9, 3.6, 0.4, null],
  ["Chard", "Acelga", 19, 1.8, 3.7, 0.2, null],
  ["Broccoli", "Brócoli", 34, 2.8, 7, 0.4, null],
  ["Cauliflower", "Coliflor", 25, 1.9, 5, 0.3, null],
  ["Green beans", "Judías verdes", 31, 1.8, 7, 0.2, null],
  ["Peas", "Guisantes", 81, 5, 14, 0.4, null],
  ["Garlic", "Ajo", 149, 6.4, 33, 0.5, null],
  ["Mushroom", "Champiñón", 22, 3.1, 3.3, 0.3, null],
  ["Artichoke", "Alcachofa", 47, 3.3, 11, 0.2, null],
  ["Asparagus", "Espárrago", 20, 2.2, 3.9, 0.1, null],
  ["Pumpkin", "Calabaza", 26, 1, 6.5, 0.1, null],
  ["Leek", "Puerro", 61, 1.5, 14, 0.3, null],
  ["Beetroot", "Remolacha", 43, 1.6, 10, 0.2, null],
  ["Cabbage", "Col", 25, 1.3, 6, 0.1, null],
  ["Celery", "Apio", 16, 0.7, 3, 0.2, null],
  ["Sweet corn", "Maíz", 90, 3.2, 19, 1.2, null],
  ["Sweet potato", "Boniato", 86, 1.6, 20, 0.1, null],
  ["Radish", "Rábano", 16, 0.7, 3.4, 0.1, null],
  ["Fennel", "Hinojo", 31, 1.2, 7, 0.2, null],
  ["Red cabbage", "Lombarda", 31, 1.4, 7, 0.2, null],
  ["Crushed tomato", "Tomate triturado", 32, 1.6, 7, 0.3, null],
  ["Kale", "Col rizada", 49, 4.3, 9, 0.9, null],

  // ---- Fruit (raw) ----
  ["Apple", "Manzana", 52, 0.3, 14, 0.2, null],
  ["Banana", "Plátano", 89, 1.1, 23, 0.3, null],
  ["Orange", "Naranja", 47, 0.9, 12, 0.1, null],
  ["Pear", "Pera", 57, 0.4, 15, 0.1, null],
  ["Grapes", "Uvas", 69, 0.7, 18, 0.2, null],
  ["Strawberry", "Fresa", 32, 0.7, 7.7, 0.3, null],
  ["Watermelon", "Sandía", 30, 0.6, 8, 0.2, null],
  ["Melon", "Melón", 34, 0.8, 8, 0.2, null],
  ["Peach", "Melocotón", 39, 0.9, 10, 0.3, null],
  ["Apricot", "Albaricoque", 48, 1.4, 11, 0.4, null],
  ["Plum", "Ciruela", 46, 0.7, 11, 0.3, null],
  ["Cherry", "Cereza", 63, 1, 16, 0.2, null],
  ["Fig", "Higo", 74, 0.8, 19, 0.3, null],
  ["Kiwi", "Kiwi", 61, 1.1, 15, 0.5, null],
  ["Pineapple", "Piña", 50, 0.5, 13, 0.1, null],
  ["Mango", "Mango", 60, 0.8, 15, 0.4, null],
  ["Lemon", "Limón", 29, 1.1, 9, 0.3, null],
  ["Pomegranate", "Granada", 83, 1.7, 19, 1.2, null],
  ["Date", "Dátil", 282, 2.5, 75, 0.4, null],
  ["Raisin", "Pasas", 299, 3.1, 79, 0.5, null],
  ["Avocado", "Aguacate", 160, 2, 9, 15, 100],
  ["Grapefruit", "Pomelo", 42, 0.8, 11, 0.1, null],
  ["Mandarin", "Mandarina", 53, 0.8, 13, 0.3, null],
  ["Blueberry", "Arándano", 57, 0.7, 14, 0.3, null],
  ["Raspberry", "Frambuesa", 52, 1.2, 12, 0.7, null],

  // ---- Legumes (dried, as sold) ----
  ["Chickpeas (dried)", "Garbanzos (secos)", 364, 19, 61, 6, null],
  ["Lentils (dried)", "Lentejas (secas)", 352, 25, 63, 1, null],
  ["White beans (dried)", "Alubias blancas (secas)", 333, 23, 60, 0.8, null],
  ["Kidney beans (dried)", "Alubias rojas (secas)", 337, 23, 61, 1.1, null],
  ["Fava beans (dried)", "Habas (secas)", 341, 26, 58, 1.5, null],
  ["Black beans (dried)", "Frijoles negros (secos)", 341, 21, 62, 1.4, null],
  ["Dried peas", "Guisantes secos", 341, 25, 60, 1, null],
  ["Soybeans", "Soja", 446, 36, 30, 20, null],

  // ---- Grains, bread & pasta (dry / as sold) ----
  ["White rice", "Arroz blanco", 360, 7, 79, 0.6, null],
  ["Brown rice", "Arroz integral", 362, 7.5, 76, 2.7, null],
  ["Pasta", "Pasta", 371, 13, 75, 1.5, null],
  ["Whole wheat pasta", "Pasta integral", 348, 14, 66, 2.5, null],
  ["White bread", "Pan blanco", 265, 9, 49, 3.2, 30],
  ["Whole wheat bread", "Pan integral", 247, 13, 41, 3.4, 30],
  ["Baguette", "Baguette", 274, 9, 55, 1.8, 50],
  ["Couscous", "Cuscús", 376, 13, 77, 0.6, null],
  ["Oats", "Avena", 389, 17, 66, 7, null],
  ["Wheat flour", "Harina de trigo", 364, 10, 76, 1, null],
  ["Quinoa", "Quinoa", 368, 14, 64, 6, null],
  ["Corn flakes", "Copos de maíz", 357, 7, 84, 0.9, null],
  ["Muesli", "Muesli", 389, 10, 66, 8, null],
  ["Semolina", "Sémola", 360, 12, 73, 1, null],
  ["Barley", "Cebada", 354, 12, 73, 2.3, null],
  ["Cornmeal", "Harina de maíz", 362, 8, 76, 3.6, null],
  ["Wheat tortilla", "Tortilla de trigo", 310, 8, 50, 8, 40],
  ["Breadcrumbs", "Pan rallado", 395, 13, 72, 5, null],

  // ---- Nuts & seeds ----
  ["Almonds", "Almendras", 579, 21, 22, 50, 30],
  ["Walnuts", "Nueces", 654, 15, 14, 65, 30],
  ["Hazelnuts", "Avellanas", 628, 15, 17, 61, 30],
  ["Pistachios", "Pistachos", 560, 20, 28, 45, 30],
  ["Peanuts", "Cacahuetes", 567, 26, 16, 49, 30],
  ["Cashews", "Anacardos", 553, 18, 30, 44, 30],
  ["Sunflower seeds", "Pipas de girasol", 584, 21, 20, 51, 30],
  ["Pumpkin seeds", "Pipas de calabaza", 559, 30, 11, 49, 30],
  ["Sesame seeds", "Sésamo", 573, 18, 23, 50, null],
  ["Tahini", "Tahini", 595, 17, 21, 54, 15],
  ["Pine nuts", "Piñones", 673, 14, 13, 68, 15],
  ["Chestnuts", "Castañas", 213, 2.4, 45, 1.4, null],
  ["Peanut butter", "Crema de cacahuete", 588, 25, 20, 50, 20],

  // ---- Oils & fats ----
  ["Olive oil", "Aceite de oliva", 884, 0, 0, 100, 14],
  ["Extra virgin olive oil", "Aceite de oliva virgen extra", 884, 0, 0, 100, 14],
  ["Sunflower oil", "Aceite de girasol", 884, 0, 0, 100, 14],
  ["Margarine", "Margarina", 717, 0.2, 0.7, 81, 10],
  ["Lard", "Manteca de cerdo", 902, 0, 0, 100, null],

  // ---- Condiments, sauces & sweets ----
  ["Honey", "Miel", 304, 0.3, 82, 0, 20],
  ["Sugar", "Azúcar", 387, 0, 100, 0, 5],
  ["Salt", "Sal", 0, 0, 0, 0, null],
  ["Green olives", "Aceitunas verdes", 145, 1, 3.8, 15, 30],
  ["Black olives", "Aceitunas negras", 115, 0.8, 6, 11, 30],
  ["Capers", "Alcaparras", 23, 2.4, 5, 0.9, 15],
  ["Fried tomato sauce", "Tomate frito", 92, 1.5, 10, 5, 50],
  ["Vinegar", "Vinagre", 18, 0, 0.9, 0, null],
  ["Mayonnaise", "Mayonesa", 680, 1, 0.6, 75, 15],
  ["Mustard", "Mostaza", 66, 4, 5, 4, 10],
  ["Ketchup", "Kétchup", 112, 1.2, 26, 0.1, 15],
  ["Dark chocolate", "Chocolate negro", 546, 5, 61, 31, 20],
  ["Milk chocolate", "Chocolate con leche", 535, 7.6, 59, 30, 20],
  ["Jam", "Mermelada", 278, 0.4, 69, 0.1, 20],
  ["Soy sauce", "Salsa de soja", 53, 8, 4.9, 0.6, 15],
  ["Hazelnut cocoa spread", "Crema de cacao", 539, 6, 57, 31, 20],
  ["Sofrito", "Sofrito", 110, 1.5, 8, 8, 50],
  ["Béchamel sauce", "Bechamel", 150, 4, 10, 10, 50],

  // ---- Beverages ----
  ["Orange juice", "Zumo de naranja", 45, 0.7, 10, 0.2, 200],
  ["Black coffee", "Café solo", 2, 0.1, 0, 0, null],
  ["Red wine", "Vino tinto", 85, 0.1, 2.6, 0, 150],
  ["Beer", "Cerveza", 43, 0.5, 3.6, 0, 330],
  ["Cola", "Refresco de cola", 42, 0, 10.6, 0, 330],
  ["Almond milk", "Bebida de almendras", 24, 0.5, 3, 1.1, 200],
  ["Oat milk", "Bebida de avena", 47, 0.8, 7, 1.5, 200],
];

/**
 * Append every SEED_FOODS row not already in the catalog (matched by English name,
 * case-insensitive). Reuses Code.gs helpers (readTable/appendRow/trimStr/withLock).
 * Idempotent — safe to re-run.
 */
function seedFoods() {
  return withLock(function () {
    var table = readTable('Foods');
    var seen = {};
    table.rows.forEach(function (r) { seen[String(r.name).trim().toLowerCase()] = true; });

    var added = 0, skipped = 0;
    for (var i = 0; i < SEED_FOODS.length; i++) {
      var row = SEED_FOODS[i];
      var nameEn = trimStr(row[0]);
      if (!nameEn) continue;
      var key = nameEn.toLowerCase();
      if (seen[key]) { skipped++; continue; }
      seen[key] = true;

      appendRow('Foods', {
        id: Utilities.getUuid(),
        name: nameEn,
        name_es: trimStr(row[1]),
        name_free: '',
        kcal_100g: seedNum(row[2]),
        protein_100g: seedNum(row[3]),
        carbs_100g: seedNum(row[4]),
        fat_100g: seedNum(row[5]),
        serving_g: seedNum(row[6]),
        servings: '',
        created_at: new Date().toISOString()
      });
      added++;
    }
    return 'seeded ' + added + ' foods, skipped ' + skipped + ' existing';
  });
}

/** null/undefined/'' -> '' (blank = unknown); a number stays a number. */
function seedNum(v) {
  return (v === null || v === undefined || v === '') ? '' : v;
}
