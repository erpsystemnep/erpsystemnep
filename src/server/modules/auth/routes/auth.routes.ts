import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { UserRepository } from '../repositories/user.repository.js';
import { PasswordService } from '../services/password.service.js';
import { TokenService } from '../services/token.service.js';
import { requireAuth } from '../../../middleware/auth.js';

export function createAuthRouter(
  authService?: AuthService
): Router {
  const router = Router();

  // Initialize service dependencies if not injected
  const service =
    authService ||
    new AuthService(
      new UserRepository(),
      new PasswordService(),
      new TokenService()
    );

  /**
   * POST /login (or /api/v1/auth/login)
   * Authenticates user with email & password, returning JWT token and safe user profile.
   */
  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await service.login(req.body);
      res.status(200).json({
        data: result,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /users (or /api/v1/auth/users)
   * Provisions a new user account with securely hashed credentials.
   */
  router.post('/users', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await service.createUser(req.body, req.securityContext);
      res.status(201).json({
        data: user,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /me (or /api/v1/auth/me)
   * Resolves the profile of the currently authenticated user.
   */
  router.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.securityContext!.userId;
      const user = await service.getCurrentUser(userId);
      res.status(200).json({
        data: user,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /logout (or /api/v1/auth/logout)
   * Invalidates or concludes the active user session.
   */
  router.post('/logout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.securityContext!.userId;
      const result = await service.logout(userId);
      res.status(200).json({
        data: result,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
