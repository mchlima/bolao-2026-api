/** Nome da room SSE do chat de uma partida dentro de um bolão. O EventsService
 * empurra os eventos do chat (ChatEvent) nessa room; o front assina a mesma. */
export function chatRoom(poolId: string, matchId: string): string {
  return `pool:${poolId}:match:${matchId}:chat`;
}

export interface ChatMessageAuthor {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** Mensagem como servida ao front: autor embutido, sem campos internos. */
export interface ChatMessageView {
  id: string;
  text: string;
  createdAt: string; // ISO
  nonce: string | null; // eco do nonce do cliente p/ casar a mensagem otimista
  author: ChatMessageAuthor;
}

/** Resposta da listagem: mensagens em ordem cronológica + estado da sala. */
export interface ChatListResult {
  messages: ChatMessageView[];
  open: boolean; // janela de escrita aberta agora (ver isChatRoomOpen)
  hasMore: boolean; // há mensagens mais antigas além desta página
  canModerate: boolean; // o viewer pode apagar QUALQUER msg (dono/admin do bolão ou admin global)
  presence: number; // pessoas na sala agora ("X na sala")
}

/**
 * Payload empurrado pelo SSE na room do chat. O cliente faz APPEND num 'msg'
 * (dedup por id/nonce), remove num 'del', e atualiza o contador num 'presence'.
 * Um evento sem payload (reconexão) NÃO passa por aqui — naquele caso o front
 * refaz o fetch e reconcilia com o banco.
 */
export type ChatEvent =
  | { type: 'msg'; message: ChatMessageView }
  | { type: 'del'; id: string }
  | { type: 'presence'; count: number };
