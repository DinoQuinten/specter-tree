import type { User } from '../auth/authService';

const store: User[] = [];

export function getUsers(): User[] {
  return store;
}

export function createUser(email: string): User {
  const user: User = { id: crypto.randomUUID(), email };
  store.push(user);
  return user;
}

export function getUserById(id: string): User | null {
  return store.find(u => u.id === id) ?? null;
}
