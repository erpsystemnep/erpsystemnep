import { StockLedgerRepository } from '../repositories/stock_ledger.repository.js';
import {
  StockLedgerFilterInput,
  StockBalanceFilterInput,
} from '../../../../shared/schemas/inventory.js';
import {
  StockLedgerEntry,
  StockBalanceSummary,
} from '../../../../shared/types/index.js';

export class StockLedgerService {
  private stockRepo = new StockLedgerRepository();

  async getEntries(
    companyId: string,
    filters?: Partial<StockLedgerFilterInput>
  ): Promise<{ data: StockLedgerEntry[]; total: number }> {
    return this.stockRepo.listEntries(companyId, {
      warehouseId: filters?.warehouseId,
      itemId: filters?.itemId,
      batchId: filters?.batchId,
      stockStatus: filters?.stockStatus,
      movementType: filters?.movementType,
      page: filters?.page,
      limit: filters?.limit,
    });
  }

  async getBalanceSummary(
    companyId: string,
    filters?: Partial<StockBalanceFilterInput>
  ): Promise<StockBalanceSummary[]> {
    return this.stockRepo.getBalanceSummary(companyId, {
      warehouseId: filters?.warehouseId,
      itemId: filters?.itemId,
    });
  }
}
