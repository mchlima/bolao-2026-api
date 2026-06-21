import { Prisma } from '@prisma/client';
import { TermSeoDto } from './dto/news-taxonomy.dto';

/**
 * Normaliza o pacote SEO/GEO de um termo (categoria/tag) para gravar como JSON:
 * tira espaços, descarta campos vazios e FAQ incompleta. Retorna null quando não
 * sobra nada de útil — assim o admin "limpa" o SEO mandando tudo vazio.
 */
export function cleanTermSeo(seo: TermSeoDto | null | undefined): Prisma.InputJsonValue | null {
  if (!seo) return null;
  const out: Record<string, unknown> = {};
  const str = (v?: string) => (v ?? '').trim();
  if (str(seo.metaTitle)) out.metaTitle = str(seo.metaTitle);
  if (str(seo.metaDescription)) out.metaDescription = str(seo.metaDescription);
  if (str(seo.heading)) out.heading = str(seo.heading);
  if (str(seo.intro)) out.intro = str(seo.intro);
  const faq = (seo.faq ?? [])
    .map((q) => ({ question: str(q.question), answer: str(q.answer) }))
    .filter((q) => q.question && q.answer);
  if (faq.length) out.faq = faq;
  return Object.keys(out).length ? (out as Prisma.InputJsonValue) : null;
}
