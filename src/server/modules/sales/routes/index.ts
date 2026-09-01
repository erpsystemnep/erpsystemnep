import { Router } from 'express';
import { createSalesOrderRouter } from './sales_order.routes.js';
import { createSalesReservationRouter } from './sales_reservation.routes.js';
import { createSalesDeliveryRouter } from './sales_delivery.routes.js';
import { createSalesInvoiceRouter } from './sales_invoice.routes.js';

export function createSalesRouter(): Router {
  const router = Router();

  router.use('/orders', createSalesOrderRouter());
  router.use('/reservations', createSalesReservationRouter());
  router.use('/deliveries', createSalesDeliveryRouter());
  router.use('/invoices', createSalesInvoiceRouter());

  return router;
}

