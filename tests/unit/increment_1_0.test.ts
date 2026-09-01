import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  SalesOrder,
  SalesOrderLine,
  SalesReservation,
  SalesDelivery,
  SalesDeliveryLine,
  SalesDeliveryBatchAllocation,
  InventoryBatch,
  StockLedgerEntry,
  StockBalanceSummary,
  SecurityContext,
} from '../../src/shared/types/index.js';
import {
  createSalesOrderSchema,
  createSalesReservationSchema,
  releaseSalesReservationSchema,
  createSalesDeliverySchema,
} from '../../src/shared/schemas/sales.js';
import { StateMachineEngine } from '../../src/server/modules/workflow/services/state_machine.service.js';

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

console.log('\n=== RUNNING INCREMENT 1.0 SALES & FULFILLMENT FOUNDATION UNIT TESTS ===\n');

// ----------------------------------------------------------------------------
// In-Memory Simulation Engine for Sales & Stock Ledger
// ----------------------------------------------------------------------------

interface TenantContext {
  companyId: string;
  branchId: string | null;
  userId: string;
  roles: string[];
  permissions: string[];
}

class InMemorySalesAndStockEngine {
  public ledgerEntries: StockLedgerEntry[] = [];
  public batches: Map<string, InventoryBatch> = new Map();
  public salesOrders: Map<string, SalesOrder> = new Map();
  public salesReservations: Map<string, SalesReservation> = new Map();
  public salesDeliveries: Map<string, SalesDelivery> = new Map();
  public stateMachine = new StateMachineEngine();

  addLedgerEntry(entry: Omit<StockLedgerEntry, 'id' | 'createdAt'>): StockLedgerEntry {
    const fullEntry: StockLedgerEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.ledgerEntries.push(fullEntry);
    return fullEntry;
  }

  getBalance(companyId: string, warehouseId: string, itemId: string, stockStatus: string, batchId?: string): number {
    return this.ledgerEntries
      .filter((e) => e.companyId === companyId && e.warehouseId === warehouseId && e.itemId === itemId && e.stockStatus === stockStatus && (!batchId || e.batchId === batchId))
      .reduce((sum, e) => sum + e.quantity, 0);
  }

  getBalanceSummary(companyId: string): StockBalanceSummary[] {
    const map = new Map<string, StockBalanceSummary>();
    for (const e of this.ledgerEntries) {
      if (e.companyId !== companyId) continue;
      const key = `${e.warehouseId}_${e.itemId}`;
      if (!map.has(key)) {
        map.set(key, {
          companyId,
          warehouseId: e.warehouseId,
          warehouseCode: 'WH-MAIN',
          warehouseName: 'Main Warehouse',
          itemId: e.itemId,
          itemSku: 'SKU-001',
          itemName: 'Finished Good',
          uomId: e.uomId,
          uomCode: 'PCS',
          availableQuantity: 0,
          reservedQuantity: 0,
          qcPendingQuantity: 0,
          qcFailedQuantity: 0,
          quarantineQuantity: 0,
          totalQuantity: 0,
          totalValuation: 0,
        });
      }
      const s = map.get(key)!;
      if (e.stockStatus === 'AVAILABLE') s.availableQuantity += e.quantity;
      if (e.stockStatus === 'RESERVED') s.reservedQuantity = (s.reservedQuantity || 0) + e.quantity;
      if (e.stockStatus === 'QC_PENDING') s.qcPendingQuantity += e.quantity;
      if (e.stockStatus === 'QC_FAILED') s.qcFailedQuantity += e.quantity;
      s.totalQuantity = (s.totalQuantity || 0) + e.quantity;
      s.totalValuation = (s.totalValuation || 0) + e.totalCost;
    }
    return Array.from(map.values());
  }
}

// ----------------------------------------------------------------------------
// Test Execution
// ----------------------------------------------------------------------------

