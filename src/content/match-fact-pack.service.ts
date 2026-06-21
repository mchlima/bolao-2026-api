import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StandingsService } from '../structure/standings.service';

/** Quais blocos de dado entram no pacote (config da fonte; default = tudo ligado). */
export interface PackBlocks {
  identificacao: boolean;
  gols: boolean;
  cartoes: boolean;
  substituicoes: boolean;
  escalacoes: boolean;
  estatisticas: boolean;
  lancesNotaveis: boolean;
  classificacao: boolean;
  proximaRodada: boolean;
  comentariosDoEditor: boolean;
}

export const DEFAULT_BLOCKS: PackBlocks = {
  identificacao: true,
  gols: true,
  cartoes: true,
  substituicoes: true,
  escalacoes: true,
  estatisticas: true,
  lancesNotaveis: true,
  classificacao: true,
  proximaRodada: true,
  comentariosDoEditor: true,
};

const DEFAULT_NOTABLE_CAP = 4;

// Lances que viram TEXTURA (o resto do play-by-play é procedimento e fica de fora).
const NOTABLE_TYPES = ['SAVE', 'WOODWORK', 'VAR', 'PENALTY_MISSED', 'SECOND_YELLOW'];
// Estes são sempre dramáticos → entram todos; SAVE é o que o teto limita.
const ALWAYS_NOTABLE = new Set(['WOODWORK', 'VAR', 'PENALTY_MISSED']);

function faseDoPeriodo(period: number): string {
  if (period <= 1) return '1T';
  if (period === 2) return '2T';
  if (period === 5) return 'PENALTIS';
  return 'PRORROGACAO';
}

