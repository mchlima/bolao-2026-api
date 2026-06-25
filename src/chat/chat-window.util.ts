import { MatchStatus } from '@prisma/client';
import { dateKeyInTz } from '../common/timezone';

/** Campos da partida necessários p/ decidir se a sala aceita escrita. */
export interface ChatWindowMatch {
  status: MatchStatus;
  kickoffAt: Date;
  finishedAt: Date | null;
}

/**
 * A sala do chat abre só "no dia ou durante a partida":
 *  - enquanto LIVE — cobre o jogo que começa num dia e termina no outro;
 *  - no dia do kickoff (conversa pré-jogo incluída);
 *  - no dia em que o jogo TERMINOU, quando termina num dia diferente do kickoff.
 *
 * As bordas de dia seguem o fuso de NEGÓCIO (America/Sao_Paulo) via dateKeyInTz —
 * nunca UTC, que jogaria a virada do dia p/ 21h de Brasília. Função pura, avaliada
 * a cada escrita; não precisa de cron nem de "abrir/fechar" sala.
 *
 * Fora da janela a LEITURA do histórico continua liberada; só a ESCRITA é barrada.
 */
export function isChatRoomOpen(match: ChatWindowMatch, now: Date): boolean {
  if (match.status === MatchStatus.LIVE) return true;
  const today = dateKeyInTz(now);
  if (today === dateKeyInTz(match.kickoffAt)) return true;
  if (match.finishedAt && today === dateKeyInTz(match.finishedAt)) return true;
  return false;
}
