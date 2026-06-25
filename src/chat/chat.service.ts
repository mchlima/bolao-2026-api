import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolMemberRole, Prisma, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import type { SafeUser } from '../users/user.types';
import { ChatWindowMatch, isChatRoomOpen } from './chat-window.util';
import { ChatListResult, ChatMessageView, chatRoom } from './chat.types';

const MAX_PAGE = 50;
const RATE_MAX = 5; // mensagens…
const RATE_WINDOW_MS = 10_000; // …por 10s, por usuário

const messageSelect = {
  id: true,
  text: true,
  nonce: true,
  createdAt: true,
  user: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.ChatMessageSelect;

type MessageRow = Prisma.ChatMessageGetPayload<{
  select: typeof messageSelect;
}>;

@Injectable()
export class ChatService {
  // Janela deslizante de timestamps por usuário (anti-spam). In-memory de propósito:
  // um restart zera, o que é correto — não há streams vivos após reinício. Entradas
  // velhas são podadas no acesso, então não acumula.
  private readonly rate = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  /** Histórico da sala (página mais recente; paginação p/ trás via `before`). */
  async list(
    user: SafeUser,
    poolId: string,
    matchId: string,
    opts: { before?: string; limit?: number },
  ): Promise<ChatListResult> {
    const match = await this.authorize(user.id, poolId, matchId);
    const take = Math.min(Math.max(opts.limit ?? MAX_PAGE, 1), MAX_PAGE);
    const where: Prisma.ChatMessageWhereInput = {
      poolId,
      matchId,
      deletedAt: null,
      ...(opts.before && { createdAt: { lt: new Date(opts.before) } }),
    };
    // Busca desc (mais novas primeiro) com +1 p/ saber se há mais antigas.
    const rows = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      select: messageSelect,
    });
    const hasMore = rows.length > take;
    const page = (hasMore ? rows.slice(0, take) : rows).reverse(); // cronológica p/ exibir
    return {
      messages: page.map(toView),
      open: isChatRoomOpen(match, new Date()),
      hasMore,
    };
  }

  /** Posta uma mensagem (janela aberta + anti-spam) e empurra no SSE da sala. */
  async post(
    user: SafeUser,
    poolId: string,
    matchId: string,
    input: { text: string; nonce?: string },
  ): Promise<ChatMessageView> {
    const match = await this.authorize(user.id, poolId, matchId);
    const text = input.text.trim();
    if (!text)
      throw new HttpException('Mensagem vazia.', HttpStatus.BAD_REQUEST);
    if (!isChatRoomOpen(match, new Date()))
      throw new ForbiddenException('A sala deste jogo está fechada.');
    this.checkRate(user.id);

    const row = await this.prisma.chatMessage.create({
      data: {
        poolId,
        matchId,
        userId: user.id,
        text,
        nonce: input.nonce ?? null,
      },
      select: messageSelect,
    });
    const view = toView(row);
    this.events.publish(chatRoom(poolId, matchId), {
      type: 'msg',
      message: view,
    });
    return view;
  }

  /** Soft-delete (autor, dono/admin do bolão ou admin global) + audit + SSE 'del'. */
  async remove(user: SafeUser, messageId: string): Promise<void> {
    const msg = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        userId: true,
        poolId: true,
        matchId: true,
        deletedAt: true,
        text: true,
      },
    });
    if (!msg || msg.deletedAt)
      throw new NotFoundException('Mensagem não encontrada.');
    await this.assertCanModerate(user, msg.userId, msg.poolId);

    await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedById: user.id },
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'CHAT_MESSAGE_DELETE',
      entityType: 'ChatMessage',
      entityId: messageId,
      diff: { text: { before: msg.text, after: null } },
    });
    if (msg.poolId)
      this.events.publish(chatRoom(msg.poolId, msg.matchId), {
        type: 'del',
        id: messageId,
      });
  }

  // ───────────────────────────────────────────────────────────────── helpers

  /** O usuário pode ver/escrever na sala? Precisa ser membro do bolão E a partida
   * pertencer a alguma temporada (PoolRun) desse bolão. Devolve os campos da
   * partida usados pela janela. */
  private async authorize(
    userId: string,
    poolId: string,
    matchId: string,
  ): Promise<ChatWindowMatch> {
    const member = await this.prisma.poolMember.findUnique({
      where: { poolId_userId: { poolId, userId } },
      select: { id: true },
    });
    if (!member)
      throw new ForbiddenException('Você não participa deste bolão.');

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        status: true,
        kickoffAt: true,
        finishedAt: true,
        seasonId: true,
      },
    });
    if (!match) throw new NotFoundException('Partida não encontrada.');

    const run = await this.prisma.poolRun.findFirst({
      where: { poolId, seasonId: match.seasonId },
      select: { id: true },
    });
    if (!run)
      throw new ForbiddenException('Esta partida não faz parte deste bolão.');

    return {
      status: match.status,
      kickoffAt: match.kickoffAt,
      finishedAt: match.finishedAt,
    };
  }

  private async assertCanModerate(
    user: SafeUser,
    authorId: string,
    poolId: string | null,
  ): Promise<void> {
    if (user.id === authorId) return; // autor apaga a própria
    if (user.role === UserRole.ADMIN) return; // admin global
    if (poolId) {
      const member = await this.prisma.poolMember.findUnique({
        where: { poolId_userId: { poolId, userId: user.id } },
        select: { role: true },
      });
      if (
        member &&
        (member.role === PoolMemberRole.OWNER ||
          member.role === PoolMemberRole.ADMIN)
      )
        return;
    }
    throw new ForbiddenException('Sem permissão para apagar esta mensagem.');
  }

  private checkRate(userId: string): void {
    const now = Date.now();
    const hits = (this.rate.get(userId) ?? []).filter(
      (t) => now - t < RATE_WINDOW_MS,
    );
    if (hits.length >= RATE_MAX)
      throw new HttpException(
        'Você está enviando mensagens rápido demais.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    hits.push(now);
    this.rate.set(userId, hits);
  }
}

function toView(row: MessageRow): ChatMessageView {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    nonce: row.nonce,
    author: {
      id: row.user.id,
      name: row.user.name,
      avatarUrl: row.user.avatarUrl,
    },
  };
}
