import express, { Request, Response, NextFunction } from 'express';
import { extractSecurityContext } from './middleware/auth.js';
import { createAuthRouter } from './modules/auth/routes/auth.routes.js';
import { createOrgRouter } from './modules/org/routes/org.routes.js';
import { createNumberingRouter } from './modules/numbering/routes/numbering.routes.js';
import { createAuditRouter } from './modules/audit/routes/audit.routes.js';
import { createMasterRouter } from './modules/master/routes/master.routes.js';
import { checkDatabaseHealth } from './db/connection.js';
import { config } from './config.js';
import { AppError } from '../shared/errors/AppError.js';

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(extractSecurityContext);

  // Health Check
  app.get('/api/health', async (req: Request, res: Response) => {
    const dbHealth = await checkDatabaseHealth();
    const isHealthy = dbHealth.connected;

    const payload = {
      status: isHealthy ? 'healthy' : 'degraded',
      service: 'multi-company-erp-core',
      environment: config.NODE_ENV,
      timestamp: new Date().toISOString(),
      database: dbHealth,
    };

    res.status(isHealthy ? 200 : 503).json(payload);
  });

  // Authentication & Identity Routes
  app.use('/api/v1/auth', createAuthRouter());
  app.use('/api/auth', createAuthRouter());

  // Organization Domain Routes
  app.use('/api/v1/org', createOrgRouter());
  app.use('/api/org', createOrgRouter());

  // Numbering Series Infrastructure Routes
  app.use('/api/v1/numbering', createNumberingRouter());
  app.use('/api/numbering', createNumberingRouter());

  // Audit Trail Infrastructure Routes
  app.use('/api/v1/audit', createAuditRouter());
  app.use('/api/audit', createAuditRouter());

  // Master Data Domain Routes (Increment 0.8)
  app.use('/api/v1/master', createMasterRouter());
  app.use('/api/master', createMasterRouter());

  // Global Error Handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }

    console.error('Unhandled server error:', err);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: err.message || 'An unexpected error occurred',
      },
    });
  });

  return app;
}
