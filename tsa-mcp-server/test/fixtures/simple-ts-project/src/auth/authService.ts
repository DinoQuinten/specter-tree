export interface User {
  id: string;
  email: string;
}

export class AuthService {
  private sessions = new Map<string, User>();

  login(email: string, password: string): User | null {
    if (!email || !password) return null;
    const user: User = { id: crypto.randomUUID(), email };
    this.sessions.set(user.id, user);
    return user;
  }

  logout(userId: string): void {
    this.sessions.delete(userId);
  }

  getSession(userId: string): User | null {
    return this.sessions.get(userId) ?? null;
  }
}
