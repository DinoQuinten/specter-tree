import type { User } from './authService';

export interface Request {
  headers: Record<string, string>;
  user?: User;
}

export interface Response {
  status(code: number): this;
  json(data: unknown): void;
}

export function authMiddleware(req: Request, res: Response, next: () => void): void {
  const token = req.headers['authorization'];
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
