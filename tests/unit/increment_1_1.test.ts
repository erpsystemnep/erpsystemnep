import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  SalesInvoice,
  SalesInvoiceLine,
  SalesInvoiceStatus,
  CustomerReceivable,
  CustomerReceivableStatus,
  SalesOrder,
  SalesOrderLine,
  SalesDelivery,
  SalesDeliveryLine,
  SecurityContext,
} from '../../src/shared/types/index.js';
import {
  createSalesInvoiceSchema,
  updateSalesInvoiceSchema,
} from '../../src/shared/schemas/sales_invoice.js';
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

console.log('\n=== RUNNING INCREMENT 1.1 ACCOUNTS RECEIVABLE & SALES INVOICING UNIT TESTS ===\n');

// ----------------------------------------------------------------------------
// In-Memory Simulation Engine for Sales Invoicing & Receivables
// ----------------------------------------------------------------------------

interface TenantContext {
  companyId: string;
  branchId: string | null;
  userId: string;
  roles: string[];
  permissions: string[];
}

class InMemorySalesInvoicingEngine {
  public salesOrders: Map<string, SalesOrder> = new Map();
  public salesDeliveries: Map<string, SalesDelivery> = new Map();
  public salesInvoices: Map<string, SalesInvoice> = new Map();
  public customerReceivables: Map<string, CustomerReceivable> = new Map();
  public businessPartners: Map<string, { id: string; companyId: string; legalName: string; isCustomer: boolean; isActive: boolean }> = new Map();
  public items: Map<string, { id: string; companyId: string; sku: string; itemName: string; isSellable: boolean; isActive: boolean }> = new Map();
  public uoms: Map<string, { id: string; companyId: string; code: string; isActive: boolean }> = new Map();
  public stateMachine = new StateMachineEngine();
  private invoiceCounter = 1;

  public createSecurityContext(tenant: TenantContext): SecurityContext {
    return {
      userId: tenant.userId,
      email: 'user@test.com',
      fullName: 'Test User',
      isSuperadmin: tenant.roles.includes('SUPERADMIN'),
      activeCompanyId: tenant.companyId,
      activeBranchId: tenant.branchId,
      effectivePermissions: tenant.permissions,
    };
  }

  public getInvoicedQuantityForDeliveryLine(deliveryLineId: string, excludeInvoiceId?: string): number {
    let total = 0;
    for (const inv of this.salesInvoices.values()) {
      if (inv.id === excludeInvoiceId) continue;
      if (!['SUBMITTED', 'APPROVED', 'POSTED'].includes(inv.status)) continue;
      for (const line of inv.lines || []) {
        if (line.deliveryLineId === deliveryLineId) {
          total += line.quantity;
        }
      }
    }
    return total;
  }

  public getInvoicedQuantityForSalesOrderLine(soLineId: string, excludeInvoiceId?: string): number {
    let total = 0;
    for (const inv of this.salesInvoices.values()) {
      if (inv.id === excludeInvoiceId) continue;
      if (!['SUBMITTED', 'APPROVED', 'POSTED'].includes(inv.status)) continue;
      for (const line of inv.lines || []) {
        if (line.salesOrderLineId === soLineId) {
          total += line.quantity;
        }
      }
    }
    return total;
  }

