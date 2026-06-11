import { PrismaClient, TeamType } from '@prisma/client';
import { hash } from 'bcryptjs';
import { NATIONAL_TEAMS } from './data/national-teams';
import { WC2026_STADIUMS } from './data/wc2026-stadiums';

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

async function main(): Promise<void> {
  console.log('Seeding…');
  await seedAdmin();
  await seedTeams();
  await seedStadiums();
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
