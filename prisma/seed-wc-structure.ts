// Derives the formal competition structure (Stages → Groups/Rounds → Ties) for a
// World Cup-style season from its already-seeded matches (phaseLabel/groupName/
// sourceLabel free-text). Idempotent: it deletes any existing structure for the
// season and rebuilds — match FKs (stageId/groupId/roundId/tieId) are ON DELETE
// SET NULL, so deleting stages auto-clears them.
//
// Reused by prisma/seed.ts and runnable standalone:
//   ts-node --project prisma/tsconfig.seed.json prisma/seed-wc-structure.ts
import { PrismaClient, Prisma } from '@prisma/client';

const GROUP_STAGE_LABEL = 'Fase de Grupos';

// Canonical knockout round order (matches the labels in data/wc2026-matches.ts).
const KO_ORDER = [
  '16-avos de final',
  'Oitavas de final',
  'Quartas de final',
  'Semifinais',
  'Disputa de 3º lugar',
  'Final',
];

type SlotSource =
  | { type: 'GROUP_POSITION'; groupId: string; position: number }
  | { type: 'BEST_RANKED'; stageId: string; winnerGroup?: string; eligibleGroups: string[]; position?: number }
  | { type: 'MATCH_WINNER'; tieId: string }
  | { type: 'MATCH_LOSER'; tieId: string };

// Parse a pt-BR bracket slot label into a typed feeder. Returns null when the
// label doesn't match a known pattern (left as display-only).
function parseFeeder(
  label: string | null,
  ctx: {
    groupByLetter: Map<string, string>;
    groupStageId: string | null;
    tieByMatchNumber: Map<number, string>;
  },
): SlotSource | null {
  if (!label) return null;
  let m: RegExpMatchArray | null;

  if ((m = label.match(/^Vencedor Jogo (\d+)$/))) {
    const tieId = ctx.tieByMatchNumber.get(Number(m[1]));
    return tieId ? { type: 'MATCH_WINNER', tieId } : null;
  }
  if ((m = label.match(/^Perdedor Jogo (\d+)$/))) {
    const tieId = ctx.tieByMatchNumber.get(Number(m[1]));
    return tieId ? { type: 'MATCH_LOSER', tieId } : null;
  }
  if ((m = label.match(/^Vencedor Grupo ([A-L])$/))) {
    const groupId = ctx.groupByLetter.get(m[1]);
    return groupId ? { type: 'GROUP_POSITION', groupId, position: 1 } : null;
  }
  if ((m = label.match(/^(\d+)º Grupo ([A-L])$/))) {
    const groupId = ctx.groupByLetter.get(m[2]);
    return groupId ? { type: 'GROUP_POSITION', groupId, position: Number(m[1]) } : null;
  }
  // "3º (A/B/C/D/F)" — best-ranked third among eligible groups (World Cup 2026).
  // The exact FIFA combination table assignment is resolved later / by admin.
  if ((m = label.match(/^3º \(([A-L/]+)\)$/)) && ctx.groupStageId) {
    return {
      type: 'BEST_RANKED',
      stageId: ctx.groupStageId,
      eligibleGroups: m[1].split('/'),
    };
  }
  return null;
}

