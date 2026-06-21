// Backfill one-off: cada NewsItem já APPROVED (público hoje) vira um Post PUBLISHED
// no CMS, preservando o que está no ar. Idempotente — pula itens que já têm Post
// (sourceItemId). Depois marca o NewsItem como PROMOTED.
// Rodar: node --env-file=.env prisma/scripts/backfill-posts.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** generatedText = "manchete\n\ncorpo" → title + body. */
function splitArticle(text) {
  const lines = (text ?? '').split('\n');
  return { title: (lines[0] ?? '').trim(), body: lines.slice(1).join('\n').trim() };
}

/** Mantém só o pacote SEO do artigo (o resto vira coluna/relação no Post). */
function postSeo(seo) {
  const s = seo ?? {};
  const out = {};
  for (const k of ['metaTitle', 'metaDescription', 'focusKeyword', 'keywords', 'keyTakeaways', 'faq', 'imageAlt']) {
    if (s[k] != null) out[k] = s[k];
  }
  return Object.keys(out).length ? out : null;
}

async function main() {
  const items = await prisma.newsItem.findMany({
    where: { status: 'APPROVED', slug: { not: null } },
    include: { tags: { select: { id: true } } },
  });
  console.log(`Itens APPROVED com slug: ${items.length}`);

  let created = 0;
  let skipped = 0;
  for (const it of items) {
    const exists = await prisma.post.findUnique({ where: { sourceItemId: it.id } });
    if (exists) {
      skipped++;
      continue;
    }
    const { title, body } = splitArticle(it.generatedText);
    const seo = it.seo ?? {};
    await prisma.post.create({
      data: {
        title: title || it.sourceTitle,
        slug: it.slug,
        dek: seo.dek ?? null,
        body,
        seo: postSeo(seo) ?? undefined,
        status: 'PUBLISHED',
        publishedAt: it.reviewedAt ?? it.createdAt,
        categoryId: it.categoryId,
        sourceItemId: it.id,
        ...(it.tags.length ? { tags: { connect: it.tags.map((t) => ({ id: t.id })) } } : {}),
      },
    });
    await prisma.newsItem.update({ where: { id: it.id }, data: { status: 'PROMOTED' } });
    created++;
    console.log(`  ✓ Post criado: ${it.slug}`);
  }
  console.log(`Pronto. Criados: ${created}, pulados (já existiam): ${skipped}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
