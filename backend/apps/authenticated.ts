// Only endpoints with authentication are included.

import { auth, errorHandler } from '../middleware';
import app from './base';
import memo from '../services/memo/router';

app.use(auth);
app.use('/memo', memo);
app.use(errorHandler);

export default app;
