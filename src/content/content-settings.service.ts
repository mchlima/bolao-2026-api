import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const CONFIG_KEY = 'content.config';

export interface ContentConfig {
  paused: boolean;
  dailyBudgetUsd: number; // 0 = sem teto
  maxPerDay: number; // 0 = sem teto
  generateModel: string; // claude-haiku-4-5 | claude-sonnet-4-6 | claude-opus-4-8
  relevanceMin: number; // 0..1
}

export interface DayUsage {
  items: number;
  costUsd: number;
}

const DEFAULTS: ContentConfig = {
  paused: true, // robô começa DESLIGADO — liga de propósito no painel
  dailyBudgetUsd: 1,
  maxPerDay: 50,
  generateModel: 'claude-sonnet-4-6',
  relevanceMin: 0.4,
};

/**
 * Global content-robot config + daily spend tracking. Cost controls live here:
 * the process cron checks paused / daily budget / daily volume before each item,
 * and records real per-call cost (token usage × model price) afterwards.
 */
@Injectable()
export class ContentSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<ContentConfig> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: CONFIG_KEY } });
    return { ...DEFAULTS, ...((row?.value as Partial<ContentConfig> | undefined) ?? {}) };
  }

  async setConfig(patch: Partial<ContentConfig>): Promise<ContentConfig> {
    const next = { ...(await this.getConfig()), ...patch };
    await this.prisma.appSetting.upsert({
      where: { key: CONFIG_KEY },
      update: { value: next as object },
      create: { key: CONFIG_KEY, value: next as object },
    });
    return next;
  }

  async isPaused(): Promise<boolean> {
    return (await this.getConfig()).paused;
  }

  async setPaused(paused: boolean): Promise<{ paused: boolean }> {
    await this.setConfig({ paused });
    return { paused };
  }

  // ── daily usage ──
  private usageKey(date = new Date()): string {
    return `content.usage.${date.toISOString().slice(0, 10)}`;
  }

  async getTodayUsage(): Promise<DayUsage> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: this.usageKey() } });
    return { items: 0, costUsd: 0, ...((row?.value as Partial<DayUsage> | undefined) ?? {}) };
  }

  /** Whether a daily cap is already reached (used to gate manual generation). */
  async capStatus(): Promise<{ over: boolean; message: string }> {
    const cfg = await this.getConfig();
    const u = await this.getTodayUsage();
    if (cfg.dailyBudgetUsd > 0 && u.costUsd >= cfg.dailyBudgetUsd) {
      return { over: true, message: `Teto de gasto do dia atingido (US$ ${cfg.dailyBudgetUsd}). Gerar mesmo assim vai passar do limite.` };
    }
    if (cfg.maxPerDay > 0 && u.items >= cfg.maxPerDay) {
      return { over: true, message: `Limite de ${cfg.maxPerDay} matérias do dia atingido. Gerar mesmo assim vai passar do limite.` };
    }
    return { over: false, message: '' };
  }

  async addUsage(costUsd: number): Promise<void> {
    const key = this.usageKey();
    const cur = await this.getTodayUsage();
    const next: DayUsage = { items: cur.items + 1, costUsd: cur.costUsd + costUsd };
    await this.prisma.appSetting.upsert({
      where: { key },
      update: { value: next as object },
      create: { key, value: next as object },
    });
  }
}
