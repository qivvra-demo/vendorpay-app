import express from 'express';
import { join } from 'path';
import { errorHandler, notFound } from './errors';
import { log } from './logger';
import { auditRouter } from './routes/audit';
import { bankChangesRouter } from './routes/bankChanges';
import { authRouter } from './routes/auth';
import { metaRouter } from './routes/meta';
import { paymentsRouter } from './routes/payments';
import { suppliersRouter } from './routes/suppliers';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api/')) log('info', 'request', { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started });
    });
    next();
  });

  app.use('/', metaRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/audit-events', auditRouter);
  app.use('/api', bankChangesRouter);
  app.use('/api', (_req, _res, next) => next(notFound('Endpoint')));

  app.use(express.static(join(__dirname, '..', 'public')));
  app.use(errorHandler);
  return app;
}
