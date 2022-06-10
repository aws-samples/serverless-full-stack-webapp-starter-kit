import express from 'express';
import { cors } from '../middleware';
const app = express();

app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors);

// HeathCheck API
app.get('/health_check', (req, res) => {
  res.send('ok');
});

export default app;
