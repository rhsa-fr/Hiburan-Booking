/**
 * Pure-logic tests for the auth rules. No database: `AuthRepository` is faked in
 * memory so rate limiting, expiry, attempt counting, single-use consumption and
 * password login are exercised deterministically with a fixed clock.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '@tarlink/core/errors';
import { verifyAccessToken, type Role } from '@tarlink/platform/auth';
import type {
  AuthRepository,
  AuthUserRecord,
  NewLoginAttempt,
  NewOtpRequest,
  NewSession,
  NewUser,
  OtpRequestRecord
} from './auth.repository';
import type { GoogleIdentity, GoogleTokenVerifier } from './google-verifier';
import { GoogleTokenInfoVerifier } from './google-verifier';
import { AuthController } from './auth.controller';
import {
  AuthService,
  INVALID_CREDENTIALS_MESSAGE,
  hashOtpCode,
  hashPassword,
  OTP_RATE_LIMIT_WINDOW_SECONDS,
  type AuthServiceDeps
} from './auth.service';

const SECRET = 'test-jwt-secret-at-least-16-chars';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PHONE = '628123456789';
const ADMIN_PHONE = '629111222333';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_EMAIL = 'admin@tarlink.id';
const ADMIN_PASSWORD = 'rahasia-admin-2026';

interface StoredOtpRequest extends OtpRequestRecord {
  requesterIp: string | null;
}

interface StoredUser {
  id: string;
  phone: string | null;
  email: string | null;
  passwordHash: string | null;
  name: string | null;
  googleSub: string | null;
  emailVerifiedAt: Date | null;
}

class FakeAuthRepository implements AuthRepository {
  readonly otpRequests: StoredOtpRequest[] = [];
  readonly users: StoredUser[] = [];
  readonly roles: Array<{ userId: string; role: Role }> = [];
  readonly sessions: Array<NewSession & { revokedAt: Date | null }> = [];
  readonly loginAttempts: NewLoginAttempt[] = [];
  readonly passwordUpdatedAt = new Map<string, Date>();

  async countRecentOtpRequests(phone: string, since: Date): Promise<number> {
    return this.otpRequests.filter((row) => row.phone === phone && row.createdAt >= since).length;
  }

  async insertOtpRequest(input: NewOtpRequest): Promise<void> {
    this.otpRequests.push({
      id: input.id,
      phone: input.phone,
      codeHash: input.codeHash,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      expiresAt: input.expiresAt,
      consumedAt: null,
      createdAt: input.createdAt,
      requesterIp: input.requesterIp
    });
  }

  async findActiveOtpRequest(phone: string, now: Date): Promise<OtpRequestRecord | null> {
    for (let i = this.otpRequests.length - 1; i >= 0; i -= 1) {
      const row = this.otpRequests[i];
      if (!row) continue;
      if (row.phone !== phone) continue;
      if (row.consumedAt !== null) continue;
      if (row.expiresAt <= now) continue;
      return { ...row };
    }
    return null;
  }

  async incrementOtpAttempts(id: string): Promise<number> {
    const row = this.otpRequests.find((candidate) => candidate.id === id);
    if (!row) throw new Error(`unknown OTP request ${id}`);
    row.attempts += 1;
    return row.attempts;
  }

  async consumeOtpRequest(id: string, consumedAt: Date): Promise<boolean> {
    const row = this.otpRequests.find((candidate) => candidate.id === id);
    if (!row || row.consumedAt !== null) return false;
    row.consumedAt = consumedAt;
    return true;
  }

  async findUserByPhone(phone: string): Promise<AuthUserRecord | null> {
    return this.users.find((user) => user.phone === phone) ?? null;
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const needle = email.trim().toLowerCase();
    return this.users.find((user) => user.email?.toLowerCase() === needle) ?? null;
  }

  async findUserByGoogleSub(googleSub: string): Promise<AuthUserRecord | null> {
    return this.users.find((user) => user.googleSub === googleSub) ?? null;
  }

  async emailExists(email: string): Promise<boolean> {
    const needle = email.trim().toLowerCase();
    return this.users.some((user) => user.email?.toLowerCase() === needle);
  }

  async phoneExists(phone: string): Promise<boolean> {
    return this.users.some((user) => user.phone === phone);
  }

  async createUser(input: NewUser): Promise<AuthUserRecord> {
    if ((await this.emailExists(input.email)) || (input.phone && (await this.phoneExists(input.phone)))) {
      throw new AppError('CONFLICT', 'Email atau nomor sudah terdaftar');
    }

    const user: StoredUser = {
      id: input.id,
      phone: input.phone,
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      googleSub: input.googleSub,
      emailVerifiedAt: input.emailVerifiedAt
    };
    this.users.push(user);
    this.roles.push({ userId: user.id, role: 'customer' });
    return user;
  }

  async linkGoogleAccount(userId: string, googleSub: string, verifiedAt: Date): Promise<void> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    user.googleSub = googleSub;
    user.emailVerifiedAt ??= verifiedAt;
  }

  async listActiveRoles(userId: string): Promise<Role[]> {
    return this.roles.filter((row) => row.userId === userId).map((row) => row.role);
  }

  async countFailedLoginAttempts(email: string, since: Date): Promise<number> {
    const needle = email.toLowerCase();
    return this.loginAttempts.filter(
      (row) => row.email.toLowerCase() === needle && !row.succeeded && row.createdAt >= since
    ).length;
  }

  async recordLoginAttempt(input: NewLoginAttempt): Promise<void> {
    this.loginAttempts.push({ ...input });
  }

  async updatePassword(userId: string, passwordHash: string, updatedAt: Date): Promise<boolean> {
    const index = this.users.findIndex((user) => user.id === userId);
    const current = this.users[index];
    if (!current) return false;
    this.users[index] = { ...current, passwordHash };
    this.passwordUpdatedAt.set(userId, updatedAt);
    return true;
  }

  async insertSession(input: NewSession): Promise<void> {
    this.sessions.push({ ...input, revokedAt: null });
  }

  async revokeAllSessions(userId: string, at: Date): Promise<number> {
    const active = this.sessions.filter((session) => session.userId === userId && !session.revokedAt);
    for (const session of active) session.revokedAt = at;
    return active.length;
  }

  async revokeSessions(userId: string, jti: string | null, at: Date): Promise<number> {
    const active = this.sessions.filter((session) => session.userId === userId && !session.revokedAt);
    const targets = jti ? active.filter((session) => session.jti === jti) : active.slice(-1);
    for (const session of targets) session.revokedAt = at;
    return targets.length;
  }
}

interface Harness {
  readonly repository: FakeAuthRepository;
  readonly service: AuthService;
  advance(seconds: number): void;
}

function makeHarness(overrides: Partial<AuthServiceDeps> = {}): Harness {
  const repository = new FakeAuthRepository();
  let current = new Date('2026-10-21T09:00:00.000Z');
  let sequence = 0;

  const service = new AuthService({
    repository,
    jwtSecret: SECRET,
    jwtTtlSeconds: 900,
    nodeEnv: 'test',
    now: () => current,
    newId: () => {
      sequence += 1;
      return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
    },
    ...overrides
  });

  return {
    repository,
    service,
    advance(seconds: number): void {
      current = new Date(current.getTime() + seconds * 1000);
    }
  };
}

function addUser(
  repository: FakeAuthRepository,
  roles: Role[] = [],
  options: {
    id?: string;
    phone?: string | null;
    email?: string | null;
    passwordHash?: string | null;
    name?: string | null;
    googleSub?: string | null;
    emailVerifiedAt?: Date | null;
  } = {}
): void {
  const id = options.id ?? USER_ID;
  repository.users.push({
    id,
    phone: options.phone === undefined ? PHONE : options.phone,
    email: options.email ?? null,
    passwordHash: options.passwordHash ?? null,
    name: options.name ?? null,
    googleSub: options.googleSub ?? null,
    emailVerifiedAt: options.emailVerifiedAt ?? null
  });
  for (const role of roles) repository.roles.push({ userId: id, role });
}

class FakeGoogleVerifier implements GoogleTokenVerifier {
  readonly calls: string[] = [];

  constructor(private readonly result: GoogleIdentity | Error) {}

  async verify(idToken: string): Promise<GoogleIdentity> {
    this.calls.push(idToken);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

async function requestCode(service: AuthService, phone = '0812-3456-789'): Promise<string> {
  const result = await service.requestOtp({ phone, ip: '203.0.113.7' });
  if (!result.dev_code) throw new Error('expected dev_code outside production');
  return result.dev_code;
}

describe('AuthService.requestOtp', () => {
  it('rejects the 4th request for one number within 10 minutes, across phone formats', async () => {
    const { repository, service } = makeHarness();

    await service.requestOtp({ phone: '0812-3456-789' });
    await service.requestOtp({ phone: '+62 812 3456 789' });
    await service.requestOtp({ phone: '628123456789' });

    await expect(service.requestOtp({ phone: '08123456789' })).rejects.toMatchObject({
      code: 'RATE_LIMITED'
    });
    expect(repository.otpRequests).toHaveLength(3);
    expect(repository.otpRequests.every((row) => row.phone === PHONE)).toBe(true);
  });

  it('allows a new request once the 10 minute window has passed', async () => {
    const { service, advance } = makeHarness();

    await service.requestOtp({ phone: '08123456789' });
    await service.requestOtp({ phone: '08123456789' });
    await service.requestOtp({ phone: '08123456789' });
    advance(OTP_RATE_LIMIT_WINDOW_SECONDS + 1);

    await expect(service.requestOtp({ phone: '08123456789' })).resolves.toMatchObject({
      channel: 'whatsapp',
      expires_in: 300
    });
  });

  it('stores only sha256(code:phone) and never the plaintext', async () => {
    const { repository, service } = makeHarness();
    const devCode = await requestCode(service);

    expect(devCode).toMatch(/^\d{6}$/);
    expect(repository.otpRequests[0]?.codeHash).toBe(hashOtpCode(devCode, PHONE));
    expect(JSON.stringify(repository.otpRequests)).not.toContain(`"${devCode}"`);
  });
});

describe('AuthService.verifyOtp', () => {
  it('rejects a wrong code and increments attempts without consuming the request', async () => {
    const { repository, service } = makeHarness();
    addUser(repository);
    const code = await requestCode(service);
    const wrong = code === '000000' ? '000001' : '000000';

    await expect(service.verifyOtp({ phone: '08123456789', code: wrong })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });

    const stored = repository.otpRequests[0];
    expect(stored?.attempts).toBe(1);
    expect(stored?.consumedAt).toBeNull();
    expect(repository.sessions).toHaveLength(0);
  });

  it('rejects an expired code', async () => {
    const { repository, service, advance } = makeHarness();
    addUser(repository);
    const code = await requestCode(service);
    advance(5 * 60 + 1);

    await expect(service.verifyOtp({ phone: '08123456789', code })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    expect(repository.otpRequests[0]?.attempts).toBe(0);
    expect(repository.sessions).toHaveLength(0);
  });

  it('consumes the code exactly once: a second verify fails', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer']);
    const code = await requestCode(service);

    const first = await service.verifyOtp({ phone: '08123456789', code });

    await expect(service.verifyOtp({ phone: '08123456789', code })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    expect(first.user.roles).toEqual(['customer']);
    expect(repository.otpRequests[0]?.consumedAt).not.toBeNull();
    expect(repository.sessions).toHaveLength(1);
  });

  it('issues a token with an empty roles array when the user has no roles', async () => {
    const { repository, service } = makeHarness();
    addUser(repository);
    const code = await requestCode(service);

    const result = await service.verifyOtp({ phone: '08123456789', code });
    const claims = verifyAccessToken(result.access_token, SECRET);

    expect(result.user.roles).toEqual([]);
    expect(claims.sub).toBe(USER_ID);
    expect(claims.roles).toEqual([]);
    expect(result.token_type).toBe('Bearer');
    expect(result.expires_in).toBe(900);
  });

  it('fails with NOT_FOUND when the code is valid but no user owns the number', async () => {
    const { service } = makeHarness();
    const code = await requestCode(service);

    await expect(service.verifyOtp({ phone: '08123456789', code })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });
});

describe('AuthService dev_code exposure', () => {
  it('includes dev_code outside production', async () => {
    const { service } = makeHarness({ nodeEnv: 'development' });
    const result = await service.requestOtp({ phone: '08123456789' });

    expect(result.dev_code).toMatch(/^\d{6}$/);
  });

  it('omits dev_code in production', async () => {
    const { service } = makeHarness({ nodeEnv: 'production' });
    const result = await service.requestOtp({ phone: '08123456789' });

    expect(result).not.toHaveProperty('dev_code');
  });
});

describe('AuthService.loginWithPassword', () => {
  async function addAdmin(
    repository: FakeAuthRepository,
    roles: Role[] = ['admin_super'],
    password = ADMIN_PASSWORD
  ): Promise<void> {
    addUser(repository, roles, {
      id: ADMIN_ID,
      phone: ADMIN_PHONE,
      email: ADMIN_EMAIL,
      passwordHash: await hashPassword(password)
    });
  }

  it('issues a token carrying the admin roles for a correct email and password', async () => {
    const { repository, service } = makeHarness();
    await addAdmin(repository, ['admin_finance', 'admin_super']);

    const result = await service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      ip: '203.0.113.9'
    });
    const claims = verifyAccessToken(result.access_token, SECRET);

    expect(result.token_type).toBe('Bearer');
    expect(result.expires_in).toBe(900);
    expect(claims.sub).toBe(ADMIN_ID);
    expect(claims.roles).toEqual(['admin_finance', 'admin_super']);
    expect(result.user).toEqual({
      id: ADMIN_ID,
      phone: ADMIN_PHONE,
      roles: ['admin_finance', 'admin_super'],
      email: ADMIN_EMAIL
    });
    expect(repository.sessions).toHaveLength(1);
    expect(repository.loginAttempts[0]).toMatchObject({
      email: ADMIN_EMAIL,
      succeeded: true
    });
  });

  it('rejects a wrong password with the generic message and records the attempt', async () => {
    const { repository, service } = makeHarness();
    await addAdmin(repository);

    await expect(
      service.loginWithPassword({ email: ADMIN_EMAIL, password: 'kata-sandi-salah' })
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: INVALID_CREDENTIALS_MESSAGE
    });

    expect(repository.loginAttempts).toHaveLength(1);
    expect(repository.loginAttempts[0]).toMatchObject({
      email: ADMIN_EMAIL,
      succeeded: false
    });
    expect(repository.sessions).toHaveLength(0);
  });

  it('logs a customer in with a customer-role token (password is for all roles)', async () => {
    const { repository, service } = makeHarness();
    await addAdmin(repository, ['customer', 'vendor_owner']);

    const result = await service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    const claims = verifyAccessToken(result.access_token, SECRET);

    expect(result.user.roles).toEqual(['customer', 'vendor_owner']);
    expect(claims.roles).toEqual(['customer', 'vendor_owner']);
    expect(result.user.email).toBe(ADMIN_EMAIL);
    expect(repository.sessions).toHaveLength(1);
    expect(repository.loginAttempts[0]?.succeeded).toBe(true);
  });

  it('rejects an account without a password hash', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['admin_support'], { email: ADMIN_EMAIL, passwordHash: null });

    await expect(
      service.loginWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: INVALID_CREDENTIALS_MESSAGE
    });

    expect(repository.loginAttempts[0]?.succeeded).toBe(false);
    expect(repository.sessions).toHaveLength(0);
  });

  it('blocks the 6th failure for one email within 10 minutes', async () => {
    const { repository, service } = makeHarness();
    await addAdmin(repository);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.loginWithPassword({ email: ADMIN_EMAIL, password: 'kata-sandi-salah' })
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }

    await expect(
      service.loginWithPassword({ email: ADMIN_EMAIL, password: 'kata-sandi-salah' })
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    expect(repository.loginAttempts).toHaveLength(6);
    expect(repository.loginAttempts.every((row) => !row.succeeded)).toBe(true);
  });

  it('setPassword stores a scrypt hash and revokes existing sessions', async () => {
    const { repository, service } = makeHarness();
    await addAdmin(repository);
    await service.loginWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(repository.sessions).toHaveLength(1);
    expect(repository.sessions[0]?.revokedAt).toBeNull();

    const newPassword = 'kata-sandi-baru-2026';
    await service.setPassword(ADMIN_ID, newPassword);

    expect(repository.sessions.every((session) => session.revokedAt !== null)).toBe(true);
    const stored = repository.users.find((user) => user.id === ADMIN_ID)?.passwordHash;
    expect(stored).toMatch(/^scrypt\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(stored).not.toContain(newPassword);
    expect(repository.passwordUpdatedAt.has(ADMIN_ID)).toBe(true);

    const relogin = await service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: newPassword
    });
    expect(relogin.user.roles).toEqual(['admin_super']);
  });

  it('matches the email case-insensitively', async () => {
    const { repository, service } = makeHarness();
    await addAdmin(repository);

    const result = await service.loginWithPassword({
      email: 'Admin@Tarlink.id',
      password: ADMIN_PASSWORD
    });

    expect(result.user.email).toBe(ADMIN_EMAIL);
    expect(repository.loginAttempts[0]?.email).toBe(ADMIN_EMAIL);
  });
});

describe('AuthService.register', () => {
  const NEW_EMAIL = 'new.customer@tarlink.id';
  const NEW_PHONE = '628123456789';
  const NEW_PASSWORD = 'kata-sandi-2026';

  it('creates a customer with a hashed password and returns a token without secrets', async () => {
    const { repository, service } = makeHarness();

    const result = await service.register({
      email: 'New.Customer@Tarlink.id',
      password: NEW_PASSWORD,
      phone: '0812-3456-789',
      full_name: 'Budi Santoso'
    });
    const claims = verifyAccessToken(result.access_token, SECRET);

    expect(result.user.roles).toEqual(['customer']);
    expect(claims.roles).toEqual(['customer']);
    expect(result.user.email).toBe(NEW_EMAIL);
    expect(result.user.phone).toBe(NEW_PHONE);
    expect(claims.sub).toBe(repository.users[0]?.id);

    const stored = repository.users[0];
    expect(stored).toMatchObject({
      phone: NEW_PHONE,
      email: NEW_EMAIL,
      name: 'Budi Santoso',
      googleSub: null,
      emailVerifiedAt: null
    });
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(stored?.passwordHash).not.toContain(NEW_PASSWORD);
    expect(JSON.stringify(result)).not.toContain(NEW_PASSWORD);
    expect(result.user).not.toHaveProperty('password');
    expect(repository.roles).toEqual([{ userId: stored?.id, role: 'customer' }]);
  });

  it('rejects a duplicate email with CONFLICT', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], { email: NEW_EMAIL, phone: '629111000111' });

    await expect(
      service.register({ email: 'NEW.CUSTOMER@tarlink.id', password: NEW_PASSWORD, phone: '081234567890' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(repository.users).toHaveLength(1);
    expect(repository.sessions).toHaveLength(0);
  });

  it('rejects a duplicate phone with CONFLICT', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], { email: 'other@tarlink.id', phone: NEW_PHONE });

    await expect(
      service.register({ email: NEW_EMAIL, password: NEW_PASSWORD, phone: '08123456789' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(repository.users).toHaveLength(1);
  });
});

describe('AuthService.loginWithGoogle', () => {
  const GOOGLE_EMAIL = 'google.user@tarlink.id';

  function verifierWith(identity: GoogleIdentity): FakeGoogleVerifier {
    return new FakeGoogleVerifier(identity);
  }

  it('creates a phone-less customer for a new Google account', async () => {
    const verifier = verifierWith({
      sub: 'google-sub-new',
      email: 'Google.User@Tarlink.id',
      emailVerified: true
    });
    const { repository, service } = makeHarness({ googleVerifier: verifier });

    const result = await service.loginWithGoogle({ id_token: 'google-id-token' });
    const claims = verifyAccessToken(result.access_token, SECRET);

    expect(verifier.calls).toEqual(['google-id-token']);
    expect(result.user.roles).toEqual(['customer']);
    expect(result.user.email).toBe(GOOGLE_EMAIL);
    expect(result.user.phone).toBeNull();
    expect(claims.roles).toEqual(['customer']);
    expect(repository.users).toHaveLength(1);
    expect(repository.users[0]).toMatchObject({
      email: GOOGLE_EMAIL,
      googleSub: 'google-sub-new',
      passwordHash: null
    });
    expect(repository.users[0]?.emailVerifiedAt).not.toBeNull();
    expect(repository.sessions).toHaveLength(1);
  });

  it('links an existing email account instead of creating a duplicate', async () => {
    const verifier = verifierWith({
      sub: 'google-sub-existing',
      email: GOOGLE_EMAIL,
      emailVerified: true
    });
    const { repository, service } = makeHarness({ googleVerifier: verifier });
    addUser(repository, ['customer'], {
      id: USER_ID,
      email: GOOGLE_EMAIL,
      phone: '629111000222'
    });

    const result = await service.loginWithGoogle({ id_token: 'google-id-token' });

    expect(repository.users).toHaveLength(1);
    expect(repository.users[0]?.googleSub).toBe('google-sub-existing');
    expect(repository.users[0]?.emailVerifiedAt).not.toBeNull();
    expect(result.user.id).toBe(USER_ID);
    expect(result.user.roles).toEqual(['customer']);
  });

  it('rejects an invalid ID token with UNAUTHENTICATED', async () => {
    const verifier = new FakeGoogleVerifier(
      new AppError('UNAUTHENTICATED', 'Google sign-in tidak valid')
    );
    const { repository, service } = makeHarness({ googleVerifier: verifier });

    await expect(
      service.loginWithGoogle({ id_token: 'forged-token' })
    ).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Google sign-in tidak valid'
    });

    expect(repository.users).toHaveLength(0);
    expect(repository.sessions).toHaveLength(0);
  });

  it('fails explicitly when Google Sign-In is not configured', async () => {
    const { service } = makeHarness();

    await expect(
      service.loginWithGoogle({ id_token: 'google-id-token' })
    ).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'Google Sign-In belum dikonfigurasi'
    });
  });
});

describe('GoogleTokenInfoVerifier', () => {
  const CLIENT_ID = 'tarlink.apps.googleusercontent.com';
  const futureExp = String(Math.floor(Date.now() / 1000) + 300);

  function verifierWith(payload: Record<string, unknown>, ok = true, status = 200) {
    let requestedUrl = '';
    const verifier = new GoogleTokenInfoVerifier(CLIENT_ID, async (url: string) => {
      requestedUrl = url;
      return { ok, status, json: async () => payload };
    });
    return { verifier, requestedUrl: () => requestedUrl };
  }

  const validPayload = {
    sub: 'google-sub-1',
    email: 'user@tarlink.id',
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    email_verified: 'true',
    exp: futureExp
  };

  it('accepts a well-formed tokeninfo payload and encodes the token', async () => {
    const { verifier, requestedUrl } = verifierWith(validPayload);

    const identity = await verifier.verify('abc.def.ghi');

    expect(identity).toEqual({ sub: 'google-sub-1', email: 'user@tarlink.id', emailVerified: true });
    expect(requestedUrl()).toBe(
      'https://oauth2.googleapis.com/tokeninfo?id_token=abc.def.ghi'
    );
  });

  it('rejects wrong audience, issuer, unverified email, expiry and HTTP errors', async () => {
    const cases: Array<{ payload: Record<string, unknown>; ok?: boolean; status?: number }> = [
      { payload: { ...validPayload, aud: 'someone-else' } },
      { payload: { ...validPayload, iss: 'https://evil.example.com' } },
      { payload: { ...validPayload, email_verified: false } },
      { payload: { ...validPayload, email_verified: 'false' } },
      { payload: { ...validPayload, exp: String(Math.floor(Date.now() / 1000) - 1) } },
      { payload: validPayload, ok: false, status: 400 }
    ];

    for (const testCase of cases) {
      const { verifier } = verifierWith(testCase.payload, testCase.ok ?? true, testCase.status ?? 200);
      await expect(verifier.verify('token')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Google sign-in tidak valid'
      });
    }
  });

  it('rejects when tokeninfo cannot be reached', async () => {
    const verifier = new GoogleTokenInfoVerifier(CLIENT_ID, async () => {
      throw new Error('network down');
    });

    await expect(verifier.verify('token')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Google sign-in tidak valid'
    });
  });
});

describe('AuthController.register', () => {
  it('rejects a client-supplied role instead of silently dropping it', async () => {
    const service = {
      register: async () => {
        throw new Error('service must not be called');
      }
    } as unknown as AuthService;
    const controller = new AuthController(service);

    await expect(
      controller.register({
        email: 'user@tarlink.id',
        password: 'kata-sandi-2026',
        phone: '08123456789',
        role: 'vendor_owner'
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
