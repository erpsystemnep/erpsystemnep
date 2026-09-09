import { Router } from 'express';
import { createQcRouter } from './qc.routes.js';
import { createStockRouter } from './stock.routes.js';
import { createValuationRouter } from './valuation.routes.js';

export function createInventoryRouter(): Router {
  const router = Router();
  router.use('/qc-inspections', createQcRouter());
  router.use('/valuation', createValuationRouter());
  router.use('/', createStockRouter());
  return router;
}
