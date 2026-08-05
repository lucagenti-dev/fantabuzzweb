const fs = require('fs');
const path = require('path');
const { parseWorkbookBuffer } = require('./catalog');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.join(__dirname, 'players.json');

if (!inputPath) {
  console.error('Uso: node generate-players.js <listone.xlsx> [players.json]');
  process.exit(1);
}

const catalog = parseWorkbookBuffer(fs.readFileSync(inputPath), path.basename(inputPath));
fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Creato ${outputPath}: ${catalog.players.length} calciatori (${catalog.season})`);
