/** Client-safe shape returned by GET/POST `/api/guest/session`. */
export type GuestUsage = { remaining: number; limit: number; sessionId: string };
