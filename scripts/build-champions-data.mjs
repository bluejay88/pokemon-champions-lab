import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = 'https://www.serebii.net';
const WORKSPACE_ROOT = process.cwd();
const SOURCES_DIR = path.join(WORKSPACE_ROOT, 'sources');
const OUTPUT_DIR = path.join(WORKSPACE_ROOT, 'src', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'champions-data.json');

const STAT_KEYS = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];
const DAMAGE_TYPES = [
  'Normal',
  'Fire',
  'Water',
  'Electric',
  'Grass',
  'Ice',
  'Fighting',
  'Poison',
  'Ground',
  'Flying',
  'Psychic',
  'Bug',
  'Rock',
  'Ghost',
  'Dragon',
  'Dark',
  'Steel',
  'Fairy',
];

function cleanText(value) {
  return value.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
}

function toAbsoluteUrl(url) {
  if (!url) {
    return '';
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `${ROOT}${url}`;
}

async function readLocalHtml(filename) {
  return fs.readFile(path.join(SOURCES_DIR, filename), 'utf8');
}

function parsePokemonSlugs(html) {
  const $ = cheerio.load(html);
  return [...new Set(
    $('a[href^="/pokedex-champions/"]')
      .map((_, element) => $(element).attr('href') ?? '')
      .get()
      .filter((href) => href !== '/pokedex-champions/' && /^\/pokedex-champions\/[a-z0-9-]+\/$/i.test(href))
      .map((href) => href.replace('/pokedex-champions/', '').replace(/\/$/, '')),
  )];
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'PokemonChampionsBuilder/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

function parseTypesFromCell($, cell) {
  return $(cell)
    .find('img')
    .map((_, image) => {
      const alt = $(image).attr('alt') ?? '';
      const src = $(image).attr('src') ?? '';
      const altMatch = alt.match(/([A-Za-z]+)-type/);
      if (altMatch) {
        return altMatch[1];
      }

      const srcMatch = src.match(/\/([a-z]+)\.(gif|png)$/i);
      return srcMatch ? srcMatch[1][0].toUpperCase() + srcMatch[1].slice(1).toLowerCase() : '';
    })
    .get()
    .filter(Boolean);
}

function parseMoveTable($, table) {
  const rows = $(table).find('tr').toArray().slice(2);
  const moves = [];

  for (let index = 0; index < rows.length; index += 2) {
    const summaryRow = rows[index];
    const detailRow = rows[index + 1];

    if (!summaryRow || !detailRow) {
      continue;
    }

    const summaryCells = $(summaryRow).children('td').toArray();
    if (summaryCells.length < 7) {
      continue;
    }

    const name = cleanText($(summaryCells[0]).text());
    const type = parseTypesFromCell($, summaryCells[1])[0] ?? 'Normal';
    const categoryAlt = $(summaryCells[2]).find('img').attr('alt') ?? '';
    const category = categoryAlt.includes('Physical')
      ? 'Physical'
      : categoryAlt.includes('Special')
        ? 'Special'
        : 'Status';

    moves.push({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name,
      type,
      category,
      power: cleanText($(summaryCells[3]).text()) === '--' ? null : Number(cleanText($(summaryCells[3]).text())),
      accuracy: cleanText($(summaryCells[4]).text()) === '--' || cleanText($(summaryCells[4]).text()) === '101'
        ? null
        : Number(cleanText($(summaryCells[4]).text())),
      pp: cleanText($(summaryCells[5]).text()) === '--' ? null : Number(cleanText($(summaryCells[5]).text())),
      effectChance: cleanText($(summaryCells[6]).text()) === '--' ? null : Number(cleanText($(summaryCells[6]).text())),
      description: cleanText($(detailRow).text()),
    });
  }

  return moves;
}

function parseStatTable($, table) {
  const statCells = $(table).find('tr').eq(2).children('td').toArray().slice(-6);
  const rangesRow = $(table).find('tr').eq(4).children('td').toArray().slice(-6);

  return {
    baseStats: STAT_KEYS.reduce((result, key, index) => {
      result[key] = Number(cleanText($(statCells[index]).text()));
      return result;
    }, {}),
    neutralRanges: STAT_KEYS.reduce((result, key, index) => {
      result[key] = cleanText($(rangesRow[index]).text());
      return result;
    }, {}),
  };
}

function parseAbilityTable($, table) {
  const names = [...new Set(
    $(table)
      .find('tr')
      .first()
      .find('a[href*="/abilitydex/"]')
      .map((_, link) => cleanText($(link).text()))
      .get()
      .filter(Boolean),
  )];

  const descriptionText = cleanText($(table).find('tr').eq(1).text());

  return names.map((name, index) => {
    const marker = `${name}:`;
    const startIndex = descriptionText.indexOf(marker);
    const nextName = names[index + 1];
    const nextIndex = nextName ? descriptionText.indexOf(`${nextName}:`) : -1;
    const descriptionSlice = startIndex >= 0
      ? descriptionText.slice(startIndex + marker.length, nextIndex >= 0 ? nextIndex : undefined)
      : '';

    return {
      name,
      description: cleanText(descriptionSlice),
    };
  });
}

function parseFormTable($, table, pendingImages) {
  const rows = $(table).children('tbody').children('tr').toArray();
  const headerLabels = $(rows[0]).children('td').toArray().map((cell) => cleanText($(cell).text()));
  const valueCells = $(rows[1]).children('td').toArray();
  const detailLabels = $(rows[2]).children('td').toArray().map((cell) => cleanText($(cell).text()));
  const detailValues = $(rows[3]).children('td').toArray().map((cell) => cleanText($(cell).text()));

  const headerIndex = (label) => headerLabels.findIndex((entry) => entry === label);
  const detailIndex = (label) => detailLabels.findIndex((entry) => entry === label);

  const nameCell = valueCells[headerIndex('Name')];
  const noCell = valueCells[headerIndex('No.')];
  const typeCell = valueCells[headerIndex('Type')];
  const formName = cleanText($(nameCell).text()).replace(/\s+/g, ' ');
  const dexText = cleanText($(noCell).text());
  const dexNumber = Number((dexText.match(/#(\d+)/) ?? [])[1] ?? 0);
  const types = parseTypesFromCell($, typeCell);
  const classification = detailIndex('Classification') >= 0 ? detailValues[detailIndex('Classification')] : '';
  const height = detailIndex('Height') >= 0 ? detailValues[detailIndex('Height')] : '';
  const weight = detailIndex('Weight') >= 0 ? detailValues[detailIndex('Weight')] : '';

  const [sprite = '', shinySprite = ''] = pendingImages;
  const id = formName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return {
    id,
    displayName: formName,
    dexNumber,
    types,
    classification,
    height,
    weight,
    sprite,
    shinySprite,
    isMega: formName.startsWith('Mega '),
  };
}

function parseDamageTakenTable($, table) {
  const values = $(table).find('tr').eq(2).children('td').toArray();

  return DAMAGE_TYPES.reduce((result, damageType, index) => {
    const valueText = cleanText($(values[index]).text());
    const numeric = Number(valueText);
    result[damageType] = Number.isFinite(numeric) ? numeric : 1;
    return result;
  }, {});
}

function parsePokemonPage(slug, html) {
  const $ = cheerio.load(html);
  const title = cleanText($('title').text()).replace(/ - Serebii\.net Pokédex$/i, '');
  const normalizedTitle = title.replace(/ - Serebii\.net.*/i, '').replace(/ - #\d+$/i, '');
  const tables = $('table.dextable').toArray();
  const moveTable = tables.find((table) => cleanText($(table).text()).startsWith('Standard Moves'));
  const movePool = moveTable ? parseMoveTable($, moveTable) : [];
  const forms = [];

  let pendingImages = [];
  let currentForm = null;

  for (const table of tables) {
    const text = cleanText($(table).text());
    const topLevelRows = $(table).children('tbody').children('tr');
    const pictureMarker = cleanText(topLevelRows.first().text());

    if ((pictureMarker.includes('Picture') || text.startsWith('Picture')) && $(table).find('img').length) {
      pendingImages = $(table)
        .find('img')
        .map((_, image) => toAbsoluteUrl($(image).attr('src') ?? ''))
        .get()
        .filter((src) => src.endsWith('.png') || src.endsWith('.gif'));
      continue;
    }

    const firstRowText = cleanText($(table).find('tr').first().text());
    if (firstRowText.startsWith('Name') && firstRowText.includes('Type')) {
      currentForm = parseFormTable($, table, pendingImages);
      forms.push(currentForm);
      pendingImages = [];
      continue;
    }

    if (!currentForm) {
      continue;
    }

    if (text.startsWith('Abilities:')) {
      currentForm.abilities = parseAbilityTable($, table);
      continue;
    }

    if (text.startsWith('Damage Taken')) {
      currentForm.damageTaken = parseDamageTakenTable($, table);
      continue;
    }

    if (text.startsWith('Stats')) {
      const stats = parseStatTable($, table);
      const statsHeading = cleanText($(table).find('h2').text()).replace(/^Stats\s*-?\s*/i, '');
      let targetForm = currentForm;

      if (statsHeading && !currentForm.displayName.endsWith(statsHeading)) {
        const variantName = `${currentForm.displayName} ${statsHeading}`.replace(/\s+/g, ' ').trim();
        targetForm = forms.find((form) => form.displayName === variantName);

        if (!targetForm) {
          targetForm = {
            ...currentForm,
            id: variantName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            displayName: variantName,
          };

          if (statsHeading === 'Blade Forme') {
            targetForm.sprite = currentForm.sprite.replace('.png', '-b.png');
            targetForm.shinySprite = currentForm.shinySprite.replace('.png', '-b.png');
          }

          forms.push(targetForm);
        }
      }

      targetForm.baseStats = stats.baseStats;
      targetForm.neutralRanges = stats.neutralRanges;
    }
  }

  return {
    slug,
    name: forms[0]?.displayName ?? normalizedTitle,
    movePool,
    forms: forms.map((form) => ({
      ...form,
      movePool,
      abilities: form.abilities ?? [],
      damageTaken: form.damageTaken ?? {},
      baseStats: form.baseStats ?? {
        hp: 0,
        attack: 0,
        defense: 0,
        specialAttack: 0,
        specialDefense: 0,
        speed: 0,
      },
    })),
  };
}

function parseItems(html) {
  const $ = cheerio.load(html);
  const categoryMap = ['held', 'mega-stone', 'berry', 'ticket'];

  return $('table')
    .toArray()
    .map((table, index) => {
      const rows = $(table).find('tr').toArray().slice(1);
      return rows.map((row) => {
        const cells = $(row).children('td').toArray();
        if (cells.length < 4) {
          return null;
        }

        const name = cleanText($(cells[1]).text());
        const effect = cleanText($(cells[2]).text());
        const location = cleanText($(cells[3]).text());
        if (!name) {
          return null;
        }

        return {
          id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name,
          effect,
          location,
          category: categoryMap[index] ?? 'misc',
        };
      });
    })
    .flat()
    .filter(Boolean);
}

function parseUpdatedMoves(html) {
  const $ = cheerio.load(html);
  const table = $('table.tab').first();
  const rows = table.find('tr').toArray().slice(1);
  const changes = [];

  for (let index = 0; index < rows.length; index += 2) {
    const championsRow = rows[index];
    const svRow = rows[index + 1];
    if (!championsRow || !svRow) {
      continue;
    }

    const championsCells = $(championsRow).children('td').toArray();
    const svCells = $(svRow).children('td').toArray();

    changes.push({
      name: cleanText($(championsCells[0]).text()),
      champions: {
        type: parseTypesFromCell($, championsCells[2])[0] ?? 'Normal',
        pp: Number(cleanText($(championsCells[4]).text()) || 0),
        power: cleanText($(championsCells[5]).text()) === '--' ? null : Number(cleanText($(championsCells[5]).text())),
        accuracy: cleanText($(championsCells[6]).text()) === '101' ? null : Number(cleanText($(championsCells[6]).text()) || 0),
        effectChance: Number(cleanText($(championsCells[8]).text()) || 0),
      },
      scarletViolet: {
        type: parseTypesFromCell($, svCells[1])[0] ?? 'Normal',
        pp: Number(cleanText($(svCells[2]).text()) || 0),
        power: cleanText($(svCells[3]).text()) === '--' ? null : Number(cleanText($(svCells[3]).text())),
        accuracy: cleanText($(svCells[4]).text()) === '101' ? null : Number(cleanText($(svCells[4]).text()) || 0),
        effectChance: Number(cleanText($(svCells[5]).text()) || 0),
      },
      description: cleanText($(championsCells[7]).text()),
    });
  }

  return changes;
}

function parseMechanics(html) {
  const releaseDateMatch = html.match(/<b>Global<\/b>:\s*([^<]+)/i);
  const levelText = 'All ranked battles normalize Pokémon to Level 50';

  return {
    releaseDate: releaseDateMatch ? cleanText(releaseDateMatch[1]) : 'April 8th 2026',
    battleLevel: 50,
    ivPolicy: 'Fixed as if all IVs are 31; no IV adjustment visible in training',
    trainingCosts: {
      statPoint: '2 VP per Stat Point',
      move: '100 VP per move',
      nature: '200 VP',
      ability: '400 VP',
    },
    notes: [
      levelText,
      'Pokemon Champions training allows stat, move, nature, and ability edits through VP.',
      'This project uses the standard mainline level-50 damage formula with Champions species, move, and item data.',
    ],
  };
}

function buildMegaStoneMap(items) {
  return items.reduce((result, item) => {
    if (item.category !== 'mega-stone') {
      return result;
    }

    const speciesMatch = item.effect.match(/An? ([A-Za-z0-9 .\'-]+) holding this stone/i);
    if (speciesMatch) {
      const speciesName = speciesMatch[1].replace(/\s+/g, ' ').trim();
      result[speciesName] = item.name;
    }

    return result;
  }, {});
}

async function fetchSpeciesData(slugs) {
  const results = [];
  const queue = [...slugs];
  const concurrency = 8;

  async function worker() {
    while (queue.length) {
      const slug = queue.shift();
      if (!slug) {
        break;
      }

      const html = await fetchText(`${ROOT}/pokedex-champions/${slug}/`);
      results.push(parsePokemonPage(slug, html));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  results.sort((left, right) => left.slug.localeCompare(right.slug));
  return results;
}

function flattenPokemon(speciesData, megaStoneMap) {
  return speciesData.flatMap((species) =>
    species.forms.map((form) => ({
      ...form,
      speciesSlug: species.slug,
      baseSpecies: species.name,
      megaStone: form.isMega ? megaStoneMap[species.name] ?? null : null,
    })),
  );
}

async function main() {
  const [pokemonListHtml, itemsHtml, trainingHtml, updatedMovesHtml] = await Promise.all([
    readLocalHtml('pokemon-list.html'),
    readLocalHtml('items.html'),
    readLocalHtml('training.html'),
    readLocalHtml('updated-attacks.html'),
  ]);

  const slugs = parsePokemonSlugs(pokemonListHtml);
  const species = await fetchSpeciesData(slugs);
  const items = parseItems(itemsHtml);
  const megaStoneMap = buildMegaStoneMap(items);
  const pokemon = flattenPokemon(species, megaStoneMap);
  const moves = [...new Map(
    species.flatMap((entry) => entry.movePool).map((move) => [move.id, move]),
  ).values()].sort((left, right) => left.name.localeCompare(right.name));

  const output = {
    generatedAt: new Date().toISOString(),
    sourcePages: [
      `${ROOT}/pokemonchampions/pokemon.shtml`,
      `${ROOT}/pokemonchampions/items.shtml`,
      `${ROOT}/pokemonchampions/training.shtml`,
      `${ROOT}/pokemonchampions/updatedattacks.shtml`,
    ],
    mechanics: parseMechanics(trainingHtml),
    pokemon,
    moves,
    items,
    updatedMoves: parseUpdatedMoves(updatedMovesHtml),
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`Built champions dataset with ${pokemon.length} selectable forms, ${moves.length} moves, and ${items.length} items.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
