import { Router } from 'express';
import { createPurchaseOrderRouter } from './purchase_order.routes.js';
import { createPurchaseReceiptRouter } from './purchase_receipt.routes.js';
import { createPurchaseReturnRouter } from './purchase_return.routes.js';
import { createPurchaseInvoiceRouter } from './purchase_invoice.routes.js';
import { createSupplierPayableRouter } from './supplier_payable.routes.js';
import { createSupplierPaymentRouter } from './supplier_payment.routes.js';

export function createPurchaseRouter(): Router {
  const router = Router();
  router.use('/orders', createPurchaseOrderRouter());
  router.use('/receipts', createPurchaseReceiptRouter());
  router.use('/returns', createPurchaseReturnRouter());
  router.use('/invoices', createPurchaseInvoiceRouter());
  router.use('/payables', createSupplierPayableRouter());
  router.use('/payments', createSupplierPaymentRouter());
  return router;
}
