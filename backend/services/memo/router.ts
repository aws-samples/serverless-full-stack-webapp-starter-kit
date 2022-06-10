import express from 'express';
import { wrap } from '../../common/express';
import * as c from './controller';

const router = express.Router();
router.get('/', wrap(c.getMemos));
router.post('/', wrap(c.createMemo));
router.post('/delete', wrap(c.deleteMemo));
router.post('/run', wrap(c.runSampleJob));

export default router;
