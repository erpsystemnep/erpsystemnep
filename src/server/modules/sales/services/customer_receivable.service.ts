import pg from 'pg';
import { CustomerReceivableRepository } from '../repositories/customer_receivable.repository.js';
import {
  CustomerReceivable,
  CustomerReceivableStatus,
  SecurityContext,
} from '../../../../shared/types/index.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export class CustomerReceivableService {
  constructor(
    private receivableRepo: CustomerReceivableRepository = new CustomerReceivableRepository()
  ) {}

  private assertTenantAccess(ctx: SecurityContext, companyId: string) {
    if (!ctx.isSuperadmin && ctx.activeCompanyId !== companyId) {
      throw AppError.forbidden('Tenant isolation violation: Access to company customer receivables is denied');
    }
  }

  async getById(id: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<CustomerReceivable> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    const rec = await this.receivableRepo.findById(id, companyId, client);
    if (!rec) {
      throw AppError.notFound(`Customer receivable '${id}' not found in active company`);
    }
    return rec;
  }

  async getByInvoiceId(salesInvoiceId: string, ctx: SecurityContext, client?: pg.PoolClient): Promise<CustomerReceivable | null> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return this.receivableRepo.findByInvoiceId(salesInvoiceId, companyId, client);
  }

  async list(
    filters: {
      customerId?: string;
      status?: CustomerReceivableStatus;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    },
    ctx: SecurityContext,
    client?: pg.PoolClient
  ): Promise<{ items: CustomerReceivable[]; total: number }> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw AppError.badRequest('Active company context is required');

    return this.receivableRepo.list(companyId, filters, client);
  }
}
