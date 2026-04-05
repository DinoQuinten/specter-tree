import express from 'express';

const app = express();

function authMiddleware(req: unknown, res: unknown, next: () => void): void {
  next();
}

function getUsers(req: unknown, res: unknown): void {}

function createUser(req: unknown, res: unknown): void {}

app.use(express.json());
app.use('/api', authMiddleware);
app.get('/api/users', getUsers);
app.post('/api/users', createUser);

export default app;
