export interface MythosSession {
  userId: string;
  email: string;
  displayName: string;
  listingId: string;
  sessionJti: string;
}

export interface MythosConfig {
  listingIds: string[];
  apiUrl: string;
}

declare global {
  namespace Express {
    interface Request {
      mythos?: MythosSession;
    }
  }
}
