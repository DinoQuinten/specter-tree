import express from 'express';

const app = express();

app.use(express.json());

app.use('/api', (req, res, next) => {
  // auth middleware
  next();
});

app.get('/api/users', (req, res) => {
  res.json({ users: [] });
});

app.post('/api/users', (req, res) => {
  res.json({ created: true });
});

export default app;
