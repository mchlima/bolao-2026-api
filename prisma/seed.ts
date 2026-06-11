import { PrismaClient, TeamType } from '@prisma/client';
import { hash } from 'bcryptjs';
import { NATIONAL_TEAMS } from './data/national-teams';
import { WC2026_STADIUMS } from './data/wc2026-stadiums';
import {
  VENUE_UTC_OFFSET,
  WC2026_MATCHES,
  WC2026_TOURNAMENT,
} from './data/wc2026-matches';

const prisma = new PrismaClient();

async function seedAdmin(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@bolao2026.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345';
  const name = process.env.SEED_ADMIN_NAME ?? 'Administrador';

  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.warn(
      `⚠  SEED_ADMIN_PASSWORD não definido — usando senha padrão "admin12345" para ${email}. TROQUE depois.`,
    );
  }

  await prisma.user.upsert({
    where: { email },
    // Re-seeding never resets an existing admin's password.
    update: { role: 'ADMIN', isActive: true },
    create: {
      name,
      email,
      passwordHash: await hash(password, 10),
      role: 'ADMIN',
      isActive: true,
    },
  });
  console.log(`✓ admin: ${email}`);
}

async function seedTeams(): Promise<void> {
  for (const t of NATIONAL_TEAMS) {
    await prisma.team.upsert({
      where: { countryCode: t.countryCode },
      update: {
        name: t.name,
        shortName: t.shortName,
        continent: t.continent,
        type: TeamType.NATIONAL_TEAM,
      },
      create: {
        name: t.name,
        shortName: t.shortName,
        countryCode: t.countryCode,
        continent: t.continent,
        type: TeamType.NATIONAL_TEAM,
      },
    });
  }
  console.log(`✓ national teams: ${NATIONAL_TEAMS.length}`);
}

async function seedStadiums(): Promise<void> {
  for (const s of WC2026_STADIUMS) {
    await prisma.stadium.upsert({
      where: { name_city: { name: s.name, city: s.city } },
      update: { state: s.state, country: s.country },
      create: s,
    });
  }
  console.log(`✓ WC2026 stadiums: ${WC2026_STADIUMS.length}`);
}

async function seedWorldCup(): Promise<void> {
  // Tournament (idempotent by name — Tournament.name is not unique in the schema).
  const data = {
    name: WC2026_TOURNAMENT.name,
    startDate: new Date(WC2026_TOURNAMENT.startDate),
    endDate: new Date(WC2026_TOURNAMENT.endDate),
    status: WC2026_TOURNAMENT.status,
  };
  const existing = await prisma.tournament.findFirst({
    where: { name: data.name },
  });
  const tournament = existing
    ? await prisma.tournament.update({ where: { id: existing.id }, data })
    : await prisma.tournament.create({ data });

  // Lookups: countryCode → team id, stadium name → id.
  const teams = await prisma.team.findMany({
    select: { id: true, countryCode: true },
  });
  const teamByCode = new Map(
    teams
      .filter((t): t is { id: string; countryCode: string } => !!t.countryCode)
      .map((t) => [t.countryCode, t.id]),
  );
  const stadiums = await prisma.stadium.findMany({
    select: { id: true, name: true },
  });
  const stadiumByName = new Map(stadiums.map((s) => [s.name, s.id]));

  const resolveTeam = (code: string | null): string | null => {
    if (!code) return null;
    const id = teamByCode.get(code);
    if (!id) throw new Error(`Seed: team not found for countryCode "${code}"`);
    return id;
  };

  for (const m of WC2026_MATCHES) {
    const stadiumId = stadiumByName.get(m.venue);
    if (!stadiumId) throw new Error(`Seed: stadium not found "${m.venue}"`);
    const offset = VENUE_UTC_OFFSET[m.venue] ?? '+00:00';
    // Research-derived local kickoff times were ~1h early (user-confirmed against the
    // official schedule); shift +1h. Times remain best-effort (decision #14) — admin can fine-tune.
    const kickoffAt = new Date(
      new Date(`${m.date}T${m.time}:00${offset}`).getTime() + 60 * 60 * 1000,
    );

    const matchData = {
      tournamentId: tournament.id,
      matchNumber: m.matchNumber,
      kickoffAt,
      stadiumId,
      phaseLabel: m.phaseLabel,
      groupName: m.group,
      homeTeamId: resolveTeam(m.homeCode),
      awayTeamId: resolveTeam(m.awayCode),
      homeSourceLabel: m.homeLabel,
      awaySourceLabel: m.awayLabel,
    };

    await prisma.match.upsert({
      where: {
        tournamentId_matchNumber: {
          tournamentId: tournament.id,
          matchNumber: m.matchNumber,
        },
      },
      update: matchData,
      create: matchData,
    });
  }
  console.log(
    `✓ tournament "${tournament.name}" + ${WC2026_MATCHES.length} matches`,
  );
}

async function main(): Promise<void> {
  console.log('Seeding…');
  await seedAdmin();
  await seedTeams();
  await seedStadiums();
  await seedWorldCup();
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
