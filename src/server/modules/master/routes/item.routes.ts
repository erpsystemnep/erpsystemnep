import { Router, Request, Response, NextFunction } from 'express';
import { ItemService } from '../services/item.service.js';
import { requireAuth, requirePermission, requireActiveCompany } from '../../../middleware/auth.js';

export function createItemRouter(
  itemService: ItemService = new ItemService()
): Router {
  const router = Router();

  // List items
  router.get(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.item.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await itemService.listItems(req.query, req.securityContext!);
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

  // Get item by ID
  router.get(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.item.view'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const item = await itemService.getItem(req.params.id, req.securityContext!);
        res.json({ success: true, data: item });
      } catch (err) {
        next(err);
      }
    }
  );

  // Create item
  router.post(
    '/',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.item.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const item = await itemService.createItem(req.body, req.securityContext!);
        res.status(201).json({ success: true, data: item });
      } catch (err) {
        next(err);
      }
    }
  );

  // Update item
  router.patch(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.item.edit'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const item = await itemService.updateItem(
          req.params.id,
          req.body,
          req.securityContext!
        );
        res.json({ success: true, data: item });
      } catch (err) {
        next(err);
      }
    }
  );

  // Delete / deactivate item
  router.delete(
    '/:id',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.item.delete'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const item = await itemService.deleteItem(req.params.id, req.securityContext!);
        res.json({ success: true, data: item, message: 'Item deactivated successfully' });
      } catch (err) {
        next(err);
      }
    }
  );

  // Add UOM conversion to item
  router.post(
    '/:id/conversions',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.item.create'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const conversion = await itemService.addConversion(req.params.id, req.body, req.securityContext!);
        res.status(201).json({ success: true, data: conversion });
      } catch (err) {
        next(err);
      }
    }
  );

  // Delete UOM conversion from item
  router.delete(
    '/:id/conversions/:conversionId',
    requireAuth,
    requireActiveCompany,
    requirePermission('master.item.delete'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await itemService.deleteConversion(req.params.id, req.params.conversionId, req.securityContext!);
        res.json({ success: true, message: 'Item UOM conversion removed successfully' });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
