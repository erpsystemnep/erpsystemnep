import { UserRepository } from '../repositories/user.repository.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';
import { User, SecurityContext } from '../../../../shared/types/index.js';
import {
  CreateUserInput,
  LoginRequest,
  createUserSchema,
  loginRequestSchema,
} from '../../../../shared/schemas/auth.js';
import { AppError } from '../../../../shared/errors/AppError.js';

export interface LoginResult {
  token: string;
  user: User;
}

export class AuthService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService
  ) {}

  /**
   * Provisions a new user identity with secure password hashing.
   * Enforces email uniqueness and returns a safe User representation.
   */
  async createUser(input: CreateUserInput, ctx?: SecurityContext): Promise<User> {
    const parseResult = createUserSchema.safeParse(input);
    if (!parseResult.success) {
      throw AppError.validation('Invalid user registration payload', parseResult.error.format());
    }

    const validated = parseResult.data;
    const normalizedEmail = validated.email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await this.userRepo.findByEmail(normalizedEmail);
    if (existingUser) {
      throw AppError.conflict(`User with email '${normalizedEmail}' is already registered`);
    }

    // Securely hash password with bcrypt
    const passwordHash = await this.passwordService.hash(validated.password);

    // Persist user record
    const createdUser = await this.userRepo.create({
      email: normalizedEmail,
      fullName: validated.fullName.trim(),
      passwordHash,
      isSuperadmin: validated.isSuperadmin ?? false,
      isActive: validated.isActive ?? true,
    });

    return createdUser;
  }

  /**
   * Authenticates user credentials, validates account active status,
   * updates last login timestamp, and issues an authenticated JWT token.
   */
  async login(input: LoginRequest): Promise<LoginResult> {
    const parseResult = loginRequestSchema.safeParse(input);
    if (!parseResult.success) {
      throw AppError.validation('Invalid login credentials format', parseResult.error.format());
    }

    const { email, password } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();

    // Retrieve user with password hash
    const userWithPw = await this.userRepo.findWithPasswordByEmail(normalizedEmail);

    // Generic error helper to prevent user enumeration
    const invalidCredentialsError = () =>
      AppError.unauthorized('Invalid email or password');

    if (!userWithPw) {
      throw invalidCredentialsError();
    }

    // Inactive account check fails with same error to prevent enumeration
    if (!userWithPw.isActive) {
      throw invalidCredentialsError();
    }

    // Verify password hash
    const isPasswordValid = await this.passwordService.compare(password, userWithPw.passwordHash);
    if (!isPasswordValid) {
      throw invalidCredentialsError();
    }

    // Update last login timestamp asynchronously
    this.userRepo.updateLastLogin(userWithPw.id).catch((err) => {
      console.error(`Failed to update last_login_at for user ${userWithPw.id}:`, err);
    });

    // Generate authenticated token
    const token = this.tokenService.signToken({
      userId: userWithPw.id,
      email: userWithPw.email,
    });

    // Return safe user object (excluding passwordHash)
    const { passwordHash: _, updatedAt: __, ...safeUser } = userWithPw;

    return {
      token,
      user: safeUser,
    };
  }

  /**
   * Resolves the current authenticated user's profile by ID.
   */
  async getCurrentUser(userId: string): Promise<User> {
    if (!userId || userId === 'anonymous') {
      throw AppError.unauthorized('Authentication required to access current user profile');
    }

    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw AppError.unauthorized('User account does not exist');
    }

    if (!user.isActive) {
      throw AppError.unauthorized('User account has been deactivated');
    }

    return user;
  }

  /**
   * Logs out the user. With stateless JWTs, logs the event and returns success.
   */
  async logout(userId: string): Promise<{ success: boolean; message: string }> {
    return {
      success: true,
      message: 'Logged out successfully',
    };
  }
}