/** Data por extenso em pt-BR no fuso de Brasília (dia da semana DERIVADO — não deixa o modelo adivinhar). */
function dataPorExtenso(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/**
 * Monta o "pacote de fatos" de uma partida encerrada a partir do NOSSO banco
 * (placar/gols/cartões/escalação/stats/lances + classificação derivada do grupo e
 * próxima rodada). É a matéria-prima das fontes generativas (MATCH_REPORT): tudo
 * fato estruturado, sem prosa de terceiro — original por construção. Os blocos são
 * selecionáveis na config da fonte (objetivo: flash curto vs. análise completa).
 */
@Injectable()
export class MatchFactPackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly standings: StandingsService,
  ) {}

  async build(
    matchId: string,
    opts: { blocks?: Partial<PackBlocks>; notableCap?: number } = {},
  ): Promise<{ facts: Record<string, unknown>; title: string } | null> {
    const blocks: PackBlocks = { ...DEFAULT_BLOCKS, ...(opts.blocks ?? {}) };
    const cap = Math.max(0, opts.notableCap ?? DEFAULT_NOTABLE_CAP);

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        homeTeam: true,
        awayTeam: true,
        stadium: true,
        season: { include: { competition: true } },
        stage: true,
        group: true,
        round: true,
        events: { include: { player: true, related: true, team: true } },
        stats: { include: { team: true } },
        lineupEntries: { include: { player: true } },
        notes: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!match || match.status !== 'FINISHED' || !match.homeTeam || !match.awayTeam) return null;

    const home = match.homeTeam;
    const away = match.awayTeam;
    const teamName = (id: string | null): string =>
      id === home.id ? home.name : id === away.id ? away.name : '';
    const title = `${home.name} ${match.homeScore} x ${match.awayScore} ${away.name}`;
    const facts: Record<string, unknown> = {};

    if (blocks.identificacao) {
      facts.partida = {
        competicao: match.season?.competition?.name ?? match.season?.name ?? null,
        temporada: match.season?.name ?? null,
        sede: match.season?.location ?? null,
        fase: match.stage?.name ?? match.phaseLabel ?? null,
        grupo: match.group ? `Grupo ${match.group.name}` : null,
        rodada: match.round?.name ?? null,
        data: dataPorExtenso(match.kickoffAt),
        estadio: match.stadium?.name ?? null,
        cidade: match.stadium?.city ?? null,
        publico: match.attendance ?? null,
        arbitro: match.referee ?? null,
        placarFinal: `${home.name} ${match.homeScore}, ${away.name} ${match.awayScore}`,
        formacoes: { [home.name]: match.homeFormation, [away.name]: match.awayFormation },
      };
    }

    // eventos ordenados por relógio
    const events = [...match.events].sort((a, b) => a.clockValue - b.clockValue);

    if (blocks.gols) {
      facts.gols = events
        .filter((e) => ['GOAL', 'OWN_GOAL', 'PENALTY_GOAL'].includes(e.type))
        .map((e) => ({
          minuto: e.minute,
          time: teamName(e.teamId),
          autor: e.player?.name ?? null,
          assistencia: e.related?.name ?? null,
          tipo:
            e.type === 'OWN_GOAL'
              ? 'gol contra'
              : e.type === 'PENALTY_GOAL'
                ? 'pênalti'
                : e.detail || null,
        }));
    }

    if (blocks.cartoes) {
      facts.cartoes = events
        .filter((e) => ['YELLOW', 'RED', 'SECOND_YELLOW'].includes(e.type))
        .map((e) => ({
          minuto: e.minute,
          time: teamName(e.teamId),
          jogador: e.player?.name ?? null,
          tipo: e.type === 'RED' ? 'vermelho' : e.type === 'SECOND_YELLOW' ? '2º amarelo' : 'amarelo',
        }));
    }

    if (blocks.substituicoes) {
      facts.substituicoes = events
        .filter((e) => e.type === 'SUBSTITUTION')
        .map((e) => ({
          minuto: e.minute,
          time: teamName(e.teamId),
          entrou: e.player?.name ?? null,
          saiu: e.related?.name ?? null,
        }));
    }

    if (blocks.lancesNotaveis) {
      let saves = 0;
      facts.lancesNotaveis = events
        .filter((e) => NOTABLE_TYPES.includes(e.type))
        .filter((e) => {
          if (ALWAYS_NOTABLE.has(e.type)) return true;
          if (cap === 0) return false;
          saves += 1;
          return saves <= cap; // teto só limita SAVE/2º amarelo (os "comuns")
        })
        .map((e) => ({
          minuto: e.minute,
          fase: faseDoPeriodo(e.period),
          tipo: e.type,
          time: teamName(e.teamId),
          jogador: e.player?.name ?? null,
          detalhe: e.detail || e.text?.slice(0, 120) || null,
        }));
    }

    if (blocks.estatisticas) {
      const byLabel = new Map<string, { label: string; order: number; casa?: string; fora?: string }>();
      for (const s of match.stats) {
        const row = byLabel.get(s.label) ?? { label: s.label, order: s.order };
        if (s.teamId === home.id) row.casa = s.value;
        else if (s.teamId === away.id) row.fora = s.value;
        byLabel.set(s.label, row);
      }
      facts.estatisticas = {
        casa: home.name,
        fora: away.name,
        linhas: [...byLabel.values()]
          .sort((a, b) => a.order - b.order)
          .map(({ label, casa, fora }) => ({ estatistica: label, [home.name]: casa, [away.name]: fora })),
      };
    }

    if (blocks.escalacoes) {
      const side = (teamId: string) =>
        match.lineupEntries
          .filter((l) => l.teamId === teamId && l.isStarter)
          .sort((a, b) => (a.formationPlace ?? 0) - (b.formationPlace ?? 0))
          .map((l) => ({
            nome: l.player?.name ?? null,
            numero: l.jersey,
            posicao: l.position,
            saiu: l.subbedOut || undefined,
            amarelo: l.yellow > 0 || undefined,
          }));
      facts.escalacoes = {
        [home.name]: { formacao: match.homeFormation, titulares: side(home.id) },
        [away.name]: { formacao: match.awayFormation, titulares: side(away.id) },
      };
    }

    if (blocks.classificacao && match.stageId && match.groupId) {
      const tabela = await this.groupTable(match.stageId, match.groupId);
      if (tabela) facts.classificacao = tabela;
    }

    if (blocks.proximaRodada && match.groupId) {
      const prox = await this.nextRound(match.groupId, match.id);
      if (prox.length) facts.proximaRodada = prox;
    }

    // Observações do admin narrando ao vivo — entram como fato (cor/contexto humano).
    // Prefixa o tempo do jogo quando informado (ex.: "67' — pressão total").
    if (blocks.comentariosDoEditor && match.notes.length) {
      facts.comentariosDoEditor = match.notes.map((n) =>
        n.minute ? `${n.minute} — ${n.text}` : n.text,
      );
    }

    return { facts, title };
  }

  /** Tabela do grupo (reusa o StandingsService — mesmo critério de desempate do app). */
  private async groupTable(
    stageId: string,
    groupId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const stage = await this.standings.stageStandings(stageId);
      const group = stage.groups.find((g) => g.groupId === groupId);
      if (!group) return null;
      return {
        momento: 'após os jogos já encerrados',
        grupo: group.groupName,
        tabela: group.rows.map((r) => ({
          pos: r.position,
          time: r.team.name,
          pontos: r.points,
          jogos: r.played,
          v: r.wins,
          e: r.draws,
          d: r.losses,
          gp: r.goalsFor,
          gc: r.goalsAgainst,
          sg: r.goalDiff,
        })),
      };
    } catch {
      return null; // classificação é opcional — nunca derruba a geração
    }
  }

  /** Próximos jogos AGENDADOS do grupo (o que está em jogo na sequência). */
  private async nextRound(groupId: string, excludeMatchId: string): Promise<unknown[]> {
    const upcoming = await this.prisma.match.findMany({
      where: { groupId, status: 'SCHEDULED', id: { not: excludeMatchId } },
      orderBy: { kickoffAt: 'asc' },
      take: 6,
      include: { homeTeam: true, awayTeam: true, round: true },
    });
    return upcoming.map((m) => ({
      rodada: m.round?.name ?? null,
      data: dataPorExtenso(m.kickoffAt),
      mandante: m.homeTeam?.name ?? m.homeSourceLabel ?? null,
      visitante: m.awayTeam?.name ?? m.awaySourceLabel ?? null,
    }));
  }
}
