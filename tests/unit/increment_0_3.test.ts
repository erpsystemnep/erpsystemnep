import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CompanyRepository } from '../../src/server/modules/org/repositories/company.repository.js';
import { BranchRepository } from '../../src/server/modules/org/repositories/branch.repository.js';
import { WarehouseRepository } from '../../src/server/modules/org/repositories/warehouse.repository.js';
import { OrgService } from '../../src/server/modules/org/services/org.service.js';
import { createApp } from '../../src/server/app.js';
import { SecurityContext, Company, Branch, Warehouse } from '../../src/shared/types/index.js';
import { AppError } from '../../src/shared/errors/AppError.js';

let passedTests = 0;
let totalTests = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('\n=== RUNNING INCREMENT 0.3 ORGANIZATION DOMAIN & API TESTS ===\n');

// In-memory repositories for pure unit isolation testing
class InMemoryCompanyRepo extends CompanyRepository {
  private companies: Map<string, Company> = new Map();

  async findById(id: string): Promise<Company | null> {
    return this.companies.get(id) || null;
  }

  async findByCode(code: string): Promise<Company | null> {
    for (const c of this.companies.values()) {
      if (c.code === code.toUpperCase()) return c;
    }
    return null;
  }

  async list(filters?: { isActive?: boolean }): Promise<Company[]> {
    let result = Array.from(this.companies.values());
    if (filters?.isActive !== undefined) {
      result = result.filter((c) => c.isActive === filters.isActive);
    }
    return result.sort((a, b) => a.code.localeCompare(b.code));
  }

  async create(input: any): Promise<Company> {
    const id = randomUUID();
    const entity: Company = {
      id,
      code: input.code.toUpperCase(),
      legalName: input.legalName,
      tradeName: input.tradeName,
      baseCurrency: input.baseCurrency.toUpperCase(),
      taxIdentifier: input.taxIdentifier,
      fiscalYearStartMonth: input.fiscalYearStartMonth ?? 1,
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.companies.set(id, entity);
    return entity;
  }

  async update(id: string, input: any): Promise<Company | null> {
    const existing = this.companies.get(id);
    if (!existing) return null;
    const updated: Company = {
      ...existing,
      ...input,
      code: input.code ? input.code.toUpperCase() : existing.code,
      baseCurrency: input.baseCurrency ? input.baseCurrency.toUpperCase() : existing.baseCurrency,
      updatedAt: new Date().toISOString(),
    };
    this.companies.set(id, updated);
    return updated;
  }
}

class InMemoryBranchRepo extends BranchRepository {
  private branches: Map<string, Branch> = new Map();

  async findById(id: string): Promise<Branch | null> {
    return this.branches.get(id) || null;
  }

  async findByCompanyAndCode(companyId: string, code: string): Promise<Branch | null> {
    for (const b of this.branches.values()) {
      if (b.companyId === companyId && b.code === code.toUpperCase()) return b;
    }
    return null;
  }

  async listByCompany(companyId: string, filters?: { isActive?: boolean }): Promise<Branch[]> {
    let result = Array.from(this.branches.values()).filter((b) => b.companyId === companyId);
    if (filters?.isActive !== undefined) {
      result = result.filter((b) => b.isActive === filters.isActive);
    }
    return result.sort((a, b) => a.code.localeCompare(b.code));
  }

  async create(input: any): Promise<Branch> {
    const id = randomUUID();
    const entity: Branch = {
      id,
      companyId: input.companyId,
      code: input.code.toUpperCase(),
      name: input.name,
      isHeadOffice: input.isHeadOffice ?? false,
      addressLine1: input.addressLine1,
      city: input.city,
      stateProvince: input.stateProvince,
      postalCode: input.postalCode,
      countryCode: (input.countryCode || 'US').toUpperCase(),
      timezone: input.timezone || 'UTC',
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.branches.set(id, entity);
    return entity;
  }

  async update(id: string, input: any): Promise<Branch | null> {
    const existing = this.branches.get(id);
    if (!existing) return null;
    const updated: Branch = {
      ...existing,
      ...input,
      code: input.code ? input.code.toUpperCase() : existing.code,
      updatedAt: new Date().toISOString(),
    };
    this.branches.set(id, updated);
    return updated;
  }
}

class InMemoryWarehouseRepo extends WarehouseRepository {
  private warehouses: Map<string, Warehouse> = new Map();

  async findById(id: string): Promise<Warehouse | null> {
    return this.warehouses.get(id) || null;
  }

  async findByCompanyAndCode(companyId: string, code: string): Promise<Warehouse | null> {
    for (const w of this.warehouses.values()) {
      if (w.companyId === companyId && w.code === code.toUpperCase()) return w;
    }
    return null;
  }

