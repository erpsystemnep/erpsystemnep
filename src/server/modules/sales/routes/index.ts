import { Router } from 'express';
import { createSalesOrderRouter } from './sales_order.routes.js';
import { createSalesReservationRouter } from './sales_reservation.routes.js';
import { createSalesDeliveryRouter } from './sales_delivery.routes.js';
import { createSalesInvoiceRouter } from './sales_invoice.routes.js';
import { createCustomerReceivableRouter } from './customer_receivable.routes.js';
import { createCustomerPaymentRouter } from './customer_payment.routes.js';

export function createSalesRouter(): Router {
  const router = Router();

  router.use('/orders', createSalesOrderRouter());
  router.use('/reservations', createSalesReservationRouter());
  router.use('/deliveries', createSalesDeliveryRouter());
  router.use('/invoices', createSalesInvoiceRouter());
  router.use('/receivables', createCustomerReceivableRouter());
  router.use('/payments', createCustomerPaymentRouter());

  return router;
}


