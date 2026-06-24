/**
 * Fuso de NEGÓCIO do app: onde a "borda do dia" é desenhada — resets diários,
 * buckets (ex.: `content.usage.<data>`) e agregações humanas (gráficos do admin).
 *
 * É REGIONAL de propósito: a virada do dia tem que cair à meia-noite local do
 * operador. UTC porIa a borda às 21h de Brasília (00h UTC) — origem do bug do
 * teto "zerando às 21h".
 *
 * NÃO confundir com o fuso de ARMAZENAMENTO: timestamps no banco seguem UTC
 * (absoluto, sem ambiguidade) e comparações de instante (`sendAt <= now`,
 * `kickoffAt`, cutoff de retenção) continuam em UTC. Este fuso governa só a
 * borda do dia / formatação humana, nunca o storage.
 */
export const APP_TIMEZONE = 'America/Sao_Paulo';

/**
 * Data `YYYY-MM-DD` de um instante, no fuso dado (default = fuso de negócio).
 * `en-CA` formata nesse padrão ISO. Use para chaves de bucket diário e bordas
 * de dia — nunca `toISOString()`, que devolve a data em UTC.
 */
export function dateKeyInTz(date: Date, timeZone: string = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
}
