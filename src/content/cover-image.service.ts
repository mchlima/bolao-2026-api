import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const W = 1200;
const H = 630;
const CREST = 220; // tamanho do escudo
const HOME_CX = 340; // centro horizontal do escudo mandante
const AWAY_CX = 860; // centro horizontal do escudo visitante
const CREST_CY = 300; // centro vertical dos escudos

/** Hex (com/sem #) → "#rrggbb" válido, senão null. */
function hex(c?: string | null): string | null {
  if (!c) return null;
  const v = c.replace(/^#/, '').trim();
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v}`;
  if (/^[0-9a-fA-F]{3}$/.test(v)) return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`;
  return null;
}
function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
}

type CoverMatch = {
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: { name: string; shortName: string; logoUrl: string | null; color: string | null } | null;
  awayTeam: { name: string; shortName: string; logoUrl: string | null; color: string | null } | null;
  season: { name: string; competition: { name: string | null } | null } | null;
};

/**
 * Gera a CAPA de uma matéria de jogo (escudos + placar + competição) e sobe pro R2.
 * Server-side com sharp: um SVG pinta fundo (gradiente das cores dos times) + textos,
 * e os escudos (PNG do R2) são compostos por cima. Tudo best-effort — falhou, sem capa.
 */
@Injectable()
export class CoverImageService {
  private readonly log = new Logger(CoverImageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Capa a partir do matchId; null se não der (sem times/escudos, storage off, erro). */
  async forMatch(matchId: string): Promise<string | null> {
    if (!this.storage.configured) return null;
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        status: true, homeScore: true, awayScore: true,
        homeTeam: { select: { name: true, shortName: true, logoUrl: true, color: true } },
        awayTeam: { select: { name: true, shortName: true, logoUrl: true, color: true } },
        season: { select: { name: true, competition: { select: { name: true } } } },
      },
    });
    if (!match?.homeTeam || !match.awayTeam) return null;
    try {
      const buffer = await this.compose(match);
      if (!buffer) return null;
      return await this.storage.uploadRaw(buffer, 'covers');
    } catch (e) {
      this.log.warn(`Falha ao gerar capa do jogo ${matchId}: ${(e as Error).message}`);
      return null;
    }
  }

  /** Baixa um escudo e devolve PNG quadrado (transparência preservada); null se falhar. */
  private async crest(url: string | null): Promise<Buffer | null> {
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await sharp(Buffer.from(await res.arrayBuffer()))
        .resize(CREST, CREST, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch {
      return null;
    }
  }

  private async compose(m: CoverMatch): Promise<Buffer | null> {
    const home = m.homeTeam!;
    const away = m.awayTeam!;
    const played = m.status === 'LIVE' || m.status === 'FINISHED';
    const score = played ? `${m.homeScore ?? 0} – ${m.awayScore ?? 0}` : '×';
    const comp = esc((m.season?.competition?.name || m.season?.name || 'Cravei').replace(/\bFIFA\b/gi, '').replace(/\s+/g, ' ').trim().toUpperCase());
    const hc = hex(home.color) ?? '#0fb36b';
    const ac = hex(away.color) ?? '#1e7ff0';

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${hc}" stop-opacity="0.5"/>
          <stop offset="0.5" stop-color="#0b1018" stop-opacity="1"/>
          <stop offset="1" stop-color="${ac}" stop-opacity="0.5"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="#0b1018"/>
      <rect width="${W}" height="${H}" fill="url(#bg)"/>
      <rect x="0" y="0" width="${W}" height="6" fill="#f4b81e"/>
      <text x="${W / 2}" y="92" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="30" letter-spacing="3" fill="#cfd6e0">${comp}</text>
      <text x="${W / 2}" y="335" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="120" fill="#ffffff">${esc(score)}</text>
      <text x="${HOME_CX}" y="470" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="40" fill="#ffffff">${esc(home.shortName || home.name)}</text>
      <text x="${AWAY_CX}" y="470" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="40" fill="#ffffff">${esc(away.shortName || away.name)}</text>
      <text x="${W / 2}" y="585" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="34" letter-spacing="4" fill="#f4b81e">CRAVEI</text>
    </svg>`;

    const [hCrest, aCrest] = await Promise.all([this.crest(home.logoUrl), this.crest(away.logoUrl)]);
    const layers: sharp.OverlayOptions[] = [];
    if (hCrest) {
      const meta = await sharp(hCrest).metadata();
      layers.push({ input: hCrest, left: Math.round(HOME_CX - (meta.width ?? CREST) / 2), top: Math.round(CREST_CY - (meta.height ?? CREST) / 2) });
    }
    if (aCrest) {
      const meta = await sharp(aCrest).metadata();
      layers.push({ input: aCrest, left: Math.round(AWAY_CX - (meta.width ?? CREST) / 2), top: Math.round(CREST_CY - (meta.height ?? CREST) / 2) });
    }

    return sharp(Buffer.from(svg)).composite(layers).webp({ quality: 86 }).toBuffer();
  }
}
