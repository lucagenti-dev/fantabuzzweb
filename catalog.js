const XLSX = require('xlsx');

const SEASON = '2026/2027';

const TEAM_NAMES = {
  ATA: 'Atalanta',
  BOL: 'Bologna',
  CAG: 'Cagliari',
  COM: 'Como',
  FIO: 'Fiorentina',
  FRO: 'Frosinone',
  GEN: 'Genoa',
  INT: 'Inter',
  JUV: 'Juventus',
  LAZ: 'Lazio',
  LEC: 'Lecce',
  MIL: 'Milan',
  MON: 'Monza',
  NAP: 'Napoli',
  PAR: 'Parma',
  ROM: 'Roma',
  SAS: 'Sassuolo',
  TOR: 'Torino',
  UDI: 'Udinese',
  VEN: 'Venezia'
};

function cleanText(value, maxLength = 100) {
  return String(value ?? '').replace(/[<>]/g, '').trim().slice(0, maxLength);
}

function normalizedHeader(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findColumn(headers, aliases, excluded = []) {
  const normalizedAliases = aliases.map(normalizedHeader);
  return headers.findIndex((header) => {
    if (excluded.some((term) => header.includes(normalizedHeader(term)))) return false;
    return normalizedAliases.includes(header);
  });
}

function normalizeTeam(value) {
  const team = cleanText(value, 50);
  return TEAM_NAMES[team.toUpperCase()] || team;
}

function parseWorkbookBuffer(buffer, originalName = 'listone.xlsx') {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames.find((name) => normalizedHeader(name) === 'tutti') || workbook.SheetNames[0];
  if (!sheetName) throw new Error('Il file Excel non contiene fogli leggibili');

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
  const headerIndex = rows.findIndex((row) => {
    const cells = row.map(normalizedHeader);
    return cells.some((cell) => ['nome', 'calciatore'].includes(cell)) &&
      cells.some((cell) => ['squadra', 'team', 'sq'].includes(cell));
  });
  if (headerIndex < 0) throw new Error('Intestazioni non riconosciute nel listone');

  const headers = rows[headerIndex].map(normalizedHeader);
  const columns = {
    id: findColumn(headers, ['id', 'codice', 'codice calciatore']),
    name: findColumn(headers, ['nome', 'calciatore']),
    team: findColumn(headers, ['squadra', 'team', 'sq']),
    role: findColumn(headers, ['r', 'ruolo', 'ruolo classic', 'classic']),
    currentQuotation: findColumn(headers, ['qt a', 'qa', 'quotazione attuale', 'quota attuale', 'quotazione']),
    initialQuotation: findColumn(headers, ['qt i', 'qi', 'quotazione iniziale', 'quota iniziale']),
    fvm: findColumn(headers, ['fvm', 'fvm 1000', 'fvm classic'], ['mantra'])
  };

  for (const required of ['name', 'team', 'role']) {
    if (columns[required] < 0) throw new Error(`Colonna obbligatoria mancante: ${required}`);
  }

  const players = rows.slice(headerIndex + 1).map((row, index) => {
    const role = cleanText(row[columns.role], 8).toUpperCase().charAt(0);
    const quotation = columns.currentQuotation >= 0 ? Number(row[columns.currentQuotation]) || 0 : 0;
    const initialQuotation = columns.initialQuotation >= 0
      ? Number(row[columns.initialQuotation]) || 0
      : quotation;
    return {
      id: cleanText(columns.id >= 0 ? row[columns.id] : `xls-${index + 1}`, 40) || `xls-${index + 1}`,
      name: cleanText(row[columns.name], 80),
      team: normalizeTeam(row[columns.team]),
      role,
      quotation,
      initialQuotation,
      fvm: columns.fvm >= 0 ? Number(row[columns.fvm]) || 0 : 0
    };
  }).filter((player) => player.name && player.team && ['P', 'D', 'C', 'A'].includes(player.role));

  if (!players.length) throw new Error('Nessun calciatore Classic valido trovato');

  return {
    season: SEASON,
    source: cleanText(originalName, 160),
    updatedAt: new Date().toISOString(),
    players
  };
}

module.exports = { SEASON, TEAM_NAMES, parseWorkbookBuffer };
