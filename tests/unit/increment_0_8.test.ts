import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PartnerRepository } from '../../src/server/modules/master/repositories/partner.repository.js';
import { PartnerService } from '../../src/server/modules/master/services/partner.service.js';
import { CategoryRepository } from '../../src/server/modules/master/repositories/category.repository.js';
import { CategoryService } from '../../src/server/modules/master/services/category.service.js';
import { UomRepository } from '../../src/server/modules/master/repositories/uom.repository.js';
import { UomService } from '../../src/server/modules/master/services/uom.service.js';
import { ItemRepository } from '../../src/server/modules/master/repositories/item.repository.js';
import { ItemService } from '../../src/server/modules/master/services/item.service.js';
import { AuditRepository } from '../../src/server/modules/audit/repositories/audit.repository.js';
import { AuditService } from '../../src/server/modules/audit/services/audit.service.js';
import {
  BusinessPartner,
  ItemCategory,
  UnitOfMeasure,
  Item,
  SecurityContext,
  AuditLog,
} from '../../src/shared/types/index.js';
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

console.log('\n=== RUNNING INCREMENT 0.8 MASTER DATA FOUNDATION UNIT TESTS ===\n');

// ----------------------------------------------------------------------------
// In-Memory Test Harness for Increment 0.8
// ----------------------------------------------------------------------------

class InMemoryAuditRepo extends AuditRepository {
  public logs: AuditLog[] = [];

  async create(input: any): Promise<AuditLog> {
    const log: AuditLog = {
      id: randomUUID(),
      companyId: input.companyId || null,
      branchId: input.branchId || null,
      warehouseId: input.warehouseId || null,
      userId: input.userId || null,
      action: input.action,
      module: input.module,
      entityName: input.entityName,
      entityId: input.entityId,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      changes: input.changes,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      sessionId: input.sessionId,
      correlationId: input.correlationId,
      createdAt: new Date().toISOString(),
    };
    this.logs.push(log);
    return log;
  }
}

class InMemoryPartnerRepo extends PartnerRepository {
  public partners: Map<string, BusinessPartner> = new Map();

  async findById(id: string, companyId?: string | null): Promise<BusinessPartner | null> {
    const p = this.partners.get(id);
    if (!p) return null;
    if (companyId && p.companyId !== companyId) return null;
    return JSON.parse(JSON.stringify(p));
  }

  async findByCode(code: string, companyId: string): Promise<BusinessPartner | null> {
    for (const p of this.partners.values()) {
      if (p.companyId === companyId && p.partnerCode.toUpperCase() === code.toUpperCase()) {
        return JSON.parse(JSON.stringify(p));
      }
    }
    return null;
  }

  async list(companyId: string, filters: any): Promise<any> {
    let list = Array.from(this.partners.values()).filter((p) => p.companyId === companyId);
    if (filters.search) {
      const s = filters.search.toLowerCase();
      list = list.filter(
        (p) =>
          p.partnerCode.toLowerCase().includes(s) ||
          p.legalName.toLowerCase().includes(s) ||
          (p.tradeName && p.tradeName.toLowerCase().includes(s)) ||
          (p.taxIdentifier && p.taxIdentifier.toLowerCase().includes(s))
      );
    }
    if (filters.isCustomer !== undefined) {
      list = list.filter((p) => p.isCustomer === filters.isCustomer);
    }
    if (filters.isSupplier !== undefined) {
      list = list.filter((p) => p.isSupplier === filters.isSupplier);
    }
    if (filters.isActive !== undefined) {
      list = list.filter((p) => p.isActive === filters.isActive);
    }
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const items = list.slice((page - 1) * limit, page * limit);
    return {
      items: JSON.parse(JSON.stringify(items)),
      total: list.length,
      page,
      limit,
      totalPages: Math.ceil(list.length / limit) || 1,
    };
  }

