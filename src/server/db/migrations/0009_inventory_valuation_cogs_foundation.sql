-- ============================================================================
-- Migration: 0009_inventory_valuation_cogs_foundation.sql
-- Description: Inventory Valuation Subledger (FIFO Cost Layers), COGS Tracking,
--              Inventory-GL Reconciliation & Journal References
-- ============================================================================

-- 1. Create inventory_cost_layers table
CREATE TABLE IF NOT EXISTS inventory_cost_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  uom_id UUID NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
  initial_quantity NUMERIC(15, 4) NOT NULL,
  remaining_quantity NUMERIC(15, 4) NOT NULL,
  unit_cost NUMERIC(15, 4) NOT NULL,
  total_cost NUMERIC(15, 4) NOT NULL,
  remaining_value NUMERIC(15, 4) NOT NULL,
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  exchange_rate NUMERIC(15, 6) NOT NULL DEFAULT 1.000000,
  source_document_type VARCHAR(50) NOT NULL,
  source_document_id UUID NOT NULL,
  source_document_line_id UUID,
  accounting_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_exhausted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cost_layers_batch_lookup
  ON inventory_cost_layers(company_id, warehouse_id, item_id, batch_id, remaining_quantity);

CREATE INDEX IF NOT EXISTS idx_cost_layers_date
  ON inventory_cost_layers(company_id, accounting_date);

-- 2. Create inventory_valuation_transactions table
CREATE TABLE IF NOT EXISTS inventory_valuation_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL REFERENCES inventory_batches(id) ON DELETE RESTRICT,
  cost_layer_id UUID REFERENCES inventory_cost_layers(id) ON DELETE SET NULL,
  transaction_type VARCHAR(50) NOT NULL, -- 'RECEIPT', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'REVERSAL'
  source_type VARCHAR(50) NOT NULL,
  source_id UUID NOT NULL,
  source_line_id UUID,
  quantity NUMERIC(15, 4) NOT NULL,
  unit_cost NUMERIC(15, 4) NOT NULL,
  total_cost NUMERIC(15, 4) NOT NULL,
  currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
  exchange_rate NUMERIC(15, 6) NOT NULL DEFAULT 1.000000,
  base_unit_cost NUMERIC(15, 4) NOT NULL,
  base_total_cost NUMERIC(15, 4) NOT NULL,
  accounting_date DATE NOT NULL DEFAULT CURRENT_DATE,
  journal_id UUID REFERENCES accounting_journals(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'POSTED', -- 'POSTED', 'REVERSED'
  reversal_journal_id UUID REFERENCES accounting_journals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_val_tx_source
  ON inventory_valuation_transactions(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_val_tx_company_date
  ON inventory_valuation_transactions(company_id, accounting_date);

CREATE INDEX IF NOT EXISTS idx_val_tx_item_batch
  ON inventory_valuation_transactions(company_id, item_id, batch_id);

-- 3. Add journal tracking and reversal columns to purchase_receipts if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'purchase_receipts' AND column_name = 'journal_id'
  ) THEN
    ALTER TABLE purchase_receipts ADD COLUMN journal_id UUID REFERENCES accounting_journals(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'purchase_receipts' AND column_name = 'reversed_by'
  ) THEN
    ALTER TABLE purchase_receipts ADD COLUMN reversed_by UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'purchase_receipts' AND column_name = 'reversed_at'
  ) THEN
    ALTER TABLE purchase_receipts ADD COLUMN reversed_at TIMESTAMPTZ;
  END IF;
END $$;

-- 4. Add journal tracking and reversal columns to sales_deliveries if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales_deliveries' AND column_name = 'journal_id'
  ) THEN
    ALTER TABLE sales_deliveries ADD COLUMN journal_id UUID REFERENCES accounting_journals(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales_deliveries' AND column_name = 'reversed_by'
  ) THEN
    ALTER TABLE sales_deliveries ADD COLUMN reversed_by UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales_deliveries' AND column_name = 'reversed_at'
  ) THEN
    ALTER TABLE sales_deliveries ADD COLUMN reversed_at TIMESTAMPTZ;
  END IF;
END $$;
