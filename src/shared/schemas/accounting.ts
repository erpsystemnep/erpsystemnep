import { z } from 'zod';

export const AccountTypeSchema = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);

export const CreateAccountSchema = z.object({
  accountCode: z.string().min(1, 'Account code is required').max(32),
  accountName: z.string().min(1, 'Account name is required').max(255),
  accountType: AccountTypeSchema,
  parentAccountId: z.string().uuid().optional().nullable(),
  isGroup: z.boolean().default(false),
  isActive: z.boolean().default(true),
  currencyCode: z.string().min(3).max(3).default('USD'),
  description: z.string().optional().nullable(),
});

export const UpdateAccountSchema = z.object({
  accountName: z.string().min(1).max(255).optional(),
  parentAccountId: z.string().uuid().optional().nullable(),
  isGroup: z.boolean().optional(),
  isActive: z.boolean().optional(),
  description: z.string().optional().nullable(),
});

export const JournalLineSchema = z.object({
  lineNumber: z.number().int().positive().optional(),
  accountId: z.string().uuid('Valid account ID is required'),
  partnerId: z.string().uuid().optional().nullable(),
  debit: z.number().min(0, 'Debit cannot be negative').default(0),
  credit: z.number().min(0, 'Credit cannot be negative').default(0),
  currencyCode: z.string().min(3).max(3).default('USD'),
  exchangeRate: z.number().positive('Exchange rate must be positive').default(1.0),
  description: z.string().optional().nullable(),
}).refine(
  (data) => !(data.debit > 0 && data.credit > 0),
  { message: 'A journal line cannot have both debit and credit greater than zero' }
).refine(
  (data) => data.debit > 0 || data.credit > 0,
  { message: 'A journal line must have either debit or credit greater than zero' }
);

export const CreateJournalSchema = z.object({
  branchId: z.string().uuid().optional().nullable(),
  postingDate: z.string().optional(),
  sourceDocumentType: z.string().default('MANUAL_JOURNAL'),
  sourceDocumentId: z.string().uuid().optional().nullable(),
  description: z.string().optional().nullable(),
  currencyCode: z.string().min(3).max(3).default('USD'),
  lines: z.array(JournalLineSchema).min(2, 'At least two journal lines are required'),
});

export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;
export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>;
export type CreateJournalInput = z.infer<typeof CreateJournalSchema>;
export type JournalLineInput = z.infer<typeof JournalLineSchema>;

// Aliases
export const createAccountSchema = CreateAccountSchema;
export const updateAccountSchema = UpdateAccountSchema;
export const createJournalSchema = CreateJournalSchema;
export const journalLineSchema = JournalLineSchema;
