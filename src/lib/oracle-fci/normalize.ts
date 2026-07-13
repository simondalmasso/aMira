// src/lib/oracle-fci/normalize.ts
// Map raw ArgentinadatosFund → NormalizedFund + dedup by name (max date)

import { ArgentinadatosFund, FundCategory, NormalizedFund } from './types';

const MANAGER_PATTERNS: Array<{ pattern: string; manager: string }> = [
  { pattern: 'SANTANDER', manager: 'Santander Asset Management S.G.F.C.I.S.A.' },
  { pattern: 'SUPER AHORRO', manager: 'Santander Asset Management S.G.F.C.I.S.A.' },
  { pattern: 'SUPERAHORRO', manager: 'Santander Asset Management S.G.F.C.I.S.A.' },
  { pattern: 'SUPERFONDO', manager: 'Santander Asset Management S.G.F.C.I.S.A.' },
  { pattern: 'SUPERGESTION', manager: 'Santander Asset Management S.G.F.C.I.S.A.' },
  { pattern: 'SUPERBONOS', manager: 'Santander Asset Management S.G.F.C.I.S.A.' },
  { pattern: 'FIMA', manager: 'Fima S.G.F.C.I. (Banco Galicia)' },
  { pattern: 'GALICIA', manager: 'Banco Galicia S.G.F.C.I.' },
  { pattern: 'SBS', manager: 'SBS Administradora General de Fondos' },
  { pattern: 'ADCAP', manager: 'Adcap S.A. S.G.F.C.I.' },
  { pattern: 'ALPHA', manager: 'Alpha Administradora (ICBC)' },
  { pattern: 'ICBC', manager: 'ICBC Argentina S.G.F.C.I.' },
  { pattern: 'TORONTO', manager: 'Toronto Trust S.G.F.C.I.' },
  { pattern: 'MAF', manager: 'MAF S.A. S.G.F.C.I.' },
  { pattern: 'IAM', manager: 'IAM Argentina S.G.F.C.I.' },
  { pattern: 'CONSULTATIO', manager: 'Consultatio Asset Management' },
  { pattern: 'DELTA', manager: 'Delta Asset Management' },
  { pattern: 'GALILEO', manager: 'Galileo Administradora de Fondos' },
  { pattern: 'MEGAINVER', manager: 'Megainver S.A. S.G.F.C.I.' },
  { pattern: 'FIRST', manager: 'First Asset Management' },
  { pattern: 'ALLARIA', manager: 'Allaria Ledesma S.G.F.C.I.' },
  { pattern: 'COMPASS', manager: 'Compass Asset Management' },
  { pattern: 'BAVSA', manager: 'BAVSA Sociedad Gerente' },
  { pattern: 'PIONERO', manager: 'Pionero S.G.F.C.I.' },
  { pattern: 'GESTIONAR', manager: 'Gestionar S.G.F.C.I.' },
  { pattern: 'BALANZ', manager: 'BALanz Capital S.G.F.C.I.' },
  { pattern: 'BIND', manager: 'Banco Industrial S.G.F.C.I.' },
  { pattern: 'MONS', manager: 'Montserrat Capital S.G.F.C.I.' },
  { pattern: 'FYP', manager: 'FYP S.G.F.C.I.' },
  { pattern: 'RONDA', manager: 'Ronda Capital S.G.F.C.I.' },
  { pattern: 'OUTSPAN', manager: 'Outspan S.G.F.C.I.' },
  { pattern: 'MEDIFOLIO', manager: 'Medifolio S.G.F.C.I.' },
  { pattern: 'MEDINOL', manager: 'Medifolio S.G.F.C.I.' },
  { pattern: 'CONDOR', manager: 'Fondo Condor S.G.F.C.I.' },
  { pattern: 'APSA', manager: 'APSA S.G.F.C.I.' },
  { pattern: 'BICE', manager: 'BICE Inversiones S.G.F.C.I.' },
  { pattern: 'HIPOTECARIO', manager: 'Banco Hipotecario S.G.F.C.I.' },
  { pattern: 'CIEM', manager: 'CIEM S.G.F.C.I.' },
  { pattern: 'CULTIFONDO', manager: 'Cultifondo S.G.F.C.I.' },
  { pattern: 'AIA', manager: 'AIA S.G.F.C.I.' },
  { pattern: 'ANDA', manager: 'ANDA S.G.F.C.I.' },
  { pattern: 'BACS', manager: 'BACS S.G.F.C.I.' },
  { pattern: 'BMA', manager: 'BMA S.G.F.C.I.' },
  { pattern: 'BANELCO', manager: 'Banelco S.G.F.C.I.' },
  { pattern: 'BBVA', manager: 'BBVA Asset Management S.G.F.C.I.' },
  { pattern: 'FRANCES', manager: 'BBVA Asset Management S.G.F.C.I.' },
  { pattern: 'MACRO', manager: 'Banco Macro S.G.F.C.I.' },
  { pattern: 'CIUDAD', manager: 'Banco Ciudad S.G.F.C.I.' },
  { pattern: 'NACIÓN', manager: 'Banco Nación S.G.F.C.I.' },
  { pattern: 'NACION', manager: 'Banco Nación S.G.F.C.I.' },
  { pattern: 'PROVINCIAS', manager: 'Banco Provincias S.G.F.C.I.' },
  { pattern: 'PROVINCIA', manager: 'Banco Provincia S.G.F.C.I.' },
  { pattern: 'PATAGONIA', manager: 'Banco Patagonia S.G.F.C.I.' },
  { pattern: 'SUPERVIELLE', manager: 'Banco Supervielle S.G.F.C.I.' },
  { pattern: 'CREDICOOP', manager: 'Banco Credicoop S.G.F.C.I.' },
  { pattern: 'FBA', manager: 'FBA Asset Management' },
  { pattern: 'FCI', manager: 'FCI Administradora' },
];

function inferManager(name: string): string {
  const upper = name.toUpperCase();
  for (const { pattern, manager } of MANAGER_PATTERNS) {
    if (upper.includes(pattern)) return manager;
  }
  return 'Otros / No identificado';
}

function inferCurrency(name: string): 'ARS' | 'USD' {
  const upper = name.toUpperCase();
  if (
    upper.includes(' DOLAR') ||
    upper.includes('DÓLAR') ||
    upper.includes(' USD') ||
    upper.includes('DOLLAR') ||
    upper.includes(' U$S')
  ) {
    return 'USD';
  }
  return 'ARS';
}

/**
 * Deduplicate records by fund name, keeping the one with the most recent date.
 * Returns NormalizedFund array sorted by patrimonio desc.
 */
export function normalizeAndDeduplicate(
  raw: ArgentinadatosFund[],
  category: FundCategory,
  categoryLabel: string,
): NormalizedFund[] {
  const byName = new Map<string, ArgentinadatosFund>();
  for (const item of raw) {
    const name = (item.fondo ?? '').trim();
    if (!name) continue;
    const prev = byName.get(name);
    if (!prev || item.fecha > prev.fecha) {
      byName.set(name, item);
    }
  }

  const funds: NormalizedFund[] = [];
  for (const [name, item] of byName) {
    funds.push({
      name,
      category,
      categoryLabel,
      horizonte: item.horizonte ?? '',
      date: item.fecha,
      vcp: item.vcp,
      ccp: item.ccp,
      patrimonio: item.patrimonio,
      currency: inferCurrency(name),
      manager: inferManager(name),
    });
  }

  funds.sort((a, b) => b.patrimonio - a.patrimonio);
  return funds;
}
