import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    // O pooler (Supabase) pode recusar conexões NOVAS por janelas curtas (reboot,
    // limite de conexões, blip de rede). Em vez de derrubar o boot no primeiro
    // P1001, retenta — assim a API sobe assim que abrir uma janela boa.
    const maxAttempts = 30;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        if (attempt > 1) this.logger.log(`Conectado ao banco na tentativa ${attempt}.`);
        return;
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        this.logger.warn(
          `Falha ao conectar no banco (tentativa ${attempt}/${maxAttempts}): ${
            (err as Error).message?.split('\n')[0]
          }. Retentando em 3s…`,
        );
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
