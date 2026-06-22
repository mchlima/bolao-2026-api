import { Injectable, Logger } from '@nestjs/common';

/**
 * Notifica os buscadores que suportam IndexNow (Bing, Yandex, etc.) das URLs que
 * mudaram — o "ping" moderno (o ping de sitemap do Google foi descontinuado em 2023;
 * pro Google o que vale é o sitemap de notícias com data fresca + Search Console).
 * Fail-soft: nunca derruba a publicação. No-op em dev (host local/sem https).
 */
@Injectable()
export class IndexNowService {
  private readonly logger = new Logger(IndexNowService.name);
  private readonly key = process.env.INDEXNOW_KEY || '9f2c7b6e4d1a4f08b3e5c0a7d2f16e84';
  // Só liga quando PUBLIC_SITE_URL está definido (prod). Em dev fica vazio = no-op,
  // pra não pingar URLs reais a partir do ambiente local.
  private readonly site = (process.env.PUBLIC_SITE_URL || '').replace(/\/$/, '');

  async submit(paths: string[]): Promise<void> {
    try {
      if (!this.site.startsWith('https://') || !paths.length) return; // sem PUBLIC_SITE_URL: no-op
      const host = new URL(this.site).host;
      const urlList = [...new Set(paths)].map((p) => `${this.site}${p}`);
      const res = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          host,
          key: this.key,
          keyLocation: `${this.site}/${this.key}.txt`,
          urlList,
        }),
      });
      this.logger.log(`IndexNow ${res.status} p/ ${urlList.length} url(s)`);
    } catch (e) {
      this.logger.warn(`IndexNow falhou: ${(e as Error).message}`);
    }
  }
}
