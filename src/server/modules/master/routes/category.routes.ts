import { Router, Request, Response, NextFunction } from 'express';
import { CategoryService } from '../services/category.service.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createCategoryRouter(
  categoryService: CategoryService = new CategoryService()
): Router {
  const router = Router();

  // List categories
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.category.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await categoryService.listCategories(req.query, req.securityContext!);
        res.json({
          success: true,
          data: result.items,
          meta: {
            total: result.total,
            page: result.page,
            limit: result.limit,
            totalPages: result.totalPages,
          },
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Get category by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.category.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const category = await categoryService.getCategory(req.params.id, req.securityContext!);
        res.json({ success: true, data: category });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create category
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.category.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const category = await categoryService.createCategory(req.body, req.securityContext!);
        res.status(201).json({ success: true, data: category });
      } catch (err) {
        next(err);
      }
    }
  );

  // Update category
  router.patch(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.category.edit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const category = await categoryService.updateCategory(
          req.params.id,
          req.body,
          req.securityContext!
        );
        res.json({ success: true, data: category });
      } catch (err) {
        next(err);
      }
    }
  );

  // Delete / deactivate category
  router.delete(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.category.delete'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const category = await categoryService.deleteCategory(req.params.id, req.securityContext!);
        res.json({ success: true, data: category, message: 'Item category deactivated successfully' });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
