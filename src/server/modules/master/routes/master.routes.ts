import { Router } from 'express';
import { createPartnerRouter } from './partner.routes.js';
import { createCategoryRouter } from './category.routes.js';
import { createUomRouter } from './uom.routes.js';
import { createItemRouter } from './item.routes.js';

export function createMasterRouter(): Router {
  const router = Router();
  router.use('/partners', createPartnerRouter());
  router.use('/categories', createCategoryRouter());
  router.use('/uoms', createUomRouter());
  router.use('/items', createItemRouter());
  return router;
}
