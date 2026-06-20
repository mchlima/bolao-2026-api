// Seeds the content pipeline: 3 editorial voices (tons) + 3 RSS feeds.
// Idempotent (upsert on slug/url) — safe to re-run. Tone promptText is the voice
// guide injected into generation; edit freely later in the admin CRUD.
//   npx ts-node --project prisma/tsconfig.seed.json prisma/seed-content.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TONES = [
  {
    slug: 'informativo-dinamico',
    name: 'Informativo Dinâmico',
    description: 'Direto, jovem e ágil. Neutro, sem opinião.',
    promptText:
      'Você escreve no estilo informativo dinâmico: direto, jovem e ágil. Manchete ' +
      'enxuta e o essencial nas primeiras linhas (o quê, quem, quando). Linguagem ' +
      'casual mas neutra, sem gíria forte e sem opinião. Frases objetivas, leitura ' +
      'rápida no celular. Zero enrolação.',
  },
  {
    slug: 'analista-tatico',
    name: 'Analista Tático',
    description: 'Profissional, técnico e didático.',
    promptText:
      'Você escreve como um analista tático profissional e didático. Tom sóbrio, sem ' +
      'gírias. Explique o PORQUÊ por trás do fato: esquema tático, marcação, ocupação ' +
      'de espaços, transições, peças-chave. Contextualize com leitura de jogo, sempre ' +
      'preso aos fatos fornecidos. Nada de opinião de torcedor; análise fria e clara ' +
      'para quem quer entender futebol além do placar.',
  },
  {
    slug: 'corneteiro-raiz',
    name: 'Corneteiro Raiz',
    description: 'Humor, sarcasmo e gírias de torcedor.',
    promptText:
      'Você escreve como um corneteiro de mesa de bar: torcedor raiz, ácido e ' +
      'bem-humorado. Use gírias de futebol (frango, pintura, balançar as redes, ' +
      'pendurar as chuteiras), ironia e provocação leve. Frases curtas, com punch. ' +
      'Pode zoar o desempenho dos times e as situações, mas NUNCA ofenda pessoas de ' +
      'verdade, não use palavrão pesado e não faça ataque pessoal. O humor é sempre ' +
      'em cima do fato — jamais invente nada.',
  },
];

const FEEDS = [
  {
    // Feed atual do ge.globo (o antigo AS0-4271 era arquivo morto: notícia velha + links 404).
    name: 'ge.globo — Futebol',
    url: 'https://pox.globo.com/rss/ge/futebol/',
    type: 'RSS',
    isActive: true,
  },
  {
    // WordPress: entrega o artigo completo via content:encoded (sem precisar de crawl).
    name: 'Gazeta Esportiva',
    url: 'https://www.gazetaesportiva.com/feed/',
    type: 'RSS',
    isActive: true,
  },
  {
    // Página de seção — entra como crawl (PAGE), inativa até ajustar o linkPattern na config.
    name: 'UOL Esporte — Futebol',
    url: 'https://www.uol.com.br/esporte/futebol/ultimas/',
    type: 'PAGE',
    isActive: false,
  },
];

async function main(): Promise<void> {
  const toneIdBySlug = new Map<string, string>();
  for (const t of TONES) {
    const tone = await prisma.newsTone.upsert({
      where: { slug: t.slug },
      update: { name: t.name, description: t.description }, // não sobrescreve promptText editado
      create: { slug: t.slug, name: t.name, description: t.description, promptText: t.promptText },
    });
    toneIdBySlug.set(t.slug, tone.id);
    console.log(`tom: ${tone.name}`);
  }

  const defaultToneId = toneIdBySlug.get('informativo-dinamico');
  for (const f of FEEDS) {
    const feed = await prisma.newsFeed.upsert({
      where: { url: f.url },
      update: { name: f.name, type: f.type },
      create: { name: f.name, url: f.url, type: f.type, isActive: f.isActive, defaultToneId },
    });
    console.log(`feed: ${feed.name} (${feed.isActive ? 'ativo' : 'inativo'})`);
  }
}

main()
  .then(() => console.log('✅ seed de conteúdo concluído'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