  public async createInvoice(
    input: any,
    ctx: SecurityContext
  ): Promise<SalesInvoice> {
    const companyId = ctx.activeCompanyId;
    if (!companyId) throw new Error('Active company context is required');

    // 1. Validate Customer
    const customer = this.businessPartners.get(input.customerId);
    if (!customer || customer.companyId !== companyId) {
      throw new Error(`Customer '${input.customerId}' not found in active company`);
    }
    if (!customer.isCustomer) {
      throw new Error(`Business partner '${customer.legalName}' is not registered as a customer`);
    }
    if (!customer.isActive) {
      throw new Error(`Customer '${customer.legalName}' is inactive`);
    }

    // 2. Validate Source SO
    if (input.salesOrderId) {
      const so = this.salesOrders.get(input.salesOrderId);
      if (!so || so.companyId !== companyId) {
        throw new Error(`Source Sales Order '${input.salesOrderId}' not found in active company`);
      }
      if (so.customerId !== input.customerId) {
        throw new Error('Source Sales Order customer does not match invoice customer');
      }
      if (!['APPROVED', 'POSTED'].includes(so.status)) {
        throw new Error(`Source Sales Order '${so.soNumber}' must be APPROVED or POSTED to be invoiced`);
      }
    }

    // 3. Validate Source Delivery
    if (input.deliveryId) {
      const del = this.salesDeliveries.get(input.deliveryId);
      if (!del || del.companyId !== companyId) {
        throw new Error(`Source Delivery '${input.deliveryId}' not found in active company`);
      }
      if (del.customerId !== input.customerId) {
        throw new Error('Source Delivery customer does not match invoice customer');
      }
      if (del.status !== 'POSTED') {
        throw new Error(`Source Delivery '${del.deliveryNumber}' must be POSTED to be invoiced`);
      }
    }

    // 4. Validate Lines & Ceilings
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    let grandTotal = 0;
    const lines: SalesInvoiceLine[] = [];
    const invoiceId = randomUUID();

    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i];
      const item = this.items.get(line.itemId);
      if (!item || item.companyId !== companyId) {
        throw new Error(`Item '${line.itemId}' not found in company`);
      }
      if (!item.isSellable) {
        throw new Error(`Item '${item.itemName}' is not marked as sellable`);
      }
      if (!item.isActive) {
        throw new Error(`Item '${item.itemName}' is inactive`);
      }

      // Check delivery line ceiling
      if (line.deliveryLineId) {
        const del = this.salesDeliveries.get(input.deliveryId);
        const delLine = del?.lines?.find((l) => l.id === line.deliveryLineId);
        if (!delLine) throw new Error(`Source Delivery Line '${line.deliveryLineId}' not found`);

        const alreadyInvoiced = this.getInvoicedQuantityForDeliveryLine(line.deliveryLineId);
        const remaining = delLine.deliveredQuantity - alreadyInvoiced;
        if (line.quantity > remaining + 0.0001) {
          throw new Error(`Requested invoice quantity (${line.quantity}) exceeds remaining invoiceable delivered quantity (${remaining})`);
        }
      }

      // Check SO line ceiling
      if (line.salesOrderLineId) {
        const so = this.salesOrders.get(input.salesOrderId);
        const soLine = so?.lines?.find((l) => l.id === line.salesOrderLineId);
        if (!soLine) throw new Error(`Source Sales Order Line '${line.salesOrderLineId}' not found`);

        const alreadyInvoiced = this.getInvoicedQuantityForSalesOrderLine(line.salesOrderLineId);
        const remaining = soLine.orderedQuantity - alreadyInvoiced;
        if (line.quantity > remaining + 0.0001) {
          throw new Error(`Requested invoice quantity (${line.quantity}) exceeds remaining invoiceable ordered quantity (${remaining})`);
        }
      }

      const gross = line.quantity * line.unitPrice;
      const discountAmount = (gross * (line.discountRate || 0)) / 100;
      const lineNet = gross - discountAmount;
      const taxAmount = (lineNet * (line.taxRate || 0)) / 100;
      const lineTotal = lineNet + taxAmount;

      subtotal += lineNet;
      discountTotal += discountAmount;
      taxTotal += taxAmount;
      grandTotal += lineTotal;

