export type Lang = string; // ISO 639-1 code

// One conversation per language pair. The pair is canonical (sourceLang is the
// lexicographically smaller code) and writeLang is the half the visitor is
// writing in now — flipped by the swap button, never by reordering the pair
// (see prisma/schema.prisma, Conversation).
export interface Conversation {
  id: string;
  sourceLang: string;
  targetLang: string;
  writeLang: string;
  lastUsedAt: string;
  createdAt: string;
}

// What GET /api/conversation returns: the stored row plus its turns, or — when
// the pair has no history yet — a synthetic row with a null id and no turns.
// The row itself is created only once something is actually sent.
export interface ConversationDetail {
  id: string | null;
  sourceLang: string;
  targetLang: string;
  writeLang: string;
  translations: HistoryRow[];
}

export interface HistoryRow {
  id: string;
  sourceLang: string;
  transcript: string;
  translation: string;
  createdAt: string;
}
