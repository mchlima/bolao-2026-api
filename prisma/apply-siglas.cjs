const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const PROD = process.argv.includes('--prod');
let opts = {};
if (PROD) {
  const m = fs.readFileSync('.env.bak.prod','utf8').match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  opts = { datasources: { db: { url: m[1] } } };
  const ref = (m[1].match(/postgres\.([a-z0-9]+):/)||[])[1];
  if (ref === 'ooukpcqycmmgixvtrkcm') { console.error('ABORT: dev'); process.exit(1); }
  console.log('ALVO: PROD ref='+ref);
} else console.log('ALVO: dev (.env)');
const prisma = new PrismaClient(opts);
// ESPN abbr (espnAbbr) → sigla pt-BR de exibição.
const SIG = {
  USA:'EUA', GER:'ALE', NED:'HOL', ENG:'ING', SCO:'ESC', WAL:'GAL', KOR:'COR',
  PRK:'CRN', CZE:'TCH', RSA:'AFS', KSA:'ARA', UAE:'EAU', CIV:'CDM', JPN:'JAP',
  EGY:'EGI', DEN:'DIN', SWE:'SUE', ECU:'EQU', UKR:'UCR', SRB:'SER', ROU:'ROM',
  QAT:'CAT', IRN:'IRA',
};
(async () => {
  let n = 0;
  for (const [abbr, sig] of Object.entries(SIG)) {
    const r = await prisma.team.updateMany({ where:{ type:'NATIONAL_TEAM', espnAbbr: abbr }, data:{ shortName: sig } });
    if (r.count) { n += r.count; console.log(`  ${abbr} → ${sig} (${r.count})`); }
  }
  console.log(`\n${n} siglas aplicadas.`);
  // verificação: espnAbbr preservado + amostra
  const sample = await prisma.team.findMany({ where:{ shortName:{ in:['EUA','ALE','COR','TCH','AFS'] } }, select:{ shortName:true, espnAbbr:true, name:true } });
  console.log('amostra (sigla | espnAbbr | nome):');
  for (const t of sample) console.log(`  ${t.shortName} | ${t.espnAbbr} | ${t.name}`);
  const nullAbbr = await prisma.team.count({ where:{ espnAbbr: null } });
  console.log(`times com espnAbbr null (deve ser 0): ${nullAbbr}`);
  await prisma.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1)});