  async create(companyId: string, input: any): Promise<BusinessPartner> {
    const partner: BusinessPartner = {
      id: randomUUID(),
      companyId,
      partnerCode: input.partnerCode.toUpperCase(),
      legalName: input.legalName,
      tradeName: input.tradeName,
      partnerType: input.partnerType || 'ORGANIZATION',
      taxIdentifier: input.taxIdentifier,
      email: input.email,
      phone: input.phone,
      countryCode: input.countryCode || 'US',
      currencyCode: input.currencyCode || 'USD',
      isCustomer: Boolean(input.isCustomer),
      isSupplier: Boolean(input.isSupplier),
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      addresses: input.addresses?.map((a: any) => ({
        id: randomUUID(),
        partnerId: '',
        ...a,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      contacts: input.contacts?.map((c: any) => ({
        id: randomUUID(),
        partnerId: '',
        ...c,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };
    this.partners.set(partner.id, partner);
    return JSON.parse(JSON.stringify(partner));
  }

  async update(id: string, companyId: string, input: any): Promise<BusinessPartner | null> {
    const p = this.partners.get(id);
    if (!p || p.companyId !== companyId) return null;
    const updated = {
      ...p,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    if (input.addresses) {
      updated.addresses = input.addresses.map((a: any) => ({
        id: randomUUID(),
        partnerId: id,
        ...a,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    }
    if (input.contacts) {
      updated.contacts = input.contacts.map((c: any) => ({
        id: randomUUID(),
        partnerId: id,
        ...c,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    }
    this.partners.set(id, updated);
    return JSON.parse(JSON.stringify(updated));
  }

  async softDelete(id: string, companyId: string): Promise<BusinessPartner | null> {
    const p = this.partners.get(id);
    if (!p || p.companyId !== companyId) return null;
    p.isActive = false;
    p.updatedAt = new Date().toISOString();
    return JSON.parse(JSON.stringify(p));
  }
}

class InMemoryCategoryRepo extends CategoryRepository {
  public categories: Map<string, ItemCategory> = new Map();
  public itemsMap: Map<string, string> = new Map(); // itemId -> categoryId

  async findById(id: string, companyId?: string | null): Promise<ItemCategory | null> {
    const c = this.categories.get(id);
    if (!c) return null;
    if (companyId && c.companyId !== companyId) return null;
    return JSON.parse(JSON.stringify(c));
  }

  async findByCode(code: string, companyId: string): Promise<ItemCategory | null> {
    for (const c of this.categories.values()) {
      if (c.companyId === companyId && c.code.toUpperCase() === code.toUpperCase()) {
        return JSON.parse(JSON.stringify(c));
      }
    }
    return null;
  }

  async list(companyId: string, filters: any): Promise<any> {
    let list = Array.from(this.categories.values()).filter((c) => c.companyId === companyId);
    if (filters.search) {
      const s = filters.search.toLowerCase();
      list = list.filter((c) => c.code.toLowerCase().includes(s) || c.name.toLowerCase().includes(s));
    }
    if (filters.isActive !== undefined) {
      list = list.filter((c) => c.isActive === filters.isActive);
    }
    return {
      items: JSON.parse(JSON.stringify(list)),
      total: list.length,
      page: 1,
      limit: 100,
      totalPages: 1,
    };
  }

  async create(companyId: string, input: any): Promise<ItemCategory> {
    const category: ItemCategory = {
      id: randomUUID(),
      companyId,
      code: input.code.toUpperCase(),
      name: input.name,
      description: input.description,
      parentCategoryId: input.parentCategoryId,
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.categories.set(category.id, category);
    return JSON.parse(JSON.stringify(category));
  }

  async update(id: string, companyId: string, input: any): Promise<ItemCategory | null> {
    const c = this.categories.get(id);
    if (!c || c.companyId !== companyId) return null;
    const updated = {
      ...c,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    this.categories.set(id, updated);
    return JSON.parse(JSON.stringify(updated));
  }

  async softDelete(id: string, companyId: string): Promise<ItemCategory | null> {
    const c = this.categories.get(id);
    if (!c || c.companyId !== companyId) return null;
    c.isActive = false;
    c.updatedAt = new Date().toISOString();
    return JSON.parse(JSON.stringify(c));
  }

  async hasActiveChildren(id: string): Promise<boolean> {
    for (const c of this.categories.values()) {
      if (c.parentCategoryId === id && c.isActive) return true;
    }
    return false;
  }

  async hasItemsAssigned(id: string): Promise<boolean> {
    for (const catId of this.itemsMap.values()) {
      if (catId === id) return true;
    }
    return false;
  }
}

class InMemoryUomRepo extends UomRepository {
  public uoms: Map<string, UnitOfMeasure> = new Map();
  public itemBaseUoms: Set<string> = new Set(); // baseUomIds assigned to active items

  async findById(id: string, companyId?: string | null): Promise<UnitOfMeasure | null> {
    const u = this.uoms.get(id);
    if (!u) return null;
    if (companyId && u.companyId !== companyId) return null;
    return JSON.parse(JSON.stringify(u));
  }

  async findByCode(code: string, companyId: string): Promise<UnitOfMeasure | null> {
    for (const u of this.uoms.values()) {
      if (u.companyId === companyId && u.code.toUpperCase() === code.toUpperCase()) {
        return JSON.parse(JSON.stringify(u));
      }
    }
    return null;
  }

  async list(companyId: string, filters: any): Promise<any> {
    let list = Array.from(this.uoms.values()).filter((u) => u.companyId === companyId);
    if (filters.uomType) {
      list = list.filter((u) => u.uomType === filters.uomType);
    }
    if (filters.isActive !== undefined) {
      list = list.filter((u) => u.isActive === filters.isActive);
    }
    return {
      items: JSON.parse(JSON.stringify(list)),
      total: list.length,
      page: 1,
      limit: 100,
      totalPages: 1,
    };
  }

  async create(companyId: string, input: any): Promise<UnitOfMeasure> {
    const uom: UnitOfMeasure = {
      id: randomUUID(),
      companyId,
      code: input.code.toUpperCase(),
      name: input.name,
      symbol: input.symbol,
      uomType: input.uomType || 'COUNT',
      conversionPrecision: input.conversionPrecision ?? 4,
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.uoms.set(uom.id, uom);
    return JSON.parse(JSON.stringify(uom));
  }

  async update(id: string, companyId: string, input: any): Promise<UnitOfMeasure | null> {
    const u = this.uoms.get(id);
    if (!u || u.companyId !== companyId) return null;
    const updated = {
      ...u,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    this.uoms.set(id, updated);
    return JSON.parse(JSON.stringify(updated));
  }

  async softDelete(id: string, companyId: string): Promise<UnitOfMeasure | null> {
    const u = this.uoms.get(id);
    if (!u || u.companyId !== companyId) return null;
    u.isActive = false;
    u.updatedAt = new Date().toISOString();
    return JSON.parse(JSON.stringify(u));
  }

  async hasItemsAssigned(id: string): Promise<boolean> {
    return this.itemBaseUoms.has(id);
  }
}

class InMemoryItemRepo extends ItemRepository {
  public items: Map<string, Item> = new Map();

  async findById(id: string, companyId?: string | null): Promise<Item | null> {
    const item = this.items.get(id);
    if (!item) return null;
    if (companyId && item.companyId !== companyId) return null;
    return JSON.parse(JSON.stringify(item));
  }

  async findBySku(sku: string, companyId: string): Promise<Item | null> {
    for (const item of this.items.values()) {
      if (item.companyId === companyId && item.sku.toUpperCase() === sku.toUpperCase()) {
        return JSON.parse(JSON.stringify(item));
      }
    }
    return null;
  }

  async list(companyId: string, filters: any): Promise<any> {
    let list = Array.from(this.items.values()).filter((i) => i.companyId === companyId);
    if (filters.search) {
      const s = filters.search.toLowerCase();
      list = list.filter((i) => i.sku.toLowerCase().includes(s) || i.itemName.toLowerCase().includes(s));
    }
    if (filters.itemType) {
      list = list.filter((i) => i.itemType === filters.itemType);
    }
    if (filters.categoryId) {
      list = list.filter((i) => i.categoryId === filters.categoryId);
    }
    if (filters.isStockItem !== undefined) {
      list = list.filter((i) => i.isStockItem === filters.isStockItem);
    }
    if (filters.isSaleable !== undefined) {
      list = list.filter((i) => i.isSaleable === filters.isSaleable);
    }
    if (filters.isPurchasable !== undefined) {
      list = list.filter((i) => i.isPurchasable === filters.isPurchasable);
    }
    if (filters.isActive !== undefined) {
      list = list.filter((i) => i.isActive === filters.isActive);
    }
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const items = list.slice((page - 1) * limit, page * limit);
    return {
      items: JSON.parse(JSON.stringify(items)),
      total: list.length,
      page,
      limit,
      totalPages: Math.ceil(list.length / limit) || 1,
    };
  }

  async create(companyId: string, input: any): Promise<Item> {
    const item: Item = {
      id: randomUUID(),
      companyId,
      sku: input.sku.toUpperCase(),
      itemName: input.itemName,
      description: input.description,
      categoryId: input.categoryId,
      itemType: input.itemType || 'RAW_MATERIAL',
      baseUomId: input.baseUomId,
      isStockItem: input.isStockItem ?? true,
      isSaleable: input.isSaleable ?? false,
      isPurchasable: input.isPurchasable ?? true,
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      conversions: input.conversions?.map((c: any) => ({
        id: randomUUID(),
        itemId: '',
        ...c,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    };
    this.items.set(item.id, item);
    return JSON.parse(JSON.stringify(item));
  }

  async update(id: string, companyId: string, input: any): Promise<Item | null> {
    const item = this.items.get(id);
    if (!item || item.companyId !== companyId) return null;
    const updated = {
      ...item,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    if (input.conversions) {
      updated.conversions = input.conversions.map((c: any) => ({
        id: randomUUID(),
        itemId: id,
        ...c,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    }
    this.items.set(id, updated);
    return JSON.parse(JSON.stringify(updated));
  }

  async softDelete(id: string, companyId: string): Promise<Item | null> {
    const item = this.items.get(id);
    if (!item || item.companyId !== companyId) return null;
    item.isActive = false;
    item.updatedAt = new Date().toISOString();
    return JSON.parse(JSON.stringify(item));
  }

  async addConversion(itemId: string, input: any): Promise<any> {
    const item = this.items.get(itemId);
    if (!item) throw new Error('Item not found');
    const conv = {
      id: randomUUID(),
      itemId,
      ...input,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!item.conversions) item.conversions = [];
    item.conversions.push(conv);
    return conv;
  }

  async deleteConversion(conversionId: string, itemId: string): Promise<boolean> {
    const item = this.items.get(itemId);
    if (!item || !item.conversions) return false;
    const initialLen = item.conversions.length;
    item.conversions = item.conversions.filter((c) => c.id !== conversionId);
    return item.conversions.length < initialLen;
  }
}

// ----------------------------------------------------------------------------
// Test Execution
// ----------------------------------------------------------------------------

async function runIncrement08Tests() {
  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();

  const ctxA: SecurityContext = {
    userId: userA,
    email: 'ops_alpha@erp.local',
    fullName: 'Operations Alpha',
    isSuperadmin: false,
    activeCompanyId: companyA,
    activeBranchId: branchA,
    effectivePermissions: [
      'master.partner.view',
      'master.partner.create',
      'master.partner.edit',
      'master.partner.delete',
      'master.category.view',
      'master.category.create',
      'master.category.edit',
      'master.category.delete',
      'master.uom.view',
      'master.uom.create',
      'master.uom.edit',
      'master.uom.delete',
      'master.item.view',
      'master.item.create',
      'master.item.edit',
      'master.item.delete',
    ],
  };

  const ctxB: SecurityContext = {
    userId: userB,
    email: 'ops_bravo@erp.local',
    fullName: 'Operations Bravo',
    isSuperadmin: false,
    activeCompanyId: companyB,
    activeBranchId: branchB,
    effectivePermissions: ctxA.effectivePermissions,
  };

  const auditRepo = new InMemoryAuditRepo();
  const auditService = new AuditService(auditRepo);

  const partnerRepo = new InMemoryPartnerRepo();
  const partnerService = new PartnerService(partnerRepo, auditService);

  const categoryRepo = new InMemoryCategoryRepo();
  const categoryService = new CategoryService(categoryRepo, auditService);

  const uomRepo = new InMemoryUomRepo();
  const uomService = new UomService(uomRepo, auditService);

  const itemRepo = new InMemoryItemRepo();
  const itemService = new ItemService(itemRepo, categoryRepo, uomRepo, auditService);

  // ==========================================================================
  // 1. BUSINESS PARTNER DOMAIN TESTS
  // ==========================================================================
  console.log('--- 1. Business Partner Domain Tests ---');

  let supplierA: BusinessPartner;
  let customerA: BusinessPartner;

  await test('1.1 Creates a supplier business partner with addresses and contacts', async () => {
    supplierA = await partnerService.createPartner(
      {
        partnerCode: 'SUP-001',
        legalName: 'Apex Raw Materials Inc',
        tradeName: 'Apex Supplies',
        partnerType: 'ORGANIZATION',
        taxIdentifier: 'US-99887766',
        email: 'sales@apexraw.com',
        phone: '+1-555-0199',
        countryCode: 'US',
        currencyCode: 'USD',
        isCustomer: false,
        isSupplier: true,
        addresses: [
          {
            addressType: 'SHIPPING',
            addressLine1: '100 Industrial Parkway',
            city: 'Cleveland',
            stateProvince: 'OH',
            postalCode: '44101',
            countryCode: 'US',
            isDefault: true,
          },
        ],
        contacts: [
          {
            contactName: 'Jane Doe',
            designation: 'Account Executive',
            email: 'jane@apexraw.com',
            phone: '+1-555-0198',
            isPrimary: true,
          },
        ],
      },
      ctxA
    );

    assert.equal(supplierA.partnerCode, 'SUP-001');
    assert.equal(supplierA.companyId, companyA);
    assert.equal(supplierA.isSupplier, true);
    assert.equal(supplierA.isCustomer, false);
    assert.equal(supplierA.addresses?.length, 1);
    assert.equal(supplierA.contacts?.length, 1);
  });

  await test('1.2 Enforces unique partner code within same company', async () => {
    await assert.rejects(
      async () => {
        await partnerService.createPartner(
          {
            partnerCode: 'SUP-001', // duplicate in companyA
            legalName: 'Another Supplier Ltd',
            isSupplier: true,
          },
          ctxA
        );
      },
      (err: any) => err instanceof AppError && err.code === 'CONFLICT'
    );
  });

  await test('1.3 Allows same partner code in different tenant company', async () => {
    const partnerB = await partnerService.createPartner(
      {
        partnerCode: 'SUP-001', // same code in companyB
        legalName: 'Bravo Industrial Corp',
        isSupplier: true,
      },
      ctxB
    );

    assert.equal(partnerB.partnerCode, 'SUP-001');
    assert.equal(partnerB.companyId, companyB);
  });

  await test('1.4 Requires partner to be designated as Customer, Supplier, or both', async () => {
    await assert.rejects(
      async () => {
        await partnerService.createPartner(
          {
            partnerCode: 'NONE-001',
            legalName: 'Neither Customer Nor Supplier',
            isCustomer: false,
            isSupplier: false,
          },
          ctxA
        );
      },
      (err: any) => err instanceof AppError && err.code === 'VALIDATION_ERROR'
    );
  });

  await test('1.5 Creates a customer business partner', async () => {
    customerA = await partnerService.createPartner(
      {
        partnerCode: 'CUST-100',
        legalName: 'Global Retailers LLC',
        isCustomer: true,
        isSupplier: false,
      },
      ctxA
    );

    assert.equal(customerA.isCustomer, true);
    assert.equal(customerA.isSupplier, false);
  });

  await test('1.6 Updates business partner attributes and syncs contacts', async () => {
    const updated = await partnerService.updatePartner(
      supplierA.id,
      {
        tradeName: 'Apex Global Logistics',
        contacts: [
          {
            contactName: 'John Smith',
            designation: 'Operations Director',
            email: 'john@apexraw.com',
            isPrimary: true,
          },
        ],
      },
      ctxA
    );

    assert.equal(updated.tradeName, 'Apex Global Logistics');
    assert.equal(updated.contacts?.length, 1);
    assert.equal(updated.contacts?.[0].contactName, 'John Smith');
  });

  await test('1.7 Strict tenant isolation on Partner retrieval & mutation', async () => {
    // Tenant B cannot access Tenant A partner
    await assert.rejects(
      async () => {
        await partnerService.getPartner(supplierA.id, ctxB);
      },
      (err: any) => err instanceof AppError && err.code === 'NOT_FOUND'
    );

    await assert.rejects(
      async () => {
        await partnerService.updatePartner(supplierA.id, { legalName: 'Hacked' }, ctxB);
      },
      (err: any) => err instanceof AppError && err.code === 'NOT_FOUND'
    );
  });

  await test('1.8 Lists and filters partners with multi-criteria search', async () => {
    const res = await partnerService.listPartners({ search: 'Apex', isSupplier: true }, ctxA);
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].partnerCode, 'SUP-001');

    const custRes = await partnerService.listPartners({ isCustomer: true }, ctxA);
    assert.equal(custRes.items.length, 1);
    assert.equal(custRes.items[0].partnerCode, 'CUST-100');
  });

  await test('1.9 Deactivates (soft-deletes) business partner', async () => {
    const deleted = await partnerService.deletePartner(customerA.id, ctxA);
    assert.equal(deleted.isActive, false);

    const activeList = await partnerService.listPartners({ isActive: true }, ctxA);
    assert.ok(!activeList.items.some((p) => p.id === customerA.id));
  });

  // ==========================================================================
  // 2. ITEM CATEGORY DOMAIN TESTS
  // ==========================================================================
  console.log('\n--- 2. Item Category Domain Tests ---');

  let rawMaterialsCat: ItemCategory;
  let metalsSubCat: ItemCategory;

  await test('2.1 Creates root category for items', async () => {
    rawMaterialsCat = await categoryService.createCategory(
      {
        code: 'CAT-RAW',
        name: 'Raw Materials',
        description: 'Base unrefined manufacturing materials',
      },
      ctxA
    );

    assert.equal(rawMaterialsCat.code, 'CAT-RAW');
    assert.equal(rawMaterialsCat.companyId, companyA);
  });

  await test('2.2 Enforces unique category code within same company', async () => {
    await assert.rejects(
      async () => {
        await categoryService.createCategory(
          {
            code: 'CAT-RAW',
            name: 'Duplicate Category',
          },
          ctxA
        );
      },
      (err: any) => err instanceof AppError && err.code === 'CONFLICT'
    );
  });

  await test('2.3 Creates hierarchical child category linked to parent', async () => {
    metalsSubCat = await categoryService.createCategory(
      {
        code: 'CAT-METALS',
        name: 'Metals & Alloys',
        parentCategoryId: rawMaterialsCat.id,
      },
      ctxA
    );

    assert.equal(metalsSubCat.parentCategoryId, rawMaterialsCat.id);
  });

  await test('2.4 Rejects parent category belonging to another tenant', async () => {
    await assert.rejects(
      async () => {
        await categoryService.createCategory(
          {
            code: 'CAT-PLASTICS',
            name: 'Plastics',
            parentCategoryId: rawMaterialsCat.id, // from companyA
          },
          ctxB // in companyB
        );
      },
      (err: any) => err instanceof AppError && err.code === 'VALIDATION_ERROR'
    );
  });

  await test('2.5 Prevents circular/self reference on category update', async () => {
    await assert.rejects(
      async () => {
        await categoryService.updateCategory(
          rawMaterialsCat.id,
          {
            parentCategoryId: rawMaterialsCat.id,
          },
          ctxA
        );
      },
      (err: any) => err instanceof AppError && err.code === 'VALIDATION_ERROR'
    );
  });

  await test('2.6 Prevents deactivating category with active child subcategories', async () => {
    await assert.rejects(
      async () => {
        await categoryService.deleteCategory(rawMaterialsCat.id, ctxA);
      },
      (err: any) =>
        err instanceof AppError &&
        err.code === 'VALIDATION_ERROR' &&
        err.message.includes('has active child categories')
    );
  });

  // ==========================================================================
  // 3. UNIT OF MEASURE (UOM) DOMAIN TESTS
  // ==========================================================================
  console.log('\n--- 3. Unit of Measure (UOM) Domain Tests ---');

  let kgUom: UnitOfMeasure;
  let gUom: UnitOfMeasure;
  let pieceUom: UnitOfMeasure;

  await test('3.1 Creates standard units of measure with precision specifications', async () => {
    kgUom = await uomService.createUom(
      {
        code: 'KG',
        name: 'Kilogram',
        symbol: 'kg',
        uomType: 'WEIGHT',
        conversionPrecision: 4,
      },
      ctxA
    );

    gUom = await uomService.createUom(
      {
        code: 'GRAM',
        name: 'Gram',
        symbol: 'g',
        uomType: 'WEIGHT',
        conversionPrecision: 4,
      },
      ctxA
    );

    pieceUom = await uomService.createUom(
      {
        code: 'PCS',
        name: 'Piece',
        symbol: 'pc',
        uomType: 'COUNT',
        conversionPrecision: 0,
      },
      ctxA
    );

    assert.equal(kgUom.code, 'KG');
    assert.equal(kgUom.uomType, 'WEIGHT');
    assert.equal(pieceUom.conversionPrecision, 0);
  });

  await test('3.2 Enforces unique UOM code per company', async () => {
    await assert.rejects(
      async () => {
        await uomService.createUom(
          {
            code: 'KG',
            name: 'Duplicate Kg',
            symbol: 'kg',
          },
          ctxA
        );
      },
      (err: any) => err instanceof AppError && err.code === 'CONFLICT'
    );
  });

  await test('3.3 Lists UOMs with type filtering', async () => {
    const weightUoms = await uomService.listUoms({ uomType: 'WEIGHT' }, ctxA);
    assert.equal(weightUoms.items.length, 2);
    assert.ok(weightUoms.items.every((u) => u.uomType === 'WEIGHT'));
  });

  // ==========================================================================
  // 4. ITEM & PRODUCT DOMAIN TESTS
  // ==========================================================================
  console.log('\n--- 4. Item & Product Domain Tests ---');

  let copperItem: Item;

  await test('4.1 Creates raw material item with category, base UOM, and UOM conversions', async () => {
    categoryRepo.itemsMap.set('dummy', metalsSubCat.id);
    uomRepo.itemBaseUoms.add(kgUom.id);

    copperItem = await itemService.createItem(
      {
        sku: 'RAW-CU-001',
        itemName: 'Electrolytic Copper Cathode 99.99%',
        description: 'High purity Grade A copper cathode for smelting',
        categoryId: metalsSubCat.id,
        itemType: 'RAW_MATERIAL',
        baseUomId: kgUom.id,
        isStockItem: true,
        isSaleable: false,
        isPurchasable: true,
        conversions: [
          {
            fromUomId: kgUom.id,
            toUomId: gUom.id,
            conversionFactor: 1000,
          },
        ],
      },
      ctxA
    );

    assert.equal(copperItem.sku, 'RAW-CU-001');
    assert.equal(copperItem.companyId, companyA);
    assert.equal(copperItem.baseUomId, kgUom.id);
    assert.equal(copperItem.categoryId, metalsSubCat.id);
    assert.equal(copperItem.isStockItem, true);
    assert.equal(copperItem.isPurchasable, true);
    assert.equal(copperItem.conversions?.length, 1);
    assert.equal(copperItem.conversions?.[0].conversionFactor, 1000);
  });

  await test('4.2 Enforces unique SKU per company', async () => {
    await assert.rejects(
      async () => {
        await itemService.createItem(
          {
            sku: 'RAW-CU-001', // duplicate SKU
            itemName: 'Duplicate Copper',
            baseUomId: kgUom.id,
          },
          ctxA
        );
      },
      (err: any) => err instanceof AppError && err.code === 'CONFLICT'
    );
  });

  await test('4.3 Rejects item creation with base UOM belonging to another company', async () => {
    const uomB = await uomService.createUom(
      {
        code: 'BOX',
        name: 'Box',
        symbol: 'bx',
      },
      ctxB // company B
    );

    await assert.rejects(
      async () => {
        await itemService.createItem(
          {
            sku: 'RAW-STEEL-001',
            itemName: 'Stainless Steel Sheet',
            baseUomId: uomB.id, // cross-tenant foreign key
          },
          ctxA // company A
        );
      },
      (err: any) =>
        err instanceof AppError &&
        err.code === 'VALIDATION_ERROR' &&
        err.message.includes('does not exist or belongs to another company')
    );
  });

  await test('4.4 Rejects item creation with inactive base UOM', async () => {
    const inactiveUom = await uomService.createUom(
      {
        code: 'DRUM',
        name: 'Drum',
        symbol: 'drm',
        isActive: false,
      },
      ctxA
    );

    await assert.rejects(
      async () => {
        await itemService.createItem(
          {
            sku: 'CHEM-001',
            itemName: 'Solvent Chemical',
            baseUomId: inactiveUom.id,
          },
          ctxA
        );
      },
      (err: any) =>
        err instanceof AppError &&
        err.code === 'VALIDATION_ERROR' &&
        err.message.includes('is inactive')
    );
  });

  await test('4.5 Rejects item creation with category belonging to another company', async () => {
    const catB = await categoryService.createCategory(
      {
        code: 'CAT-BRAVO-RAW',
        name: 'Bravo Raw',
      },
      ctxB
    );

    await assert.rejects(
      async () => {
        await itemService.createItem(
          {
            sku: 'TEST-ITEM-999',
            itemName: 'Cross Company Test',
            baseUomId: kgUom.id,
            categoryId: catB.id,
          },
          ctxA
        );
      },
      (err: any) => err instanceof AppError && err.code === 'VALIDATION_ERROR'
    );
  });

  await test('4.6 Prevents deactivating Base UOM if active items reference it', async () => {
    await assert.rejects(
      async () => {
        await uomService.deleteUom(kgUom.id, ctxA);
      },
      (err: any) =>
        err instanceof AppError &&
        err.code === 'VALIDATION_ERROR' &&
        err.message.includes('active items reference it')
    );
  });

  await test('4.7 Prevents deactivating Category if active items reference it', async () => {
    categoryRepo.itemsMap.set(copperItem.id, metalsSubCat.id);

    await assert.rejects(
      async () => {
        await categoryService.deleteCategory(metalsSubCat.id, ctxA);
      },
      (err: any) =>
        err instanceof AppError &&
        err.code === 'VALIDATION_ERROR' &&
        err.message.includes('items are currently assigned')
    );
  });

  await test('4.8 Dynamically adds and deletes item UOM conversions', async () => {
    const conv = await itemService.addConversion(
      copperItem.id,
      {
        fromUomId: pieceUom.id,
        toUomId: kgUom.id,
        conversionFactor: 25.5,
      },
      ctxA
    );

    assert.equal(conv.conversionFactor, 25.5);

    const deleted = await itemService.deleteConversion(copperItem.id, conv.id, ctxA);
    assert.equal(deleted, true);
  });

  await test('4.9 Updates item attributes and flags', async () => {
    const updated = await itemService.updateItem(
      copperItem.id,
      {
        isSaleable: true,
        description: 'Updated high-grade copper cathode specifications',
      },
      ctxA
    );

    assert.equal(updated.isSaleable, true);
    assert.equal(updated.description, 'Updated high-grade copper cathode specifications');
  });

  await test('4.10 Lists items with multi-criteria filtering', async () => {
    const res = await itemService.listItems(
      {
        search: 'Copper',
        itemType: 'RAW_MATERIAL',
        isPurchasable: true,
      },
      ctxA
    );

    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].sku, 'RAW-CU-001');
  });

  await test('4.11 Strict cross-tenant isolation on Item retrieval and modification', async () => {
    await assert.rejects(
      async () => {
        await itemService.getItem(copperItem.id, ctxB);
      },
      (err: any) => err instanceof AppError && err.code === 'NOT_FOUND'
    );

    await assert.rejects(
      async () => {
        await itemService.updateItem(copperItem.id, { itemName: 'Tenant B Attempt' }, ctxB);
      },
      (err: any) => err instanceof AppError && err.code === 'NOT_FOUND'
    );
  });

  // ==========================================================================
  // 5. AUDIT TRAIL VERIFICATION FOR MASTER DATA
  // ==========================================================================
  console.log('\n--- 5. Audit Trail Verification for Master Data ---');

  await test('5.1 Master data mutations record structured immutable audit logs', async () => {
    const logs = auditRepo.logs;
    assert.ok(logs.length >= 10, 'Must record comprehensive audit logs for all mutations');

    const partnerCreateLog = logs.find(
      (l) => l.action === 'CREATE' && l.entityName === 'BusinessPartner'
    );
    assert.ok(partnerCreateLog, 'Partner CREATE audit log must exist');
    assert.equal(partnerCreateLog.companyId, companyA);
    assert.equal(partnerCreateLog.userId, userA);

    const itemUpdateLog = logs.find(
      (l) => l.action === 'UPDATE' && l.entityName === 'Item'
    );
    assert.ok(itemUpdateLog, 'Item UPDATE audit log must exist');
    assert.ok(itemUpdateLog.changes?.old);
    assert.ok(itemUpdateLog.changes?.new);

    const partnerDeleteLog = logs.find(
      (l) => l.action === 'DELETE' && l.entityName === 'BusinessPartner'
    );
    assert.ok(partnerDeleteLog, 'Partner DELETE audit log must exist');
  });

  console.log(`\n=============================================`);
  console.log(`ALL ${passedTests}/${totalTests} INCREMENT 0.8 UNIT TESTS PASSED!`);
  console.log(`=============================================\n`);
}

runIncrement08Tests().catch((err) => {
  console.error('Increment 0.8 test suite failed:', err);
  process.exit(1);
});
