import { Router, Request, Response, NextFunction } from 'express';
import { OrgService } from '../services/org.service.js';
import { requirePermission, requireActiveCompany } from '../../../middleware/auth.js';
import { ApiResponse } from '../../../../shared/types/index.js';

export function createOrgRouter(orgService: OrgService = new OrgService()): Router {
  const router = Router();

  // --------------------------------------------------------------------------
  // COMPANIES ROUTES
  // --------------------------------------------------------------------------

  // List Companies
  router.get(
    '/companies',
    requirePermission('org.company.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;
        const companies = await orgService.listCompanies(req.securityContext!, { isActive });
        const response: ApiResponse = {
          success: true,
          data: companies,
        };
        res.json(response);
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Company by ID
  router.get(
    '/companies/:id',
    requirePermission('org.company.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const company = await orgService.getCompanyById(req.params.id, req.securityContext!);
        const response: ApiResponse = {
          success: true,
          data: company,
        };
        res.json(response);
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Company
  router.post(
    '/companies',
    requirePermission('org.company.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const company = await orgService.createCompany(req.body, req.securityContext!);
        const response: ApiResponse = {
          success: true,
          data: company,
        };
        res.status(201).json(response);
      } catch (err) {
        next(err);
      }
    }
  );

  // Update Company
  router.patch(
    '/companies/:id',
    requirePermission('org.company.edit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const company = await orgService.updateCompany(req.params.id, req.body, req.securityContext!);
        const response: ApiResponse = {
          success: true,
          data: company,
        };
        res.json(response);
      } catch (err) {
        next(err);
      }
    }
  );

  // --------------------------------------------------------------------------
  // BRANCHES ROUTES
  // --------------------------------------------------------------------------

  // List Branches (Scoped to active company or query companyId for superadmins)
  router.get(
    '/branches',
    requirePermission('org.branch.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = (req.query.companyId as string) || req.securityContext?.activeCompanyId;
        if (!companyId) {
          res.status(400).json({
            success: false,
            error: { code: 'TENANT_NOT_FOUND', message: 'companyId query param or active company context is required' },
          });
          return;
        }

        const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;
        const branches = await orgService.listBranches(companyId, req.securityContext!, { isActive });
        const response: ApiResponse = {
          success: true,
          data: branches,
        };
        res.json(response);
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Branch by ID
  router.get(
    '/branches/:id',
    requirePermission('org.branch.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const branch = await orgService.getBranchById(req.params.id, req.securityContext!);
        const response: ApiResponse = {
          success: true,
          data: branch,
        };
        res.json(response);
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Branch
  router.post(
    '/branches',
    requirePermission('org.branch.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // If companyId not specified in body, default to security context activeCompanyId
        const payload = {
          ...req.body,
          companyId: req.body.companyId || req.securityContext?.activeCompanyId,
        };
        const branch = await orgService.createBranch(payload, req.securityContext!);
        const response: ApiResponse = {
          success: true,
          data: branch,
        };
        res.status(201).json(response);
      } catch (err) {
        next(err);
      }
    }
  );

  // Update Branch
  router.patch(
    '/branches/:id',
    requirePermission('org.branch.edit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const branch = await orgService.updateBranch(req.params.id, req.body, req.securityContext!);
        const response: ApiResponse = {
          success: true,
          data: branch,
        };
        res.json(response);
      } catch (err) {
        next(err);
      }
    }
  );

  // --------------------------------------------------------------------------
  // WAREHOUSES ROUTES
  // --------------------------------------------------------------------------

  // List Warehouses (Scoped to company; supports optional branchId filter)
  router.get(
    '/warehouses',
    requirePermission('org.warehouse.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const companyId = (req.query.companyId as string) || req.securityContext?.activeCompanyId;
        if (!companyId) {
          res.status(400).json({
            success: false,
            error: { code: 'TENANT_NOT_FOUND', message: 'companyId query param or active company context is required' },
          });
          return;
        }

        const branchId =
          req.query.branchId === 'null'
            ? null
            : typeof req.query.branchId === 'string'
            ? req.query.branchId
            : undefined;

        const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;
        const warehouses = await orgService.listWarehouses(companyId, req.securityContext!, {
          branchId,
          isActive,
        });
        const response: ApiResponse = {
          success: true,
          data: warehouses,
        };
        res.json(response);
      } catch (err) {
        next(err);
      }
    }
  );

  // Get Warehouse by ID
  router.get(
    '/warehouses/:id',
    requirePermission('org.warehouse.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const warehouse = await orgService.getWarehouseById(req.params.id, req.securityContext!);
        const response: ApiResponse = {
          success: true,
          data: warehouse,
        };
        res.json(response);
      } catch (err) {
        next(err);
      }
    }
  );

  // Create Warehouse
  router.post(
    '/warehouses',
    requirePermission('org.warehouse.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const payload = {
          ...req.body,
          companyId: req.body.companyId || req.securityContext?.activeCompanyId,
        };
        const warehouse = await orgService.createWarehouse(payload, req.securityContext!);
        const response: ApiResponse = {
          success: true,
          data: warehouse,
        };
        res.status(201).json(response);
      } catch (err) {
        next(err);
      }
    }
  );

  // Update Warehouse
  router.patch(
    '/warehouses/:id',
    requirePermission('org.warehouse.edit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const warehouse = await orgService.updateWarehouse(req.params.id, req.body, req.securityContext!);
        const response: ApiResponse = {
          success: true,
          data: warehouse,
        };
        res.json(response);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
