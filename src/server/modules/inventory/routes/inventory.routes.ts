import { Router } from 'express';
import { createQcRouter } from './qc.routes.js';
import { createStockRouter } from './stock.routes.js';

export function createInventoryRouter(): Router {
  const router = Router();
  router.use('/qc-inspections', createQcRouter());
  router.use('/', createStockRouter());
  return router;
}
