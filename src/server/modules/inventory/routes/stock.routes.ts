import { Router, Request, Response, NextFunction } from 'express';
import { StockLedgerService } from '../services/stock_ledger.service.js';
import { BatchRepository } from '../repositories/batch.repository.js';
import {
  stockLedgerFilterSchema,
  stockBalanceFilterSchema,
} from '../../../../shared/schemas/inventory.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createStockRouter(
  stockService: StockLedgerService = new StockLedgerService(),
  batchRepo: BatchRepository = new BatchRepository()
): Router {
  const router = Router();

  // Stock Ledger Entries
  router.get(
    '/stock-ledger',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.stock.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.securityContext!.activeCompanyId!;
        const validated = stockLedgerFilterSchema.parse({
          ...req.query,
          companyId,
        });
        const result = await stockService.getEntries(companyId, validated);
        res.json({
          success: true,
          data: result.data,
          meta: {
            total: result.total,
            page: validated.page,
            limit: validated.limit,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Stock Balance Summaries (Real-time computed multi-status stock matrix)
  router.get(
    '/stock-balances',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.stock.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.securityContext!.activeCompanyId!;
        const validated = stockBalanceFilterSchema.parse({
          ...req.query,
          companyId,
        });
        const data = await stockService.getBalanceSummary(companyId, validated);
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  // Batches
  router.get(
    '/batches',
    requireAuth,
    requireActiveCompany,
    requirePermission('inventory.batch.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = req.securityContext!.activeCompanyId!;
        const { itemId, supplierId, search } = req.query;
        const data = await batchRepo.list(companyId, {
          itemId: itemId ? String(itemId) : undefined,
          supplierId: supplierId ? String(supplierId) : undefined,
          search: search ? String(search) : undefined,
        });
        res.json({ success: true, data });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