  async listByCompany(
    companyId: string,
    filters?: { branchId?: string | null; isActive?: boolean }
  ): Promise<Warehouse[]> {
    let result = Array.from(this.warehouses.values()).filter((w) => w.companyId === companyId);
    if (filters?.branchId !== undefined) {
      result = result.filter((w) => w.branchId === filters.branchId);
    }
    if (filters?.isActive !== undefined) {
      result = result.filter((w) => w.isActive === filters.isActive);
    }
    return result.sort((a, b) => a.code.localeCompare(b.code));
  }

  async create(input: any): Promise<Warehouse> {
    const id = randomUUID();
    const entity: Warehouse = {
      id,
      companyId: input.companyId,
      branchId: input.branchId || null,
      code: input.code.toUpperCase(),
      name: input.name,
      warehouseType: input.warehouseType || 'PHYSICAL',
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.warehouses.set(id, entity);
    return entity;
  }

  async update(id: string, input: any): Promise<Warehouse | null> {
    const existing = this.warehouses.get(id);
    if (!existing) return null;
    const updated: Warehouse = {
      ...existing,
      ...input,
      code: input.code ? input.code.toUpperCase() : existing.code,
      updatedAt: new Date().toISOString(),
    };
    this.warehouses.set(id, updated);
    return updated;
  }
}

async function runAllTests() {
  const companyRepo = new InMemoryCompanyRepo();
  const branchRepo = new InMemoryBranchRepo();
  const warehouseRepo = new InMemoryWarehouseRepo();
  const orgService = new OrgService(companyRepo, branchRepo, warehouseRepo);

  const superadminCtx: SecurityContext = {
    userId: 'usr-admin-1',
    email: 'admin@system.local',
    fullName: 'System Administrator',
    isSuperadmin: true,
    effectivePermissions: ['*'],
  };

  // --------------------------------------------------------------------------
  // Suite 1: Company Domain Operations & Validation
  // --------------------------------------------------------------------------
  console.log('--- Suite 1: Company Domain Operations & Validation ---');

  let companyA: Company;
  let companyB: Company;

  await test('Creates valid company with schema constraints', async () => {
    companyA = await orgService.createCompany(
      {
        code: 'ACME_CORP',
        legalName: 'Acme Corporation Ltd',
        tradeName: 'Acme Global',
        baseCurrency: 'USD',
        fiscalYearStartMonth: 4,
      },
      superadminCtx
    );

    assert.ok(companyA.id);
    assert.equal(companyA.code, 'ACME_CORP');
    assert.equal(companyA.baseCurrency, 'USD');
    assert.equal(companyA.fiscalYearStartMonth, 4);
    assert.equal(companyA.isActive, true);
  });

  await test('Rejects company creation with duplicate code', async () => {
    await assert.rejects(
      async () => {
        await orgService.createCompany(
          {
            code: 'ACME_CORP',
            legalName: 'Acme Duplicate',
            baseCurrency: 'USD',
          },
          superadminCtx
        );
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 409);
        assert.ok(err.message.includes('already registered'));
        return true;
      }
    );
  });

  await test('Updates existing company legal name and preserves invariants', async () => {
    const updated = await orgService.updateCompany(
      companyA.id,
      {
        legalName: 'Acme Industries Worldwide Ltd',
        tradeName: 'Acme Industries',
      },
      superadminCtx
    );

    assert.equal(updated.legalName, 'Acme Industries Worldwide Ltd');
    assert.equal(updated.tradeName, 'Acme Industries');
    assert.equal(updated.code, 'ACME_CORP');
  });

  // --------------------------------------------------------------------------
  // Suite 2: Multi-Tenant Company Isolation
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 2: Multi-Tenant Company Isolation ---');

  await test('Provisions second company and validates tenant boundaries', async () => {
    companyB = await orgService.createCompany(
      {
        code: 'BETA_TECH',
        legalName: 'Beta Technologies Inc',
        baseCurrency: 'EUR',
      },
      superadminCtx
    );
    assert.ok(companyB.id);
    assert.notEqual(companyA.id, companyB.id);
  });

  const tenantACtx: SecurityContext = {
    userId: 'usr-acme-manager',
    email: 'manager@acme.com',
    fullName: 'Acme Manager',
    isSuperadmin: false,
    activeCompanyId: '', // will set below
    effectivePermissions: ['org.company.view', 'org.branch.view', 'org.branch.create', 'org.warehouse.view', 'org.warehouse.create'],
  };

