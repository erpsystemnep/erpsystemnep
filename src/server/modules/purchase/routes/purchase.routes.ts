import { Router } from 'express';
import { createPurchaseOrderRouter } from './purchase_order.routes.js';
import { createPurchaseReceiptRouter } from './purchase_receipt.routes.js';
import { createPurchaseReturnRouter } from './purchase_return.routes.js';

export function createPurchaseRouter(): Router {
  const router = Router();
  router.use('/orders', createPurchaseOrderRouter());
  router.use('/receipts', createPurchaseReceiptRouter());
  router.use('/returns', createPurchaseReturnRouter());
  return router;
}