      lines.push({
        id: randomUUID(),
        salesInvoiceId: invoiceId,
        salesOrderLineId: line.salesOrderLineId || null,
        deliveryLineId: line.deliveryLineId || null,
        lineNumber: i + 1,
        itemId: line.itemId,
        warehouseId: line.warehouseId || null,
        uomId: line.uomId,
        quantity: line.quantity,
        conversionFactor: line.conversionFactor || 1.0,
        baseQuantity: line.baseQuantity || line.quantity,
        unitPrice: line.unitPrice,
        discountRate: line.discountRate || 0,
        discountAmount,
        taxRate: line.taxRate || 0,
        taxAmount,
        lineNet,
        lineTotal,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    const invoiceNumber = `INV-${String(this.invoiceCounter++).padStart(5, '0')}`;
    const invoice: SalesInvoice = {
      id: invoiceId,
      companyId,
      branchId: input.branchId || null,
      invoiceNumber,
      customerId: input.customerId,
      salesOrderId: input.salesOrderId || null,
      deliveryId: input.deliveryId || null,
      invoiceDate: input.invoiceDate || new Date().toISOString().split('T')[0],
      dueDate: input.dueDate || null,
      status: 'DRAFT',
      currencyCode: input.currencyCode || 'USD',
      exchangeRate: input.exchangeRate || 1.0,
      subtotal,
      discountTotal,
      taxTotal,
      grandTotal,
      notes: input.notes || null,
      createdBy: ctx.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lines,
    };

    this.salesInvoices.set(invoiceId, invoice);
    return invoice;
  }

  public async submitInvoice(id: string, ctx: SecurityContext): Promise<SalesInvoice> {
    const invoice = this.salesInvoices.get(id);
    if (!invoice || invoice.companyId !== ctx.activeCompanyId) {
      throw new Error(`Invoice '${id}' not found`);
    }

    this.stateMachine.validateTransition({
      documentType: 'SALES_INVOICE',
      currentState: invoice.status,
      targetState: 'SUBMITTED',
      ctx,
      documentContext: {
        companyId: invoice.companyId,
        branchId: invoice.branchId,
        creatorId: invoice.createdBy || undefined,
        documentId: invoice.id,
      },
    });

    invoice.status = 'SUBMITTED';
    invoice.updatedAt = new Date().toISOString();
    return invoice;
  }

  public async approveInvoice(id: string, ctx: SecurityContext): Promise<SalesInvoice> {
    const invoice = this.salesInvoices.get(id);
    if (!invoice || invoice.companyId !== ctx.activeCompanyId) {
      throw new Error(`Invoice '${id}' not found`);
    }

    this.stateMachine.validateTransition({
      documentType: 'SALES_INVOICE',
      currentState: invoice.status,
      targetState: 'APPROVED',
      ctx,
      documentContext: {
        companyId: invoice.companyId,
        branchId: invoice.branchId,
        creatorId: invoice.createdBy || undefined,
        documentId: invoice.id,
      },
    });

    invoice.status = 'APPROVED';
    invoice.approvedBy = ctx.userId;
    invoice.approvedAt = new Date().toISOString();
    invoice.updatedAt = new Date().toISOString();
    return invoice;
  }

  public async postInvoice(id: string, ctx: SecurityContext): Promise<SalesInvoice> {
    const invoice = this.salesInvoices.get(id);
    if (!invoice || invoice.companyId !== ctx.activeCompanyId) {
      throw new Error(`Invoice '${id}' not found`);
    }

    this.stateMachine.validateTransition({
      documentType: 'SALES_INVOICE',
      currentState: invoice.status,
      targetState: 'POSTED',
      ctx,
      documentContext: {
        companyId: invoice.companyId,
        branchId: invoice.branchId,
        creatorId: invoice.createdBy || undefined,
        documentId: invoice.id,
      },
    });

    invoice.status = 'POSTED';
    invoice.postedBy = ctx.userId;
    invoice.postedAt = new Date().toISOString();
    invoice.updatedAt = new Date().toISOString();

    // Create Customer Receivable
    const receivableId = randomUUID();
    const receivable: CustomerReceivable = {
      id: receivableId,
      companyId: invoice.companyId,
      branchId: invoice.branchId || null,
      customerId: invoice.customerId,
      salesInvoiceId: invoice.id,
      currencyCode: invoice.currencyCode,
      invoiceAmount: invoice.grandTotal,
      paidAmount: 0,
      outstandingAmount: invoice.grandTotal,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate || null,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.customerReceivables.set(receivableId, receivable);
    invoice.receivable = receivable;

    return invoice;
  }

  public async reverseInvoice(id: string, reason: string, ctx: SecurityContext): Promise<SalesInvoice> {
    const invoice = this.salesInvoices.get(id);
    if (!invoice || invoice.companyId !== ctx.activeCompanyId) {
      throw new Error(`Invoice '${id}' not found`);
    }

    this.stateMachine.validateTransition({
      documentType: 'SALES_INVOICE',
      currentState: invoice.status,
      targetState: 'REVERSED',
      ctx,
      documentContext: {
        companyId: invoice.companyId,
        branchId: invoice.branchId,
        creatorId: invoice.createdBy || undefined,
        documentId: invoice.id,
      },
    });

    invoice.status = 'REVERSED';
    invoice.updatedAt = new Date().toISOString();

    // Reverse associated receivable
    for (const rec of this.customerReceivables.values()) {
      if (rec.salesInvoiceId === invoice.id) {
        rec.status = 'REVERSED';
        rec.updatedAt = new Date().toISOString();
      }
    }

    return invoice;
  }

  public async cancelInvoice(id: string, reason: string, ctx: SecurityContext): Promise<SalesInvoice> {
    const invoice = this.salesInvoices.get(id);
    if (!invoice || invoice.companyId !== ctx.activeCompanyId) {
      throw new Error(`Invoice '${id}' not found`);
    }

    this.stateMachine.validateTransition({
      documentType: 'SALES_INVOICE',
      currentState: invoice.status,
      targetState: 'CANCELLED',
      ctx,
      documentContext: {
        companyId: invoice.companyId,
        branchId: invoice.branchId,
        creatorId: invoice.createdBy || undefined,
        documentId: invoice.id,
      },
    });

    invoice.status = 'CANCELLED';
    invoice.updatedAt = new Date().toISOString();
    return invoice;
  }
}

// ----------------------------------------------------------------------------
// Test Execution
// ----------------------------------------------------------------------------

async function runIncrement11Tests() {
  const engine = new InMemorySalesInvoicingEngine();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const userCreator = randomUUID();
  const userApprover = randomUUID();
  const userPoster = randomUUID();

  const creatorCtx = engine.createSecurityContext({
    companyId: companyA,
    branchId: null,
    userId: userCreator,
    roles: ['SALES_OFFICER'],
    permissions: ['sales.invoice.view', 'sales.invoice.create', 'sales.invoice.edit', 'sales.invoice.cancel'],
  });

  const approverCtx = engine.createSecurityContext({
    companyId: companyA,
    branchId: null,
    userId: userApprover,
    roles: ['SALES_MANAGER'],
    permissions: ['sales.invoice.view', 'sales.invoice.approve', 'sales.invoice.reject'],
  });

  const posterCtx = engine.createSecurityContext({
    companyId: companyA,
    branchId: null,
    userId: userPoster,
    roles: ['SALES_MANAGER'],
    permissions: ['sales.invoice.view', 'sales.invoice.post', 'sales.invoice.reverse'],
  });

  const tenantBCtx = engine.createSecurityContext({
    companyId: companyB,
    branchId: null,
    userId: randomUUID(),
    roles: ['SALES_MANAGER'],
    permissions: ['*'],
  });

  // Seed master data
  const customerId = randomUUID();
  engine.businessPartners.set(customerId, {
    id: customerId,
    companyId: companyA,
    legalName: 'Acme Corporation Global',
    isCustomer: true,
    isActive: true,
  });

  const nonCustomerId = randomUUID();
  engine.businessPartners.set(nonCustomerId, {
    id: nonCustomerId,
    companyId: companyA,
    legalName: 'Global Raw Materials LLC',
    isCustomer: false,
    isActive: true,
  });

  const itemId = randomUUID();
  engine.items.set(itemId, {
    id: itemId,
    companyId: companyA,
    sku: 'PROD-SKU-100',
    itemName: 'Industrial Turbine Unit',
    isSellable: true,
    isActive: true,
  });

  const uomId = randomUUID();
  engine.uoms.set(uomId, {
    id: uomId,
    companyId: companyA,
    code: 'PCS',
    isActive: true,
  });

  // Seed Sales Order & Delivery
  const soId = randomUUID();
  const soLineId = randomUUID();
  engine.salesOrders.set(soId, {
    id: soId,
    companyId: companyA,
    soNumber: 'SO-00001',
    customerId,
    orderDate: new Date().toISOString().split('T')[0],
    status: 'APPROVED',
    currencyCode: 'USD',
    exchangeRate: 1.0,
    subtotal: 10000,
    taxTotal: 1000,
    grandTotal: 11000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lines: [
      {
        id: soLineId,
        salesOrderId: soId,
        lineNumber: 1,
        itemId,
        warehouseId: randomUUID(),
        uomId,
        orderedQuantity: 10,
        conversionFactor: 1,
        baseQuantity: 10,
        unitPrice: 1000,
        discountRate: 0,
        discountAmount: 0,
        taxRate: 10,
        taxAmount: 1000,
        lineTotal: 11000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  });

  const deliveryId = randomUUID();
  const deliveryLineId = randomUUID();
  engine.salesDeliveries.set(deliveryId, {
    id: deliveryId,
    companyId: companyA,
    deliveryNumber: 'GDN-00001',
    customerId,
    status: 'POSTED',
    deliveryDate: new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lines: [
      {
        id: deliveryLineId,
        deliveryId,
        salesOrderLineId: soLineId,
        lineNumber: 1,
        itemId,
        warehouseId: randomUUID(),
        uomId,
        deliveredQuantity: 6,
        conversionFactor: 1,
        baseQuantity: 6,
        isReserved: false,
        createdAt: new Date().toISOString(),
      },
    ],
  });

  console.log('--- Test Suite 1: Sales Invoice Creation & Pricing Calculations ---');

  let testInvoiceId = '';

  await test('Creates DRAFT sales invoice with server calculation of discount, net, tax, and totals', async () => {
    const input = {
      customerId,
      salesOrderId: soId,
      deliveryId,
      currencyCode: 'USD',
      exchangeRate: 1.0,
      lines: [
        {
          salesOrderLineId: soLineId,
          deliveryLineId,
          itemId,
          uomId,
          quantity: 4,
          unitPrice: 1000,
          discountRate: 10, // 10% discount = $400 discount, net = $3,600
          taxRate: 10, // 10% tax on net $3,600 = $360 tax
        },
      ],
    };

    const inv = await engine.createInvoice(input, creatorCtx);
    testInvoiceId = inv.id;

    assert.equal(inv.status, 'DRAFT');
    assert.equal(inv.subtotal, 3600);
    assert.equal(inv.discountTotal, 400);
    assert.equal(inv.taxTotal, 360);
    assert.equal(inv.grandTotal, 3960);
    assert.equal(inv.lines?.length, 1);
    assert.equal(inv.lines[0].lineNet, 3600);
    assert.equal(inv.lines[0].lineTotal, 3960);
    assert.equal(inv.lines[0].discountAmount, 400);
    assert.equal(inv.lines[0].taxAmount, 360);
  });

  await test('Rejects invoice creation for non-customer business partner', async () => {
    await assert.rejects(
      async () => {
        await engine.createInvoice(
          {
            customerId: nonCustomerId,
            lines: [{ itemId, uomId, quantity: 1, unitPrice: 100 }],
          },
          creatorCtx
        );
      },
      /is not registered as a customer/
    );
  });

  console.log('\n--- Test Suite 2: Invoicing Quantity Ceilings & Cumulative Enforcements ---');

  await test('Rejects invoice quantity exceeding remaining invoiceable delivered quantity', async () => {
    // Delivery has 6 units. First invoice created 4 units.
    // Submit first invoice so it counts towards cumulative active invoices.
    await engine.submitInvoice(testInvoiceId, creatorCtx);

    // Remaining invoiceable: 6 - 4 = 2 units. Attempting to invoice 3 units must fail.
    await assert.rejects(
      async () => {
        await engine.createInvoice(
          {
            customerId,
            deliveryId,
            lines: [
              {
                deliveryLineId,
                itemId,
                uomId,
                quantity: 3, // 3 > 2 remaining
                unitPrice: 1000,
              },
            ],
          },
          creatorCtx
        );
      },
      /exceeds remaining invoiceable delivered quantity/
    );
  });

  await test('Allows invoicing exactly the remaining quantity (2 units)', async () => {
    const secondInv = await engine.createInvoice(
      {
        customerId,
        deliveryId,
        lines: [
          {
            deliveryLineId,
            itemId,
            uomId,
            quantity: 2, // Exactly 2 remaining
            unitPrice: 1000,
          },
        ],
      },
      creatorCtx
    );
    assert.equal(secondInv.lines?.[0].quantity, 2);
  });

  console.log('\n--- Test Suite 3: Workflow, SoD & Financial Posting ---');

  await test('Enforces Segregation of Duties (SoD): Creator cannot approve own sales invoice', async () => {
    await assert.rejects(
      async () => {
        await engine.approveInvoice(testInvoiceId, creatorCtx);
      },
      /Segregation of duties/i
    );
  });

  await test('Authorized manager successfully approves sales invoice', async () => {
    const approvedInv = await engine.approveInvoice(testInvoiceId, approverCtx);
    assert.equal(approvedInv.status, 'APPROVED');
    assert.equal(approvedInv.approvedBy, userApprover);
  });

  await test('Financial Posting: APPROVED -> POSTED atomically creates Customer Receivable without touching stock ledger', async () => {
    const postedInv = await engine.postInvoice(testInvoiceId, posterCtx);
    assert.equal(postedInv.status, 'POSTED');
    assert.equal(postedInv.postedBy, userPoster);
    assert.ok(postedInv.receivable, 'Must have associated Customer Receivable');
    assert.equal(postedInv.receivable.invoiceAmount, 3960);
    assert.equal(postedInv.receivable.outstandingAmount, 3960);
    assert.equal(postedInv.receivable.paidAmount, 0);
    assert.equal(postedInv.receivable.status, 'OPEN');
  });

  console.log('\n--- Test Suite 4: Reversal & Immutability Protocols ---');

  await test('Reversal of posted sales invoice transitions status to REVERSED and cancels receivable', async () => {
    const reversedInv = await engine.reverseInvoice(testInvoiceId, 'Customer disputed billing amount', posterCtx);
    assert.equal(reversedInv.status, 'REVERSED');

    const receivable = Array.from(engine.customerReceivables.values()).find((r) => r.salesInvoiceId === testInvoiceId);
    assert.ok(receivable);
    assert.equal(receivable.status, 'REVERSED');
  });

  console.log('\n--- Test Suite 5: Multi-Tenant Isolation ---');

  await test('Blocks cross-tenant access to sales invoices', async () => {
    await assert.rejects(
      async () => {
        await engine.submitInvoice(testInvoiceId, tenantBCtx);
      },
      /not found/
    );
  });

  console.log('\n--- Test Suite 6: Schema Validation Edge Cases ---');

  await test('Schema rejects negative prices, invalid tax rates, or zero quantities', async () => {
    assert.throws(() => {
      createSalesInvoiceSchema.parse({
        customerId: randomUUID(),
        lines: [{ itemId: randomUUID(), uomId: randomUUID(), quantity: 0, unitPrice: 100 }],
      });
    });

    assert.throws(() => {
      createSalesInvoiceSchema.parse({
        customerId: randomUUID(),
        lines: [{ itemId: randomUUID(), uomId: randomUUID(), quantity: 5, unitPrice: -10 }],
      });
    });

    assert.throws(() => {
      createSalesInvoiceSchema.parse({
        customerId: randomUUID(),
        lines: [{ itemId: randomUUID(), uomId: randomUUID(), quantity: 5, unitPrice: 100, discountRate: 150 }],
      });
    });
  });

  console.log(`\n=============================================`);
  console.log(`ALL ${passedTests}/${totalTests} INCREMENT 1.1 UNIT TESTS PASSED!`);
  console.log(`=============================================\n`);
}

runIncrement11Tests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