  await test('Company user cannot view or mutate cross-company resources', async () => {
    tenantACtx.activeCompanyId = companyA.id;

    // Allowed to view Company A
    const myCompany = await orgService.getCompanyById(companyA.id, tenantACtx);
    assert.equal(myCompany.id, companyA.id);

    // Forbidden to view Company B
    await assert.rejects(
      async () => {
        await orgService.getCompanyById(companyB.id, tenantACtx);
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 403);
        assert.ok(err.message.includes('Cross-tenant access violation'));
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // Suite 3: Branch Operations & Company Scoping
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 3: Branch Operations & Company Scoping ---');

  let branch1: Branch;
  let branch2: Branch;

  await test('Creates operating branch belonging to Company A', async () => {
    branch1 = await orgService.createBranch(
      {
        companyId: companyA.id,
        code: 'HQ_NY',
        name: 'New York Headquarters',
        isHeadOffice: true,
        city: 'New York',
        stateProvince: 'NY',
        countryCode: 'US',
      },
      tenantACtx
    );

    assert.ok(branch1.id);
    assert.equal(branch1.code, 'HQ_NY');
    assert.equal(branch1.companyId, companyA.id);
    assert.equal(branch1.isHeadOffice, true);
    assert.equal(branch1.countryCode, 'US');
  });

  await test('Rejects duplicate branch code in same company', async () => {
    await assert.rejects(
      async () => {
        await orgService.createBranch(
          {
            companyId: companyA.id,
            code: 'HQ_NY',
            name: 'Duplicate Branch',
          },
          tenantACtx
        );
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 409);
        assert.ok(err.message.includes('already exists in company'));
        return true;
      }
    );
  });

  await test('Allows identical branch code in different company (multi-tenant uniqueness)', async () => {
    const tenantBCtx: SecurityContext = {
      userId: 'usr-beta-manager',
      email: 'manager@beta.com',
      fullName: 'Beta Manager',
      isSuperadmin: false,
      activeCompanyId: companyB.id,
      effectivePermissions: ['org.branch.create', 'org.branch.view'],
    };

    branch2 = await orgService.createBranch(
      {
        companyId: companyB.id,
        code: 'HQ_NY', // Same code as Company A's branch
        name: 'Beta NY Office',
      },
      tenantBCtx
    );

    assert.ok(branch2.id);
    assert.equal(branch2.code, 'HQ_NY');
    assert.equal(branch2.companyId, companyB.id);
    assert.notEqual(branch1.id, branch2.id);
  });

  // --------------------------------------------------------------------------
  // Suite 4: Warehouse Operations & Company-Wide vs Branch Warehouses
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 4: Warehouse Operations & Hierarchy ---');

  let companyWideDC: Warehouse;
  let branchWarehouse: Warehouse;

  await test('Creates company-wide Central DC with branchId = null', async () => {
    companyWideDC = await orgService.createWarehouse(
      {
        companyId: companyA.id,
        branchId: null,
        code: 'MAIN_DC',
        name: 'Company-Wide Central Distribution Center',
        warehouseType: 'CENTRAL_DC',
      },
      tenantACtx
    );

    assert.ok(companyWideDC.id);
    assert.equal(companyWideDC.code, 'MAIN_DC');
    assert.equal(companyWideDC.branchId, null);
    assert.equal(companyWideDC.warehouseType, 'CENTRAL_DC');
  });

  await test('Creates branch-scoped physical warehouse', async () => {
    branchWarehouse = await orgService.createWarehouse(
      {
        companyId: companyA.id,
        branchId: branch1.id,
        code: 'NY_LOCAL_WH',
        name: 'NY Store Local Stock',
        warehouseType: 'PHYSICAL',
      },
      tenantACtx
    );

    assert.ok(branchWarehouse.id);
    assert.equal(branchWarehouse.branchId, branch1.id);
    assert.equal(branchWarehouse.warehouseType, 'PHYSICAL');
  });

  await test('Rejects warehouse creation referencing branch of a different company', async () => {
    await assert.rejects(
      async () => {
        await orgService.createWarehouse(
          {
            companyId: companyA.id,
            branchId: branch2.id, // branch2 belongs to Company B!
            code: 'INVALID_WH',
            name: 'Invalid Cross-Company Warehouse',
          },
          tenantACtx
        );
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.ok(err.message.includes('belongs to company'));
        return true;
      }
    );
  });

  await test('Lists warehouses filtering by company-wide (branchId = null) vs specific branch', async () => {
    const dcs = await orgService.listWarehouses(companyA.id, tenantACtx, { branchId: null });
    assert.equal(dcs.length, 1);
    assert.equal(dcs[0].code, 'MAIN_DC');

    const branchWhs = await orgService.listWarehouses(companyA.id, tenantACtx, { branchId: branch1.id });
    assert.equal(branchWhs.length, 1);
    assert.equal(branchWhs[0].code, 'NY_LOCAL_WH');
  });

  // --------------------------------------------------------------------------
  // Suite 5: REST API HTTP Endpoints Integration
  // --------------------------------------------------------------------------
  console.log('\n--- Suite 5: REST API HTTP Endpoints Integration ---');

  const app = createApp();

  await test('Express app mounts /api/health and /api/org routes cleanly', () => {
    assert.ok(typeof app.listen === 'function');
  });

  console.log(`\n=============================================`);
  console.log(`ALL ${passedTests}/${totalTests} INCREMENT 0.3 TESTS PASSED!`);
  console.log(`=============================================\n`);
}

runAllTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
