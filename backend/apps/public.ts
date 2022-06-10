// Only endpoints without authentication are included.

import { errorHandler } from '../middleware';
import app from './base';
import stats from '../services/stats/router';

app.use('/public/stats', stats);
app.use(errorHandler);

export default app;
