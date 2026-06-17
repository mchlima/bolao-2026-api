import { Injectable, Logger } from '@nestjs/common';

/**
 * Fire-and-forget operational alerts to a single webhook (set ALERT_WEBHOOK_URL).
 * Provider is detected from the URL: a Discord webhook gets a JSON `{content}`;
 * anything else is sent as plain text with ntfy-style headers (ntfy.sh works with
 * no account — just pick a topic URL). No-op when the env var is unset; never
 * throws, so an alert failure can't break the caller (the robots keep running).
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly url = process.env.ALERT_WEBHOOK_URL?.trim();

  async notify(title: string, message: string, priority: 'default' | 'high' = 'default'): Promise<void> {
    if (!this.url) return;
    const isDiscord = /discord(app)?\.com/i.test(this.url);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
        ...(isDiscord
          ? {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ content: `**${title}**\n${message}` }),
            }
          : {
              // ntfy: ASCII-only headers (Title/Priority/Tags); UTF-8 body is fine.
              headers: {
                'content-type': 'text/plain; charset=utf-8',
                Title: title,
                Priority: priority === 'high' ? 'high' : 'default',
                Tags: 'warning',
              },
              body: message,
            }),
      });
      if (!res.ok) this.logger.warn(`alert webhook responded ${res.status}`);
    } catch (e) {
      this.logger.warn(`alert webhook failed: ${(e as Error).message}`);
    }
  }
}