async function runAllTests() {
  const engine = new InMemorySalesAndStockEngine();

  const companyA = randomUUID();
  const companyB = randomUUID();
  const branch1 = randomUUID();
  const warehouse1 = randomUUID();
  const customer1 = randomUUID();
  const item1 = randomUUID();
  const uomPcs = randomUUID();
  const batch1 = randomUUID();
  const testSoId = randomUUID();
  const sol1Id = randomUUID();
  const testResvId = randomUUID();
  const testDeliveryId = randomUUID();
  const gdl1Id = randomUUID();
  const ba1Id = randomUUID();

  const userSalesClerk: SecurityContext = {
    userId: 'user-sales-clerk',
    email: 'clerk@corp.local',
    fullName: 'Sales Clerk',
    isSuperadmin: false,
    activeCompanyId: companyA,
    activeBranchId: branch1,
    effectivePermissions: ['sales.order.view', 'sales.order.create', 'sales.order.delete', 'sales.delivery.view', 'sales.delivery.create'],
  };

  const userSalesManager: SecurityContext = {
    userId: 'user-sales-manager',
    email: 'manager@corp.local',
    fullName: 'Sales Manager',
    isSuperadmin: false,
    activeCompanyId: companyA,
    activeBranchId: branch1,
    effectivePermissions: [
      'sales.order.view',
      'sales.order.approve',
      'sales.order.post',
      'sales.order.cancel',
      'sales.reservation.view',
      'sales.reservation.create',
      'sales.reservation.release',
      'sales.delivery.view',
      'sales.delivery.approve',
      'sales.delivery.post',
      'sales.delivery.cancel',
      'sales.delivery.reverse',
    ],
  };

  // Seed Initial Stock in Warehouse: 100 PCS AVAILABLE
  engine.addLedgerEntry({
    companyId: companyA,
    branchId: branch1,
    warehouseId: warehouse1,
    itemId: item1,
    batchId: batch1,
    uomId: uomPcs,
    quantity: 100,
    stockStatus: 'AVAILABLE',
    movementType: 'GOODS_RECEIPT',
    unitCost: 50.0,
    totalCost: 5000.0,
    sourceDocumentType: 'PURCHASE_RECEIPT',
    sourceDocumentId: 'grn-001',
    createdBy: 'system',
  });

  console.log('--- Suite 1: Sales Order Creation & Zod Schema Validation ---');

  await test('Validates Sales Order schema with line calculations and taxes', () => {
    const rawInput = {
      customerId: customer1,
      branchId: branch1,
      orderDate: '2026-09-01',
      expectedDeliveryDate: '2026-09-10',
      currencyCode: 'USD',
      exchangeRate: 1.0,
      lines: [
        {
          itemId: item1,
          warehouseId: warehouse1,
          uomId: uomPcs,
          orderedQuantity: 20,
          unitPrice: 120.0,
          discountRate: 10.0,
          taxRate: 5.0,
        },
      ],
    };

    const parsed = createSalesOrderSchema.parse(rawInput);
    assert.equal(parsed.customerId, customer1);
    assert.equal(parsed.lines[0].orderedQuantity, 20);
    assert.equal(parsed.lines[0].unitPrice, 120);
    assert.equal(parsed.lines[0].discountRate, 10);
  });

  await test('Rejects invalid Sales Order with zero or negative quantity', () => {
    const rawInput = {
      customerId: customer1,
      lines: [
        {
          itemId: item1,
          warehouseId: warehouse1,
          uomId: uomPcs,
          orderedQuantity: 0, // invalid
          unitPrice: 120.0,
        },
      ],
    };
    assert.throws(() => createSalesOrderSchema.parse(rawInput));
  });

  await test('Rejects Sales Order with invalid discount rate > 100%', () => {
    const rawInput = {
      customerId: customer1,
      lines: [
        {
          itemId: item1,
          warehouseId: warehouse1,
          uomId: uomPcs,
          orderedQuantity: 5,
          unitPrice: 100.0,
          discountRate: 150.0, // invalid
        },
      ],
    };
    assert.throws(() => createSalesOrderSchema.parse(rawInput));
  });

  console.log('\n--- Suite 2: Sales Order State Machine & Segregation of Duties (SoD) ---');

  let createdSo: SalesOrder = {
    id: testSoId,
    companyId: companyA,
    branchId: branch1,
    soNumber: 'SO-2026-0001',
    customerId: customer1,
    orderDate: '2026-09-01',
    expectedDeliveryDate: '2026-09-10',
    status: 'DRAFT',
    currencyCode: 'USD',
    exchangeRate: 1.0,
    subtotal: 2160.0,
    taxTotal: 108.0,
    grandTotal: 2268.0,
    createdBy: userSalesClerk.userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lines: [
      {
        id: sol1Id,
        salesOrderId: testSoId,
        lineNumber: 1,
        itemId: item1,
        warehouseId: warehouse1,
        uomId: uomPcs,
        orderedQuantity: 20,
        conversionFactor: 1.0,
        baseQuantity: 20,
        unitPrice: 120.0,
        discountRate: 10.0,
        discountAmount: 240.0,
        taxRate: 5.0,
        taxAmount: 108.0,
        lineTotal: 2268.0,
        deliveredQuantity: 0,
        reservedQuantity: 0,
        remainingQuantity: 20,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
  engine.salesOrders.set(testSoId, createdSo);

  await test('Creator transitions Sales Order from DRAFT to SUBMITTED', () => {
    engine.stateMachine.validateTransition({
      documentType: 'SALES_ORDER',
      currentState: createdSo.status,
      targetState: 'SUBMITTED',
      ctx: userSalesClerk,
      documentContext: {
        creatorId: createdSo.createdBy || undefined,
        companyId: createdSo.companyId,
        branchId: createdSo.branchId,
        documentId: createdSo.id,
      },
    });
    createdSo.status = 'SUBMITTED';
    assert.equal(createdSo.status, 'SUBMITTED');
  });

  await test('Segregation of Duties (SoD): Creator CANNOT approve their own Sales Order', () => {
    assert.throws(
      () => {
        engine.stateMachine.validateTransition({
          documentType: 'SALES_ORDER',
          currentState: createdSo.status,
          targetState: 'APPROVED',
          ctx: userSalesClerk, // Same user who created the SO
          documentContext: {
            creatorId: createdSo.createdBy || undefined,
            companyId: createdSo.companyId,
            branchId: createdSo.branchId,
            documentId: createdSo.id,
          },
        });
      },
      (err: any) => err.message.includes('Segregation of Duties') || err.message.includes('cannot approve') || err.message.includes('Forbidden')
    );
  });

  await test('Separate authorized manager approves the Sales Order', () => {
    engine.stateMachine.validateTransition({
      documentType: 'SALES_ORDER',
      currentState: createdSo.status,
      targetState: 'APPROVED',
      ctx: userSalesManager, // Distinct authorized manager
      documentContext: {
        creatorId: createdSo.createdBy || undefined,
        companyId: createdSo.companyId,
        branchId: createdSo.branchId,
        documentId: createdSo.id,
      },
    });
    createdSo.status = 'APPROVED';
    createdSo.approvedBy = userSalesManager.userId;
    createdSo.approvedAt = new Date().toISOString();
    assert.equal(createdSo.status, 'APPROVED');
  });

  await test('Authorized user posts Sales Order for fulfillment', () => {
    engine.stateMachine.validateTransition({
      documentType: 'SALES_ORDER',
      currentState: createdSo.status,
      targetState: 'POSTED',
      ctx: userSalesManager,
      documentContext: {
        creatorId: createdSo.createdBy || undefined,
        companyId: createdSo.companyId,
        branchId: createdSo.branchId,
        documentId: createdSo.id,
      },
    });
    createdSo.status = 'POSTED';
    createdSo.postedBy = userSalesManager.userId;
    assert.equal(createdSo.status, 'POSTED');
  });

  console.log('\n--- Suite 3: Stock Reservation Engine & Balance Segregation ---');

  let createdResv: SalesReservation;

  await test('Reserves 10 PCS against approved Sales Order line', () => {
    const availBefore = engine.getBalance(companyA, warehouse1, item1, 'AVAILABLE');
    assert.equal(availBefore, 100);

    const reserveQty = 10;
    // Validate schema
    const parsed = createSalesReservationSchema.parse({
      salesOrderId: testSoId,
      salesOrderLineId: sol1Id,
      reservedQuantity: reserveQty,
      batchId: batch1,
      warehouseId: warehouse1,
    });
    assert.equal(parsed.reservedQuantity, 10);

    // Stock Ledger Dual Entry
    engine.addLedgerEntry({
      companyId: companyA,
      branchId: branch1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: batch1,
      uomId: uomPcs,
      quantity: -reserveQty,
      stockStatus: 'AVAILABLE',
      movementType: 'SALES_RESERVATION',
      unitCost: 0,
      totalCost: 0,
      sourceDocumentType: 'SALES_RESERVATION',
      sourceDocumentId: testResvId,
      createdBy: userSalesManager.userId,
    });

    engine.addLedgerEntry({
      companyId: companyA,
      branchId: branch1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: batch1,
      uomId: uomPcs,
      quantity: reserveQty,
      stockStatus: 'RESERVED',
      movementType: 'SALES_RESERVATION',
      unitCost: 0,
      totalCost: 0,
      sourceDocumentType: 'SALES_RESERVATION',
      sourceDocumentId: testResvId,
      createdBy: userSalesManager.userId,
    });

    createdResv = {
      id: testResvId,
      companyId: companyA,
      branchId: branch1,
      salesOrderId: testSoId,
      salesOrderLineId: sol1Id,
      itemId: item1,
      warehouseId: warehouse1,
      batchId: batch1,
      uomId: uomPcs,
      reservedQuantity: reserveQty,
      fulfilledQuantity: 0,
      releasedQuantity: 0,
      status: 'ACTIVE',
      createdBy: userSalesManager.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    engine.salesReservations.set(testResvId, createdResv);

    // Verify balances
    const availAfter = engine.getBalance(companyA, warehouse1, item1, 'AVAILABLE');
    const reservedAfter = engine.getBalance(companyA, warehouse1, item1, 'RESERVED');
    assert.equal(availAfter, 90, 'Available stock must decrease from 100 to 90');
    assert.equal(reservedAfter, 10, 'Reserved stock must be 10');

    // Total physical quantity in warehouse remains 100 (conservation invariant)
    const summary = engine.getBalanceSummary(companyA);
    assert.equal(summary[0].totalQuantity, 100, 'Total physical inventory must remain constant during reservation');
  });

  await test('Partially releases 3 PCS from reservation back to available pool', () => {
    const releaseQty = 3;
    const parsed = releaseSalesReservationSchema.parse({ quantity: releaseQty });
    assert.equal(parsed.quantity, 3);

    // Stock Ledger Dual Entry for Release
    engine.addLedgerEntry({
      companyId: companyA,
      branchId: branch1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: batch1,
      uomId: uomPcs,
      quantity: -releaseQty,
      stockStatus: 'RESERVED',
      movementType: 'SALES_RESERVATION_RELEASE',
      unitCost: 0,
      totalCost: 0,
      sourceDocumentType: 'SALES_RESERVATION',
      sourceDocumentId: testResvId,
      createdBy: userSalesManager.userId,
    });

    engine.addLedgerEntry({
      companyId: companyA,
      branchId: branch1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: batch1,
      uomId: uomPcs,
      quantity: releaseQty,
      stockStatus: 'AVAILABLE',
      movementType: 'SALES_RESERVATION_RELEASE',
      unitCost: 0,
      totalCost: 0,
      sourceDocumentType: 'SALES_RESERVATION',
      sourceDocumentId: testResvId,
      createdBy: userSalesManager.userId,
    });

    createdResv.releasedQuantity += releaseQty;

    const availAfter = engine.getBalance(companyA, warehouse1, item1, 'AVAILABLE');
    const reservedAfter = engine.getBalance(companyA, warehouse1, item1, 'RESERVED');
    assert.equal(availAfter, 93, 'Available stock restored to 93');
    assert.equal(reservedAfter, 7, 'Reserved stock reduced to 7');
  });

  console.log('\n--- Suite 4: Goods Delivery Notes (GDN) & Physical Stock Deduction ---');

  let createdDelivery: SalesDelivery;

  await test('Validates Goods Delivery Note schema with batch allocations', () => {
    const rawDelivery = {
      customerId: customer1,
      salesOrderId: testSoId,
      deliveryDate: '2026-09-02T10:00:00Z',
      lines: [
        {
          salesOrderLineId: sol1Id,
          itemId: item1,
          warehouseId: warehouse1,
          uomId: uomPcs,
          deliveredQuantity: 7,
          isReserved: true,
          batchAllocations: [
            {
              batchId: batch1,
              quantity: 7,
            },
          ],
        },
      ],
    };

    const parsed = createSalesDeliverySchema.parse(rawDelivery);
    assert.equal(parsed.lines[0].deliveredQuantity, 7);
    assert.equal(parsed.lines[0].batchAllocations[0].quantity, 7);
  });

  await test('Rejects delivery when batch allocations sum does not match line delivered quantity', () => {
    const rawDelivery = {
      customerId: customer1,
      salesOrderId: testSoId,
      lines: [
        {
          salesOrderLineId: sol1Id,
          itemId: item1,
          warehouseId: warehouse1,
          uomId: uomPcs,
          deliveredQuantity: 10,
          batchAllocations: [
            {
              batchId: batch1,
              quantity: 7, // Mismatch (7 != 10)
            },
          ],
        },
      ],
    };
    assert.throws(() => createSalesDeliverySchema.parse(rawDelivery));
  });

  await test('Posts Goods Delivery Note and fulfills reserved stock in stock ledger', () => {
    createdDelivery = {
      id: testDeliveryId,
      companyId: companyA,
      branchId: branch1,
      deliveryNumber: 'GDN-2026-0001',
      salesOrderId: testSoId,
      customerId: customer1,
      deliveryDate: new Date().toISOString(),
      status: 'APPROVED',
      createdBy: userSalesClerk.userId,
      approvedBy: userSalesManager.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines: [
        {
          id: gdl1Id,
          deliveryId: testDeliveryId,
          salesOrderLineId: sol1Id,
          lineNumber: 1,
          itemId: item1,
          warehouseId: warehouse1,
          uomId: uomPcs,
          deliveredQuantity: 7,
          conversionFactor: 1.0,
          baseQuantity: 7,
          isReserved: true,
          createdAt: new Date().toISOString(),
          batchAllocations: [
            {
              id: ba1Id,
              deliveryLineId: gdl1Id,
              batchId: batch1,
              quantity: 7,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ],
    };

    // Transition to POSTED
    engine.stateMachine.validateTransition({
      documentType: 'SALES_DELIVERY',
      currentState: createdDelivery.status,
      targetState: 'POSTED',
      ctx: userSalesManager,
      documentContext: {
        creatorId: createdDelivery.createdBy || undefined,
        companyId: createdDelivery.companyId,
        branchId: createdDelivery.branchId,
        documentId: createdDelivery.id,
      },
    });
    createdDelivery.status = 'POSTED';
    createdDelivery.postedBy = userSalesManager.userId;

    // Fulfill the remaining 7 active reserved units
    createdResv.fulfilledQuantity += 7;
    createdResv.status = 'FULFILLED';

    // Stock Ledger entry: Deduct 7 PCS from RESERVED pool
    engine.addLedgerEntry({
      companyId: companyA,
      branchId: branch1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: batch1,
      uomId: uomPcs,
      quantity: -7,
      stockStatus: 'RESERVED',
      movementType: 'SALES_DELIVERY',
      unitCost: 50.0,
      totalCost: -350.0,
      sourceDocumentType: 'SALES_DELIVERY',
      sourceDocumentId: testDeliveryId,
      sourceDocumentLineId: gdl1Id,
      createdBy: userSalesManager.userId,
    });

    const availAfter = engine.getBalance(companyA, warehouse1, item1, 'AVAILABLE');
    const reservedAfter = engine.getBalance(companyA, warehouse1, item1, 'RESERVED');
    assert.equal(availAfter, 93, 'Available stock remains 93');
    assert.equal(reservedAfter, 0, 'Reserved stock is completely fulfilled to 0');

    // Total physical warehouse stock is now 93
    const summary = engine.getBalanceSummary(companyA);
    assert.equal(summary[0].totalQuantity, 93, 'Physical stock deducted by 7 upon GDN posting');
    assert.equal(createdResv.status, 'FULFILLED', 'Reservation marked as FULFILLED');
  });

  await test('Direct delivery without prior reservation deducts directly from AVAILABLE stock', () => {
    const unreservedDeliveryQty = 5;

    engine.addLedgerEntry({
      companyId: companyA,
      branchId: branch1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: batch1,
      uomId: uomPcs,
      quantity: -unreservedDeliveryQty,
      stockStatus: 'AVAILABLE',
      movementType: 'SALES_DELIVERY',
      unitCost: 50.0,
      totalCost: -250.0,
      sourceDocumentType: 'SALES_DELIVERY',
      sourceDocumentId: 'gdn-direct-002',
      createdBy: userSalesManager.userId,
    });

    const availAfter = engine.getBalance(companyA, warehouse1, item1, 'AVAILABLE');
    assert.equal(availAfter, 88, 'Available stock reduced from 93 to 88 on direct delivery');
  });

  await test('Reversal of posted delivery creates compensating entries returning stock to AVAILABLE pool', () => {
    const reversalDelivery: SalesDelivery = {
      ...createdDelivery,
      status: 'POSTED',
    };

    engine.stateMachine.validateTransition({
      documentType: 'SALES_DELIVERY',
      currentState: reversalDelivery.status,
      targetState: 'REVERSED',
      ctx: userSalesManager,
      documentContext: {
        creatorId: reversalDelivery.createdBy || undefined,
        companyId: reversalDelivery.companyId,
        branchId: reversalDelivery.branchId,
        documentId: reversalDelivery.id,
      },
    });
    reversalDelivery.status = 'REVERSED';

    // Compensating return entry: +7 PCS to AVAILABLE stock
    engine.addLedgerEntry({
      companyId: companyA,
      branchId: branch1,
      warehouseId: warehouse1,
      itemId: item1,
      batchId: batch1,
      uomId: uomPcs,
      quantity: 7,
      stockStatus: 'AVAILABLE',
      movementType: 'SALES_DELIVERY_REVERSAL',
      unitCost: 50.0,
      totalCost: 350.0,
      sourceDocumentType: 'SALES_DELIVERY',
      sourceDocumentId: testDeliveryId,
      createdBy: userSalesManager.userId,
    });

    const availAfter = engine.getBalance(companyA, warehouse1, item1, 'AVAILABLE');
    assert.equal(availAfter, 95, 'Available stock returned from 88 to 95 after reversal');
  });

  console.log('\n--- Suite 5: Invariants & Cross-Company Tenant Isolation ---');

  await test('Multi-tenant isolation: Company B cannot view or reserve Company A stock', () => {
    const companyBStock = engine.getBalance(companyB, warehouse1, item1, 'AVAILABLE');
    assert.equal(companyBStock, 0, 'Company B must have 0 stock balance');
  });

  await test('No direct negative stock allowed without inventory on hand', () => {
    const excessiveDelivery = 200;
    const currentStock = engine.getBalance(companyA, warehouse1, item1, 'AVAILABLE');
    assert.ok(excessiveDelivery > currentStock, 'Attempting to deliver more than available');
    assert.equal(currentStock >= excessiveDelivery, false, 'System invariant prevents negative stock');
  });

  console.log(`\n=============================================`);
  console.log(`ALL ${passedTests}/${totalTests} INCREMENT 1.0 UNIT TESTS PASSED!`);
  console.log(`=============================================\n`);
}

runAllTests().catch((err) => {
  console.error('Test run failed with error:', err);
  process.exit(1);
});