export async function seedWc2026Structure(
  prisma: PrismaClient,
  seasonId: string,
): Promise<void> {
  // Idempotent rebuild: drop existing structure (cascades to groups/rounds/ties;
  // match FKs SET NULL). Then rebuild from the season's matches.
  await prisma.stage.deleteMany({ where: { seasonId } });

  const matches = await prisma.match.findMany({
    where: { seasonId },
    select: {
      id: true,
      matchNumber: true,
      phaseLabel: true,
      groupName: true,
      homeTeamId: true,
      awayTeamId: true,
      homeSourceLabel: true,
      awaySourceLabel: true,
      kickoffAt: true,
    },
    orderBy: { matchNumber: 'asc' },
  });

  const groupMatches = matches.filter((m) => m.phaseLabel === GROUP_STAGE_LABEL);
  const koMatches = matches.filter((m) => m.phaseLabel !== GROUP_STAGE_LABEL);

  // ── Group stage ────────────────────────────────────────────────────────────
  let groupStageId: string | null = null;
  const groupByLetter = new Map<string, string>();
  if (groupMatches.length) {
    const stage = await prisma.stage.create({
      data: {
        seasonId,
        name: GROUP_STAGE_LABEL,
        format: 'GROUP',
        order: 1,
        tiebreakPreset: 'FIFA',
        hasThirdPlace: false,
      },
    });
    groupStageId = stage.id;

    const letters = [...new Set(groupMatches.map((m) => m.groupName).filter(Boolean) as string[])].sort();
    for (const [i, letter] of letters.entries()) {
      const group = await prisma.group.create({
        data: { stageId: stage.id, name: letter, order: i + 1 },
      });
      groupByLetter.set(letter, group.id);
    }

    // Matchday rounds: within each group, sort by kickoff and pair into matchdays
    // (groups of 4 → 6 matches → 3 matchdays of 2). FIFA schedules a group's MD1
    // before MD2, so date order yields the correct matchday.
    const maxMatchday = 3;
    const roundByMatchday = new Map<number, string>();
    for (let md = 1; md <= maxMatchday; md++) {
      const round = await prisma.round.create({
        data: { stageId: stage.id, number: md, name: `Rodada ${md}`, legs: 1, order: md },
      });
      roundByMatchday.set(md, round.id);
    }

    // Group → its matches (sorted), GroupTeam membership, and per-match links.
    const teamsByGroup = new Map<string, Set<string>>();
    for (const letter of letters) {
      const gMatches = groupMatches
        .filter((m) => m.groupName === letter)
        .sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());
      const groupId = groupByLetter.get(letter)!;
      const teamSet = teamsByGroup.get(letter) ?? new Set<string>();
      teamsByGroup.set(letter, teamSet);

      for (const [idx, m] of gMatches.entries()) {
        const matchday = Math.floor(idx / 2) + 1;
        await prisma.match.update({
          where: { id: m.id },
          data: { stageId: stage.id, groupId, roundId: roundByMatchday.get(matchday) ?? null },
        });
        if (m.homeTeamId) teamSet.add(m.homeTeamId);
        if (m.awayTeamId) teamSet.add(m.awayTeamId);
      }
    }
    for (const [letter, teamSet] of teamsByGroup) {
      const groupId = groupByLetter.get(letter)!;
      for (const teamId of teamSet) {
        await prisma.groupTeam.create({ data: { groupId, teamId } });
      }
    }
  }

  // ── Knockout stage ─────────────────────────────────────────────────────────
  if (koMatches.length) {
    const stage = await prisma.stage.create({
      data: {
        seasonId,
        name: 'Mata-mata',
        format: 'KNOCKOUT',
        order: 2,
        tiebreakPreset: 'GENERIC',
        hasThirdPlace: koMatches.some((m) => m.phaseLabel === 'Disputa de 3º lugar'),
      },
    });

    // One round per distinct knockout phase label, in canonical order.
    const koLabels = [...new Set(koMatches.map((m) => m.phaseLabel).filter(Boolean) as string[])].sort(
      (a, b) => {
        const ia = KO_ORDER.indexOf(a);
        const ib = KO_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      },
    );
    const roundByLabel = new Map<string, string>();
    for (const [i, label] of koLabels.entries()) {
      const round = await prisma.round.create({
        data: { stageId: stage.id, name: label, legs: 1, order: i + 1 },
      });
      roundByLabel.set(label, round.id);
    }

    // Pass 1: create one Tie per knockout match (single leg). Map matchNumber → tie.
    const tieByMatchNumber = new Map<number, string>();
    const tieIdByMatchId = new Map<string, string>();
    let order = 0;
    for (const m of koMatches) {
      const roundId = roundByLabel.get(m.phaseLabel as string)!;
      const tie = await prisma.tie.create({
        data: {
          roundId,
          order: order++,
          homeTeamId: m.homeTeamId,
          awayTeamId: m.awayTeamId,
          homeSourceLabel: m.homeSourceLabel,
          awaySourceLabel: m.awaySourceLabel,
        },
      });
      if (m.matchNumber != null) tieByMatchNumber.set(m.matchNumber, tie.id);
      tieIdByMatchId.set(m.id, tie.id);
    }

    // Pass 2: resolve typed feeders (now all tie ids exist) and link matches.
    const ctx = { groupByLetter, groupStageId, tieByMatchNumber };
    // groupId → letter, to tag each BEST_RANKED slot with the winner group it faces
    // (the column key into the Annex C table).
    const letterByGroupId = new Map<string, string>();
    for (const [letter, id] of groupByLetter) letterByGroupId.set(id, letter);
    const winnerLetterOf = (s: SlotSource | null): string | undefined =>
      s?.type === 'GROUP_POSITION' && s.position === 1
        ? letterByGroupId.get(s.groupId)
        : undefined;

    for (const m of koMatches) {
      const tieId = tieIdByMatchId.get(m.id)!;
      const homeSource = parseFeeder(m.homeSourceLabel, ctx);
      const awaySource = parseFeeder(m.awaySourceLabel, ctx);
      // The third-placed slot faces a group winner; record that winner's letter.
      if (awaySource?.type === 'BEST_RANKED') awaySource.winnerGroup = winnerLetterOf(homeSource);
      if (homeSource?.type === 'BEST_RANKED') homeSource.winnerGroup = winnerLetterOf(awaySource);
      await prisma.tie.update({
        where: { id: tieId },
        data: {
          homeSource: (homeSource as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          awaySource: (awaySource as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });
      await prisma.match.update({
        where: { id: m.id },
        data: { stageId: stage.id, roundId: roundByLabel.get(m.phaseLabel as string)!, tieId, leg: 1 },
      });
    }
  }

  const stageCount = await prisma.stage.count({ where: { seasonId } });
  console.log(
    `✓ structure: ${stageCount} stages, ${groupByLetter.size} groups, ${koMatches.length} knockout ties`,
  );
}

// Standalone runner: build structure for the World Cup season (by competition slug).
if (require.main === module) {
  const prisma = new PrismaClient();
  (async () => {
    const season = await prisma.season.findFirst({
      where: { competition: { slug: 'fifa.world' } },
      orderBy: { createdAt: 'desc' },
    });
    if (!season) throw new Error('No fifa.world season found — seed matches first.');
    await seedWc2026Structure(prisma, season.id);
  })()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
