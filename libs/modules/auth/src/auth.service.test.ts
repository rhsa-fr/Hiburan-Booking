/**
 * Pure-logic tests for the auth rules. No database: `AuthRepository` is faked in
 * memory so rate limiting, expiry, attempt counting, single-use consumption and
 * password login are exercised deterministically with a fixed clock.
 */
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppError } from '@tarlink/core/errors';
import { createSecretCipherFromKey } from '@tarlink/platform/crypto';
import {
  AuthGuard,
  signAccessToken,
  verifyAccessToken,
  type Role
} from '@tarlink/platform/auth';
import type {
  AccountDeletionRecord,
  AdminChallengeRecord,
  AuthRepository,
  AuthUserProfile,
  AuthUserRecord,
  NewAdminChallenge,
  NewLoginAttempt,
  NewOtpRequest,
  NewSession,
  NewUser,
  NewUserConsent,
  OtpRequestRecord,
  SessionRefreshRecord,
  TwoFactorResetInput,
  TwoFactorResetOutcome,
  TwoFactorState
} from './auth.repository';
import type { GoogleIdentity, GoogleTokenVerifier } from './google-verifier';
import { GoogleTokenInfoVerifier } from './google-verifier';
import { AuthController } from './auth.controller';
import { generateTotpCode } from './totp';
import {
  AuthService,
  INVALID_CREDENTIALS_MESSAGE,
  hashOtpCode,
  hashPassword,
  OTP_RATE_LIMIT_WINDOW_SECONDS,
  TOTP_CHALLENGE_MAX_ATTEMPTS,
  TOTP_CHALLENGE_TTL_SECONDS,
  TOTP_FAILURE_MAX,
  type AuthServiceDeps,
  type PasswordLoginResult,
  type VerifyOtpResult
} from './auth.service';

const SECRET = 'test-jwt-secret-at-least-16-chars';
/** base64(32 bytes); the service only ever sees the encoded form. */
const TEST_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');
/** 20-byte base32 secret used by the fake enrolled admin. */
const TEST_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PHONE = '628123456789';
const EMAIL = 'user@tarlink.id';
const ADMIN_PHONE = '629111222333';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_EMAIL = 'admin@tarlink.id';
const ADMIN_PASSWORD = 'rahasia-admin-2026';
const TOS_VERSION_ID = '33333333-3333-4333-8333-333333333333';
const PRIVACY_VERSION_ID = '44444444-4444-4444-8444-444444444444';
const CONSENT = {
  tos_version_id: TOS_VERSION_ID,
  privacy_version_id: PRIVACY_VERSION_ID
};

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
  twoFactorEnabled: boolean;
  totpSecretEncrypted: Buffer | null;
  totpKeyId: string | null;
  totpEnrolledAt: Date | null;
  twoFactorEnforcedAt: Date | null;
}

interface StoredChallenge extends AdminChallengeRecord {
  tokenHash: string;
  requesterIp: string | null;
  userAgent: string | null;
  createdAt: Date;
}

interface StoredBackupCode {
  userId: string;
  codeHash: string;
  usedAt: Date | null;
}

class FakeAuthRepository implements AuthRepository {
  readonly otpRequests: StoredOtpRequest[] = [];
  readonly users: StoredUser[] = [];
  readonly roles: Array<{ userId: string; role: Role }> = [];
  /** `id` mirrors `sessions.id`: generated here, never equal to `jti`. */
  readonly sessions: Array<NewSession & { id: string; revokedAt: Date | null }> = [];
  private sessionSeq = 0;
  readonly loginAttempts: NewLoginAttempt[] = [];
  readonly passwordUpdatedAt = new Map<string, Date>();
  readonly deletionRequests: AccountDeletionRecord[] = [];
  readonly consents: NewUserConsent[] = [];
  readonly challenges: StoredChallenge[] = [];
  readonly backupCodes: StoredBackupCode[] = [];
  readonly auditLogs: Array<Record<string, unknown>> = [];
  privateKeys: string[] = [];

  async countRecentOtpRequests(email: string, since: Date): Promise<number> {
    return this.otpRequests.filter((row) => row.email === email && row.createdAt >= since).length;
  }

  async countRecentOtpRequestsByIp(ip: string, since: Date): Promise<number> {
    return this.otpRequests.filter(
      (row) => row.requesterIp === ip && row.createdAt >= since
    ).length;
  }

  async insertOtpRequest(input: NewOtpRequest): Promise<void> {
    this.otpRequests.push({
      id: input.id,
      email: input.email,
      codeHash: input.codeHash,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      expiresAt: input.expiresAt,
      consumedAt: null,
      createdAt: input.createdAt,
      requesterIp: input.requesterIp
    });
  }

  async findActiveOtpRequest(email: string, now: Date): Promise<OtpRequestRecord | null> {
    for (let i = this.otpRequests.length - 1; i >= 0; i -= 1) {
      const row = this.otpRequests[i];
      if (!row) continue;
      if (row.email !== email) continue;
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

  async findUserProfile(userId: string): Promise<AuthUserProfile | null> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) return null;
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      passwordHash: user.passwordHash,
      name: user.name,
      createdAt: new Date('2026-10-01T00:00:00.000Z')
    };
  }

  async emailExists(email: string): Promise<boolean> {
    const needle = email.trim().toLowerCase();
    return this.users.some((user) => user.email?.toLowerCase() === needle);
  }

  async phoneExists(phone: string): Promise<boolean> {
    return this.users.some((user) => user.phone === phone);
  }

  async findActivePolicyVersion(
    code: string
  ): Promise<{ id: string; code: string; version: number } | null> {
    if (code === 'tos') return { id: TOS_VERSION_ID, code, version: 1 };
    if (code === 'privacy') return { id: PRIVACY_VERSION_ID, code, version: 1 };
    return null;
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
      emailVerifiedAt: input.emailVerifiedAt,
      twoFactorEnabled: false,
      totpSecretEncrypted: null,
      totpKeyId: null,
      totpEnrolledAt: null,
      twoFactorEnforcedAt: null
    };
    this.users.push(user);
    this.roles.push({ userId: user.id, role: 'customer' });
    for (const consent of input.consents ?? []) this.consents.push(consent);
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
      (row) =>
        row.email.toLowerCase() === needle &&
        !row.succeeded &&
        (row.stage ?? 'password') === 'password' &&
        row.createdAt >= since
    ).length;
  }

  async countFailedLoginAttemptsByIp(ip: string, since: Date): Promise<number> {
    return this.loginAttempts.filter(
      (row) =>
        row.ip === ip &&
        !row.succeeded &&
        (row.stage ?? 'password') === 'password' &&
        row.createdAt >= since
    ).length;
  }

  async recordLoginAttempt(input: NewLoginAttempt): Promise<void> {
    this.loginAttempts.push({ ...input, stage: input.stage ?? 'password' });
  }

  async countFailedTotpAttempts(email: string, since: Date): Promise<number> {
    const needle = email.trim().toLowerCase();
    return this.loginAttempts.filter(
      (row) =>
        !row.succeeded &&
        (row.stage ?? 'password') === 'totp' &&
        row.createdAt >= since &&
        // Mirrors the repository: an empty needle matches only rows stored
        // without an email, never other accounts' failures.
        row.email.toLowerCase() === needle
    ).length;
  }

  async countFailedTotpAttemptsByIp(ip: string, since: Date): Promise<number> {
    return this.loginAttempts.filter(
      (row) =>
        row.ip === ip &&
        !row.succeeded &&
        (row.stage ?? 'password') === 'totp' &&
        row.createdAt >= since
    ).length;
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
    // Postgres generates `sessions.id` from its own default; the fake must mint
    // a distinct value so `parent_id` linking is exercised, not hidden by jti.
    this.sessionSeq += 1;
    this.sessions.push({ ...input, id: `session-row-${this.sessionSeq}`, revokedAt: null });
  }

  async findActiveSessionByJti(jti: string, now: Date): Promise<{ userId: string } | null> {
    const row = this.sessions.find(
      (session) => session.jti === jti && !session.revokedAt && session.expiresAt > now
    );
    return row ? { userId: row.userId } : null;
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

  async findSessionByRefreshHash(
    refreshTokenHash: string
  ): Promise<SessionRefreshRecord | null> {
    const row = this.sessions.find((session) => session.refreshTokenHash === refreshTokenHash);
    if (!row) return null;
    return {
      id: row.id,
      jti: row.jti,
      userId: row.userId,
      familyId: row.familyId,
      revokedAt: row.revokedAt,
      refreshExpiresAt: row.refreshExpiresAt
    };
  }

  async markSessionRotated(jti: string, at: Date): Promise<boolean> {
    const row = this.sessions.find((session) => session.jti === jti && !session.revokedAt);
    if (!row) return false;
    row.revokedAt = at;
    return true;
  }

  async revokeFamily(familyId: string, at: Date): Promise<number> {
    const active = this.sessions.filter(
      (session) => session.familyId === familyId && !session.revokedAt
    );
    for (const session of active) session.revokedAt = at;
    return active.length;
  }

  async revokeByRefreshHash(refreshTokenHash: string, at: Date): Promise<number> {
    const row = this.sessions.find(
      (session) => session.refreshTokenHash === refreshTokenHash && !session.revokedAt
    );
    if (!row) return 0;
    row.revokedAt = at;
    return 1;
  }

  async deleteAccount(
    userId: string,
    reason: string | null,
    at: Date
  ): Promise<{ record: AccountDeletionRecord; privateObjectKeys: string[] }> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');

    const existing = [...this.deletionRequests]
      .reverse()
      .find((row) => row.userId === userId && row.status === 'completed');
    if (existing) return { record: existing, privateObjectKeys: this.privateKeys };

    user.phone = null;
    user.email = null;
    user.name = 'Pengguna dihapus';
    user.passwordHash = null;
    user.googleSub = null;

    for (const session of this.sessions) {
      if (session.userId === userId && !session.revokedAt) session.revokedAt = at;
    }
    for (let index = this.roles.length - 1; index >= 0; index -= 1) {
      if (this.roles[index]?.userId === userId) this.roles.splice(index, 1);
    }

    const record: AccountDeletionRecord = {
      id: `deletion-${this.deletionRequests.length + 1}`,
      userId,
      status: 'completed',
      reason,
      requestedAt: at,
      completedAt: at
    };
    this.deletionRequests.push(record);
    return { record, privateObjectKeys: this.privateKeys };
  }

  async findDeletionRequest(userId: string): Promise<AccountDeletionRecord | null> {
    return (
      [...this.deletionRequests].reverse().find((row) => row.userId === userId) ?? null
    );
  }

  /* --------------------------------------------------------------- 2FA/FR-128 */

  async findTwoFactorState(userId: string): Promise<TwoFactorState | null> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) return null;
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      passwordHash: user.passwordHash,
      twoFactorEnabled: user.twoFactorEnabled,
      totpSecretEncrypted: user.totpSecretEncrypted,
      totpKeyId: user.totpKeyId
    };
  }

  /**
   * Mirrors the SQL upsert: at most one open challenge per user, and a second
   * issuance replaces it (new id/token/expiry) with `attempts` reset to zero.
   */
  async insertAdminChallenge(input: NewAdminChallenge): Promise<void> {
    const next: StoredChallenge = {
      id: input.id,
      userId: input.userId,
      kind: input.kind,
      tokenHash: input.tokenHash,
      attempts: 0,
      maxAttempts: input.maxAttempts,
      expiresAt: input.expiresAt,
      consumedAt: null,
      requesterIp: input.requesterIp,
      userAgent: input.userAgent,
      createdAt: input.createdAt
    };
    const openIndex = this.challenges.findIndex(
      (row) => row.userId === input.userId && row.consumedAt === null
    );
    if (openIndex >= 0) {
      this.challenges[openIndex] = next;
      return;
    }
    this.challenges.push(next);
  }

  async findChallengeByTokenHash(tokenHash: string): Promise<AdminChallengeRecord | null> {
    const row = this.challenges.find((candidate) => candidate.tokenHash === tokenHash);
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      kind: row.kind,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt
    };
  }

  async incrementChallengeAttempt(id: string, now: Date): Promise<number | null> {
    const row = this.challenges.find((candidate) => candidate.id === id);
    if (!row) return null;
    if (row.consumedAt !== null || row.expiresAt <= now) return null;
    if (row.attempts >= row.maxAttempts) return null;
    row.attempts += 1;
    return row.attempts;
  }

  async consumeChallenge(id: string, consumedAt: Date): Promise<boolean> {
    const row = this.challenges.find((candidate) => candidate.id === id);
    if (!row || row.consumedAt !== null || row.expiresAt <= consumedAt) return false;
    row.consumedAt = consumedAt;
    return true;
  }

  async storeTotpSecret(
    userId: string,
    secretEncrypted: Buffer,
    keyId: string,
    _at: Date
  ): Promise<boolean> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user || user.twoFactorEnabled) return false;
    user.totpSecretEncrypted = secretEncrypted;
    user.totpKeyId = keyId;
    user.totpEnrolledAt = null;
    return true;
  }

  async completeTwoFactorEnrollment(
    userId: string,
    backupCodeHashes: readonly string[],
    at: Date
  ): Promise<boolean> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user || user.twoFactorEnabled) return false;

    user.twoFactorEnabled = true;
    user.totpEnrolledAt = at;
    user.twoFactorEnforcedAt ??= at;

    for (let index = this.backupCodes.length - 1; index >= 0; index -= 1) {
      if (this.backupCodes[index]?.userId === userId) this.backupCodes.splice(index, 1);
    }
    for (const codeHash of backupCodeHashes) {
      this.backupCodes.push({ userId, codeHash, usedAt: null });
    }
    return true;
  }

  async markBackupCodeUsed(userId: string, codeHash: string, at: Date): Promise<boolean> {
    const row = this.backupCodes.find(
      (candidate) =>
        candidate.userId === userId &&
        candidate.codeHash === codeHash &&
        candidate.usedAt === null
    );
    if (!row) return false;
    row.usedAt = at;
    return true;
  }

  async resetTwoFactor(input: TwoFactorResetInput): Promise<TwoFactorResetOutcome> {
    const user = this.users.find((candidate) => candidate.id === input.userId);
    const isAdmin = this.roles.some(
      (row) => row.userId === input.userId && row.role.startsWith('admin_')
    );
    if (!user || !isAdmin) throw new AppError('NOT_FOUND', 'Akun admin tidak ditemukan');

    const before = user.twoFactorEnabled;
    user.totpSecretEncrypted = null;
    user.totpKeyId = null;
    user.totpEnrolledAt = null;
    user.twoFactorEnabled = false;

    for (let index = this.backupCodes.length - 1; index >= 0; index -= 1) {
      if (this.backupCodes[index]?.userId === input.userId) this.backupCodes.splice(index, 1);
    }
    for (let index = this.challenges.length - 1; index >= 0; index -= 1) {
      const challenge = this.challenges[index];
      if (challenge?.userId === input.userId && challenge.consumedAt === null) {
        this.challenges.splice(index, 1);
      }
    }

    const active = this.sessions.filter(
      (session) => session.userId === input.userId && !session.revokedAt
    );
    for (const session of active) session.revokedAt = input.at;

    this.auditLogs.push({
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: 'auth.2fa.reset',
      entityType: 'user',
      entityId: input.userId,
      requestId: input.requestId,
      before: { two_factor_enabled: before },
      after: { two_factor_enabled: false, sessions_revoked: active.length }
    });

    return { userId: input.userId, revokedSessions: active.length };
  }
}

interface Harness {
  readonly repository: FakeAuthRepository;
  readonly service: AuthService;
  advance(seconds: number): void;
  now(): Date;
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
    otpDevMode: true,
    totpEncryptionKey: TEST_TOTP_KEY,
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
    },
    now: () => current
  };
}

/**
 * Tests only ever assert on the session branch; this narrows the union instead
 * of teaching every call site the response shape by hand.
 */
function sessionOf(result: PasswordLoginResult): VerifyOtpResult {
  if ('mfa_required' in result || 'mfa_setup_required' in result) {
    throw new Error(`expected a session, got ${JSON.stringify(result)}`);
  }
  return result;
}

function testCipher() {
  const cipher = createSecretCipherFromKey({ key: TEST_TOTP_KEY, name: 'TOTP_ENCRYPTION_KEY' });
  if (!cipher) throw new Error('test cipher unavailable');
  return cipher;
}

/** Turns a stored user into an enrolled admin with a known TOTP secret. */
function enableTwoFactor(
  repository: FakeAuthRepository,
  userId: string,
  secret = TEST_TOTP_SECRET
): void {
  const user = repository.users.find((candidate) => candidate.id === userId);
  if (!user) throw new Error(`unknown test user ${userId}`);
  const cipher = testCipher();
  user.totpSecretEncrypted = cipher.encrypt(secret);
  user.totpKeyId = cipher.keyId;
  user.twoFactorEnabled = true;
  user.totpEnrolledAt = new Date('2026-10-01T00:00:00.000Z');
}

/** Full admin login: password challenge -> TOTP -> session. */
async function adminSession(
  harness: Harness,
  secret = TEST_TOTP_SECRET,
  password = ADMIN_PASSWORD
): Promise<VerifyOtpResult> {
  const challenge = await harness.service.loginWithPassword({ email: ADMIN_EMAIL, password });
  if (!('mfa_required' in challenge)) {
    throw new Error(`expected mfa_required, got ${JSON.stringify(challenge)}`);
  }
  return harness.service.verifyTwoFactorCode({
    challenge_token: challenge.challenge_token,
    code: generateTotpCode(secret, harness.now())
  });
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
    email: options.email === undefined ? EMAIL : options.email,
    passwordHash: options.passwordHash ?? null,
    name: options.name ?? null,
    googleSub: options.googleSub ?? null,
    emailVerifiedAt: options.emailVerifiedAt ?? null,
    twoFactorEnabled: false,
    totpSecretEncrypted: null,
    totpKeyId: null,
    totpEnrolledAt: null,
    twoFactorEnforcedAt: null
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

async function requestCode(service: AuthService, email = EMAIL): Promise<string> {
  const result = await service.requestOtp({ email, ip: '203.0.113.7' });
  if (!result.dev_code) throw new Error('expected dev_code outside production');
  return result.dev_code;
}

describe('AuthService.requestOtp', () => {
  it('rejects the 4th request for one email within 10 minutes, across email formats', async () => {
    const { repository, service } = makeHarness();

    await service.requestOtp({ email: 'User@Tarlink.id' });
    await service.requestOtp({ email: ' user@tarlink.id ' });
    await service.requestOtp({ email: 'USER@TARLINK.ID' });

    await expect(service.requestOtp({ email: EMAIL })).rejects.toMatchObject({
      code: 'RATE_LIMITED'
    });
    expect(repository.otpRequests).toHaveLength(3);
    expect(repository.otpRequests.every((row) => row.email === EMAIL)).toBe(true);
  });

  it('allows a new request once the 10 minute window has passed', async () => {
    const { service, advance } = makeHarness();

    await service.requestOtp({ email: EMAIL });
    await service.requestOtp({ email: EMAIL });
    await service.requestOtp({ email: EMAIL });
    advance(OTP_RATE_LIMIT_WINDOW_SECONDS + 1);

    await expect(service.requestOtp({ email: EMAIL })).resolves.toMatchObject({
      channel: 'email',
      expires_in: 300
    });
  });

  it('stores only sha256(code:email) and never the plaintext', async () => {
    const { repository, service } = makeHarness();
    const devCode = await requestCode(service);

    expect(devCode).toMatch(/^\d{6}$/);
    expect(repository.otpRequests[0]?.codeHash).toBe(hashOtpCode(devCode, EMAIL));
    expect(JSON.stringify(repository.otpRequests)).not.toContain(`"${devCode}"`);
  });
});

describe('AuthService.verifyOtp', () => {
  it('rejects a wrong code and increments attempts without consuming the request', async () => {
    const { repository, service } = makeHarness();
    addUser(repository);
    const code = await requestCode(service);
    const wrong = code === '000000' ? '000001' : '000000';

    await expect(service.verifyOtp({ email: EMAIL, code: wrong })).rejects.toMatchObject({
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

    await expect(service.verifyOtp({ email: EMAIL, code })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
    expect(repository.otpRequests[0]?.attempts).toBe(0);
    expect(repository.sessions).toHaveLength(0);
  });

  it('consumes the code exactly once: a second verify fails', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer']);
    const code = await requestCode(service);

    const first = sessionOf(await service.verifyOtp({ email: EMAIL, code }));

    await expect(service.verifyOtp({ email: EMAIL, code })).rejects.toMatchObject({
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

    const result = sessionOf(await service.verifyOtp({ email: EMAIL, code }));
    const claims = verifyAccessToken(result.access_token, SECRET);

    expect(result.user.roles).toEqual([]);
    expect(claims.sub).toBe(USER_ID);
    expect(claims.roles).toEqual([]);
    expect(result.token_type).toBe('Bearer');
    expect(result.expires_in).toBe(900);
  });

  it('fails with NOT_FOUND when the code is valid but no user owns the email', async () => {
    const { service } = makeHarness();
    const code = await requestCode(service);

    await expect(service.verifyOtp({ email: EMAIL, code })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });
});

describe('AuthService dev_code exposure', () => {
  it('includes dev_code outside production', async () => {
    const { service } = makeHarness({ nodeEnv: 'development' });
    const result = await service.requestOtp({ email: EMAIL });

    expect(result.dev_code).toMatch(/^\d{6}$/);
  });

  it('omits dev_code in production', async () => {
    const { service } = makeHarness({ nodeEnv: 'production' });
    const result = await service.requestOtp({ email: EMAIL });

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

  it('issues a token carrying the admin roles after the TOTP step', async () => {
    const harness = makeHarness();
    const { repository, service } = harness;
    await addAdmin(repository, ['admin_finance', 'admin_super']);
    enableTwoFactor(repository, ADMIN_ID);

    const challenge = await service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      ip: '203.0.113.9'
    });
    expect(challenge).toMatchObject({
      mfa_required: true,
      expires_in: TOTP_CHALLENGE_TTL_SECONDS
    });
    expect(repository.sessions).toHaveLength(0);
    if (!('mfa_required' in challenge)) throw new Error('expected mfa_required');

    const result = await service.verifyTwoFactorCode({
      challenge_token: challenge.challenge_token,
      code: generateTotpCode(TEST_TOTP_SECRET, harness.now()),
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
      succeeded: true,
      stage: 'password'
    });
    expect(repository.loginAttempts.some((row) => row.stage === 'totp' && row.succeeded)).toBe(true);
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

    const result = sessionOf(
      await service.loginWithPassword({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD
      })
    );
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
    const harness = makeHarness();
    const { repository, service } = harness;
    await addAdmin(repository);
    enableTwoFactor(repository, ADMIN_ID);
    await adminSession(harness);
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
    // The new password is accepted, but the admin still stops at the 2FA gate.
    expect(relogin).toMatchObject({ mfa_required: true });
    expect(repository.sessions).toHaveLength(1);
  });

  it('matches the email case-insensitively', async () => {
    const { repository, service } = makeHarness();
    await addAdmin(repository, ['customer']);

    const result = sessionOf(
      await service.loginWithPassword({
        email: 'Admin@Tarlink.id',
        password: ADMIN_PASSWORD
      })
    );

    expect(result.user.email).toBe(ADMIN_EMAIL);
    expect(repository.loginAttempts[0]?.email).toBe(ADMIN_EMAIL);
  });
});

describe('AuthService admin 2FA (FR-128)', () => {
  async function addAdminUser(
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

  async function startEnrollment(harness: Harness) {
    const challenge = await harness.service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    if (!('mfa_setup_required' in challenge)) {
      throw new Error(`expected mfa_setup_required, got ${JSON.stringify(challenge)}`);
    }
    return {
      enrollToken: challenge.enroll_token,
      secret: (await harness.service.beginTwoFactorEnrollment({
        enroll_token: challenge.enroll_token
      })).secret
    };
  }

  /** Password login that stops at the TOTP step; returns the opaque ticket. */
  async function openChallenge(
    harness: Harness,
    options: { email?: string; password?: string; ip?: string } = {}
  ): Promise<string> {
    const challenge = await harness.service.loginWithPassword({
      email: options.email ?? ADMIN_EMAIL,
      password: options.password ?? ADMIN_PASSWORD,
      ip: options.ip
    });
    if (!('mfa_required' in challenge)) {
      throw new Error(`expected mfa_required, got ${JSON.stringify(challenge)}`);
    }
    return challenge.challenge_token;
  }

  /** Sends one wrong code and returns the error code the service answered with. */
  async function wrongCodeResult(
    service: AuthService,
    token: string,
    code: string,
    ip?: string
  ): Promise<string> {
    try {
      await service.verifyTwoFactorCode({ challenge_token: token, code, ip });
    } catch (error) {
      if (error instanceof AppError) return error.code;
      throw error;
    }
    throw new Error('expected the wrong code to be rejected');
  }

  /**
   * Spends the whole cross-challenge budget with wrong codes: one ticket locked
   * by its own cap, then the remaining guesses on a fresh ticket.
   */
  async function spendTotpBudget(
    harness: Harness,
    options: { email?: string; password?: string; ip?: string } = {}
  ): Promise<void> {
    const valid = generateTotpCode(TEST_TOTP_SECRET, harness.now());
    const wrong = valid === '000000' ? '000001' : '000000';

    // Six guesses: 401 until the per-challenge cap answers 429.
    const first = await openChallenge(harness, options);
    for (let attempt = 1; attempt <= TOTP_CHALLENGE_MAX_ATTEMPTS; attempt += 1) {
      const code = await wrongCodeResult(harness.service, first, wrong, options.ip);
      expect(code).toBe(
        attempt === TOTP_CHALLENGE_MAX_ATTEMPTS ? 'RATE_LIMITED' : 'UNAUTHENTICATED'
      );
    }

    // Four more guesses on a fresh ticket: the last one spends the window budget.
    const second = await openChallenge(harness, options);
    const remaining = TOTP_FAILURE_MAX - TOTP_CHALLENGE_MAX_ATTEMPTS;
    for (let attempt = 1; attempt <= remaining; attempt += 1) {
      const code = await wrongCodeResult(harness.service, second, wrong, options.ip);
      expect(code).toBe(attempt === remaining ? 'RATE_LIMITED' : 'UNAUTHENTICATED');
    }
  }

  /**
   * Simulates an account that has no email: `recordTotpAttempt` then stores
   * `''` and the counters bucket by that empty value.
   */
  function setAdminEmail(repository: FakeAuthRepository, email: string | null): void {
    const admin = repository.users.find((candidate) => candidate.id === ADMIN_ID);
    if (!admin) throw new Error('expected the test admin to exist');
    admin.email = email;
  }

  it('AC5.1 answers mfa_setup_required and issues no session for an unenrolled admin', async () => {
    const { repository, service } = makeHarness();
    await addAdminUser(repository);

    const result = await service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      ip: '203.0.113.9'
    });

    expect(result).toMatchObject({ mfa_setup_required: true, expires_in: 600 });
    expect(result).not.toHaveProperty('access_token');
    expect(result).not.toHaveProperty('refresh_token');
    expect(repository.sessions).toHaveLength(0);

    if (!('mfa_setup_required' in result)) throw new Error('expected mfa_setup_required');
    expect(result.enroll_token).toMatch(/^[\w-]{40,}$/);
    // Only the hash is persisted; the opaque token exists in the response only.
    expect(repository.challenges).toHaveLength(1);
    expect(repository.challenges[0]).toMatchObject({
      userId: ADMIN_ID,
      kind: 'enroll',
      requesterIp: '203.0.113.9'
    });
    expect(repository.challenges[0]?.tokenHash).toHaveLength(64);
    expect(repository.challenges[0]?.tokenHash).not.toBe(result.enroll_token);
  });

  it('AC5.2 locks after six wrong codes, then a fresh challenge issues one session', async () => {
    const harness = makeHarness();
    const { repository, service } = harness;
    await addAdminUser(repository);
    enableTwoFactor(repository, ADMIN_ID);

    const challenge = await service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    if (!('mfa_required' in challenge)) throw new Error('expected mfa_required');
    expect(challenge.expires_in).toBe(600);
    expect(repository.sessions).toHaveLength(0);

    const valid = generateTotpCode(TEST_TOTP_SECRET, harness.now());
    const wrong = valid === '000000' ? '000001' : '000000';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.verifyTwoFactorCode({
          challenge_token: challenge.challenge_token,
          code: wrong
        })
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    // The sixth guess hits max_attempts and is reported as rate limited.
    await expect(
      service.verifyTwoFactorCode({ challenge_token: challenge.challenge_token, code: wrong })
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    // Once locked, even the right code is refused.
    await expect(
      service.verifyTwoFactorCode({ challenge_token: challenge.challenge_token, code: valid })
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    expect(repository.challenges[0]?.attempts).toBe(6);
    expect(repository.sessions).toHaveLength(0);
    expect(repository.loginAttempts.filter((row) => row.stage === 'totp')).toHaveLength(6);

    // TOTP failures do not spend the password quota: the admin can start over.
    const second = await service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    if (!('mfa_required' in second)) throw new Error('expected mfa_required');

    const session = await service.verifyTwoFactorCode({
      challenge_token: second.challenge_token,
      code: generateTotpCode(TEST_TOTP_SECRET, harness.now())
    });
    expect(session.user.roles).toEqual(['admin_super']);
    expect(repository.sessions).toHaveLength(1);

    // A challenge is single use: replaying it cannot mint a second session.
    await expect(
      service.verifyTwoFactorCode({
        challenge_token: second.challenge_token,
        code: generateTotpCode(TEST_TOTP_SECRET, harness.now())
      })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(repository.sessions).toHaveLength(1);
  });

  it('locks the account across challenges after ten wrong codes', async () => {
    const harness = makeHarness();
    const { repository, service } = harness;
    await addAdminUser(repository);
    enableTwoFactor(repository, ADMIN_ID);

    await spendTotpBudget(harness);
    expect(
      repository.loginAttempts.filter((row) => row.stage === 'totp' && !row.succeeded)
    ).toHaveLength(TOTP_FAILURE_MAX);
    // One live ticket per user: the second login replaced the locked one.
    expect(repository.challenges).toHaveLength(1);

    // A fresh password login cannot buy another set of guesses.
    await expect(
      service.loginWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    expect(repository.challenges).toHaveLength(1);
    expect(repository.sessions).toHaveLength(0);
  });

  it('keeps an email-less account and a named account in separate TOTP budgets', async () => {
    const harness = makeHarness();
    const { repository, service } = harness;
    const secondAdminId = '66666666-6666-4666-8666-666666666666';
    const secondAdminEmail = 'a@example.test';
    const secondAdminPassword = 'rahasia-admin-lain';

    await addAdminUser(repository);
    enableTwoFactor(repository, ADMIN_ID);
    addUser(repository, ['admin_super'], {
      id: secondAdminId,
      phone: '629111222555',
      email: secondAdminEmail,
      passwordHash: await hashPassword(secondAdminPassword)
    });
    enableTwoFactor(repository, secondAdminId);

    const valid = generateTotpCode(TEST_TOTP_SECRET, harness.now());
    const wrong = valid === '000000' ? '000001' : '000000';

    // Two failures while the account has no email land in the empty bucket.
    const token = await openChallenge(harness);
    setAdminEmail(repository, null);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await wrongCodeResult(service, token, wrong)).toBe('UNAUTHENTICATED');
    }
    expect(
      repository.loginAttempts.filter((row) => row.stage === 'totp' && row.email === '')
    ).toHaveLength(2);
    setAdminEmail(repository, ADMIN_EMAIL);

    // Those two belong to the empty bucket only: the named account still has
    // its own full budget, which `spendTotpBudget` asserts by locking exactly
    // on the tenth failure.
    await spendTotpBudget(harness, {
      email: secondAdminEmail,
      password: secondAdminPassword
    });
    expect(
      repository.loginAttempts.filter(
        (row) => row.stage === 'totp' && row.email.toLowerCase() === secondAdminEmail
      ).length
    ).toBe(TOTP_FAILURE_MAX);
    // ...and its failures never landed in the empty bucket.
    expect(
      repository.loginAttempts.filter(
        (row) => row.stage === 'totp' && !row.succeeded && row.email === ''
      )
    ).toHaveLength(2);

    const emailLess = await openChallenge(harness);
    setAdminEmail(repository, null);
    // The right code still logs in: ten failures for another account are not
    // the email-less account's failures.
    await expect(
      service.verifyTwoFactorCode({
        challenge_token: emailLess,
        code: generateTotpCode(TEST_TOTP_SECRET, harness.now())
      })
    ).resolves.toMatchObject({ user: { roles: ['admin_super'] } });
    expect(repository.sessions).toHaveLength(1);
  });

  it('still locks an account that has no email after ten failures', async () => {
    const harness = makeHarness();
    const { repository, service } = harness;
    await addAdminUser(repository);
    enableTwoFactor(repository, ADMIN_ID);

    const valid = generateTotpCode(TEST_TOTP_SECRET, harness.now());
    const wrong = valid === '000000' ? '000001' : '000000';

    // Six guesses spend the first ticket's cap while the account has no email,
    // so every failure is recorded with an empty email.
    const first = await openChallenge(harness);
    setAdminEmail(repository, null);
    for (let attempt = 1; attempt <= TOTP_CHALLENGE_MAX_ATTEMPTS; attempt += 1) {
      expect(await wrongCodeResult(service, first, wrong)).toBe(
        attempt === TOTP_CHALLENGE_MAX_ATTEMPTS ? 'RATE_LIMITED' : 'UNAUTHENTICATED'
      );
    }

    // Four more on a fresh ticket spend the empty bucket's window budget.
    setAdminEmail(repository, ADMIN_EMAIL);
    const second = await openChallenge(harness);
    setAdminEmail(repository, null);
    const remaining = TOTP_FAILURE_MAX - TOTP_CHALLENGE_MAX_ATTEMPTS;
    for (let attempt = 1; attempt <= remaining; attempt += 1) {
      expect(await wrongCodeResult(service, second, wrong)).toBe(
        attempt === remaining ? 'RATE_LIMITED' : 'UNAUTHENTICATED'
      );
    }
    expect(
      repository.loginAttempts.filter((row) => row.stage === 'totp' && row.email === '')
    ).toHaveLength(TOTP_FAILURE_MAX);

    // The empty bucket is spent too: a fresh ticket refuses even the right code.
    setAdminEmail(repository, ADMIN_EMAIL);
    const third = await openChallenge(harness);
    setAdminEmail(repository, null);
    await expect(
      service.verifyTwoFactorCode({
        challenge_token: third,
        code: generateTotpCode(TEST_TOTP_SECRET, harness.now())
      })
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: expect.stringContaining('Coba lagi nanti')
    });
    expect(repository.sessions).toHaveLength(0);
  });

  it('locks the IP across challenges even when the email differs', async () => {
    const harness = makeHarness();
    const { repository, service } = harness;
    const secondAdminId = '55555555-5555-4555-8555-555555555555';
    const secondAdminEmail = 'admin.dua@tarlink.id';
    const secondAdminPassword = 'rahasia-admin-kedua';
    const ip = '203.0.113.44';

    await addAdminUser(repository);
    enableTwoFactor(repository, ADMIN_ID);
    addUser(repository, ['admin_super'], {
      id: secondAdminId,
      phone: '629111222444',
      email: secondAdminEmail,
      passwordHash: await hashPassword(secondAdminPassword)
    });
    enableTwoFactor(repository, secondAdminId);

    await spendTotpBudget(harness, { ip });

    // Same host, another admin: the per-email counter is zero, the IP one is not.
    await expect(
      service.loginWithPassword({ email: secondAdminEmail, password: secondAdminPassword, ip })
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(repository.challenges.filter((row) => row.userId === secondAdminId)).toHaveLength(0);

    // The same admin from another network is not blocked by that IP counter.
    const elsewhere = await service.loginWithPassword({
      email: secondAdminEmail,
      password: secondAdminPassword,
      ip: '198.51.100.9'
    });
    expect(elsewhere).toMatchObject({ mfa_required: true });
  });

  it('does not count successful verifications as TOTP failures', async () => {
    const harness = makeHarness();
    const { repository, service } = harness;
    await addAdminUser(repository);
    enableTwoFactor(repository, ADMIN_ID);

    // More successes than the failure cap must not spend the budget.
    for (let round = 0; round < TOTP_FAILURE_MAX; round += 1) {
      await adminSession(harness);
    }
    expect(repository.sessions).toHaveLength(TOTP_FAILURE_MAX);
    expect(
      repository.loginAttempts.filter((row) => row.stage === 'totp' && !row.succeeded)
    ).toHaveLength(0);

    const token = await openChallenge(harness);
    const valid = generateTotpCode(TEST_TOTP_SECRET, harness.now());
    const wrong = valid === '000000' ? '000001' : '000000';
    // Still an ordinary wrong answer, not a lockout.
    expect(await wrongCodeResult(service, token, wrong)).toBe('UNAUTHENTICATED');
  });

  it('keeps the six-guesses-per-challenge cap when the window is not spent', async () => {
    const harness = makeHarness();
    const { repository, service } = harness;
    await addAdminUser(repository);
    enableTwoFactor(repository, ADMIN_ID);

    const token = await openChallenge(harness);
    const valid = generateTotpCode(TEST_TOTP_SECRET, harness.now());
    const wrong = valid === '000000' ? '000001' : '000000';

    for (let attempt = 1; attempt < TOTP_CHALLENGE_MAX_ATTEMPTS; attempt += 1) {
      expect(await wrongCodeResult(service, token, wrong)).toBe('UNAUTHENTICATED');
    }
    // The sixth guess is still the per-challenge lock, with its own message.
    await expect(
      service.verifyTwoFactorCode({ challenge_token: token, code: wrong })
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: expect.stringContaining('Mulai ulang proses login')
    });
    expect(repository.challenges[0]?.attempts).toBe(TOTP_CHALLENGE_MAX_ATTEMPTS);
  });

  it('rejects a correct code on an already-issued ticket once the window budget is spent', async () => {
    const harness = makeHarness();
    const { repository, service } = harness;
    await addAdminUser(repository);
    enableTwoFactor(repository, ADMIN_ID);

    const valid = generateTotpCode(TEST_TOTP_SECRET, harness.now());
    const wrong = valid === '000000' ? '000001' : '000000';

    // Six failures spend the first ticket's own cap...
    const first = await openChallenge(harness);
    for (let attempt = 1; attempt <= TOTP_CHALLENGE_MAX_ATTEMPTS; attempt += 1) {
      expect(await wrongCodeResult(service, first, wrong)).toBe(
        attempt === TOTP_CHALLENGE_MAX_ATTEMPTS ? 'RATE_LIMITED' : 'UNAUTHENTICATED'
      );
    }

    // ...and four on the replacement ticket spend the 10-failure window budget.
    const second = await openChallenge(harness);
    const remaining = TOTP_FAILURE_MAX - TOTP_CHALLENGE_MAX_ATTEMPTS;
    for (let attempt = 1; attempt <= remaining; attempt += 1) {
      expect(await wrongCodeResult(service, second, wrong)).toBe(
        attempt === remaining ? 'RATE_LIMITED' : 'UNAUTHENTICATED'
      );
    }

    // The ticket still has guesses left under its own cap, but the window is
    // spent: even the correct code must be refused, and no session minted.
    expect(repository.challenges).toHaveLength(1);
    expect(repository.challenges[0]?.attempts).toBeLessThan(TOTP_CHALLENGE_MAX_ATTEMPTS);
    await expect(
      service.verifyTwoFactorCode({ challenge_token: second, code: valid })
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: expect.stringContaining('Coba lagi nanti')
    });
    expect(repository.challenges[0]?.consumedAt).toBeNull();
    expect(repository.sessions).toHaveLength(0);
  });

  it('keeps exactly one open challenge across two consecutive password logins', async () => {
    const harness = makeHarness();
    const { repository, service } = harness;
    await addAdminUser(repository);
    enableTwoFactor(repository, ADMIN_ID);

    const first = await openChallenge(harness);
    const second = await openChallenge(harness);

    expect(second).not.toBe(first);
    const open = repository.challenges.filter(
      (challenge) => challenge.userId === ADMIN_ID && challenge.consumedAt === null
    );
    expect(open).toHaveLength(1);
    expect(repository.challenges).toHaveLength(1);
    expect(open[0]?.attempts).toBe(0);

    // The replaced ticket is gone: only the newest one can be redeemed.
    await expect(
      service.verifyTwoFactorCode({
        challenge_token: first,
        code: generateTotpCode(TEST_TOTP_SECRET, harness.now())
      })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const session = await service.verifyTwoFactorCode({
      challenge_token: second,
      code: generateTotpCode(TEST_TOTP_SECRET, harness.now())
    });
    expect(session.user.roles).toEqual(['admin_super']);
    expect(repository.sessions).toHaveLength(1);
  });

  it('AC5.3 accepts a backup code once and rejects the second use', async () => {
    const harness = makeHarness();
    const { repository, service } = harness;
    await addAdminUser(repository);

    const { enrollToken, secret } = await startEnrollment(harness);
    const enrolled = await service.completeTwoFactorEnrollment({
      enroll_token: enrollToken,
      code: generateTotpCode(secret, harness.now())
    });
    expect(enrolled.backup_codes).toHaveLength(10);
    expect(repository.sessions).toHaveLength(1);

    const firstCode = enrolled.backup_codes[0];
    if (!firstCode) throw new Error('expected a backup code');

    const challenge = await service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    if (!('mfa_required' in challenge)) throw new Error('expected mfa_required');

    // Dashes and case are ignored on purpose.
    const session = await service.verifyBackupCode({
      challenge_token: challenge.challenge_token,
      code: firstCode.toLowerCase().replace('-', ' ')
    });
    expect(session.user.roles).toEqual(['admin_super']);
    expect(repository.sessions).toHaveLength(2);

    const replayChallenge = await service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    if (!('mfa_required' in replayChallenge)) throw new Error('expected mfa_required');
    await expect(
      service.verifyBackupCode({
        challenge_token: replayChallenge.challenge_token,
        code: firstCode
      })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(repository.sessions).toHaveLength(2);
  });

  it('AC5.4 keeps the customer and vendor login payload identical', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], {
      id: ADMIN_ID,
      phone: ADMIN_PHONE,
      email: ADMIN_EMAIL,
      passwordHash: await hashPassword(ADMIN_PASSWORD)
    });
    addUser(repository, ['vendor_owner'], {
      id: USER_ID,
      phone: PHONE,
      email: 'vendor@tarlink.id',
      passwordHash: await hashPassword('kata-sandi-vendor')
    });

    const customer = sessionOf(
      await service.loginWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    );
    const vendor = sessionOf(
      await service.loginWithPassword({
        email: 'vendor@tarlink.id',
        password: 'kata-sandi-vendor'
      })
    );

    const sessionKeys = ['access_token', 'expires_in', 'refresh_token', 'token_type', 'user'];
    expect(Object.keys(customer).sort()).toEqual(sessionKeys);
    expect(Object.keys(vendor).sort()).toEqual(sessionKeys);
    expect(customer.user).toEqual({
      id: ADMIN_ID,
      phone: ADMIN_PHONE,
      roles: ['customer'],
      email: ADMIN_EMAIL
    });
    expect(vendor.user.roles).toEqual(['vendor_owner']);
    expect(repository.challenges).toHaveLength(0);
    expect(repository.sessions).toHaveLength(2);
  });

  it('AC5.5 reset clears TOTP, revokes every session and writes the audit row', async () => {
    const harness = makeHarness();
    const { repository, service } = harness;
    await addAdminUser(repository);
    enableTwoFactor(repository, ADMIN_ID);
    await adminSession(harness);
    expect(repository.sessions).toHaveLength(1);

    // An open verify challenge must not survive the reset either.
    const open = await service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    expect(open).toMatchObject({ mfa_required: true });

    const result = await service.resetTwoFactor({
      userId: ADMIN_ID,
      actorId: USER_ID,
      actorRole: 'admin_super',
      requestId: 'req-2fa-reset'
    });

    expect(result).toEqual({ user_id: ADMIN_ID, revoked_sessions: 1 });
    const user = repository.users.find((candidate) => candidate.id === ADMIN_ID);
    expect(user).toMatchObject({
      twoFactorEnabled: false,
      totpSecretEncrypted: null,
      totpKeyId: null,
      totpEnrolledAt: null
    });
    expect(repository.sessions.every((session) => session.revokedAt !== null)).toBe(true);
    expect(
      repository.challenges.filter(
        (challenge) => challenge.userId === ADMIN_ID && challenge.consumedAt === null
      )
    ).toHaveLength(0);
    expect(repository.backupCodes).toHaveLength(0);
    expect(repository.auditLogs).toEqual([
      {
        actorId: USER_ID,
        actorRole: 'admin_super',
        action: 'auth.2fa.reset',
        entityType: 'user',
        entityId: ADMIN_ID,
        requestId: 'req-2fa-reset',
        before: { two_factor_enabled: true },
        after: { two_factor_enabled: false, sessions_revoked: 1 }
      }
    ]);
  });

  it('reset answers NOT_FOUND for a customer or an unknown id', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer']);

    await expect(
      service.resetTwoFactor({ userId: USER_ID, actorId: ADMIN_ID, actorRole: 'admin_super' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.resetTwoFactor({
        userId: '99999999-9999-4999-8999-999999999999',
        actorId: ADMIN_ID,
        actorRole: 'admin_super'
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repository.auditLogs).toHaveLength(0);
  });

  it('gates OTP login for an admin instead of issuing a session', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['admin_super'], {
      id: ADMIN_ID,
      phone: ADMIN_PHONE,
      email: ADMIN_EMAIL,
      passwordHash: null
    });
    const code = await requestCode(service, ADMIN_EMAIL);

    const result = await service.verifyOtp({ email: ADMIN_EMAIL, code });

    expect(result).toMatchObject({ mfa_setup_required: true });
    expect(repository.sessions).toHaveLength(0);
    expect(repository.otpRequests[0]?.consumedAt).not.toBeNull();
  });

  it('gates Google login for an enrolled admin', async () => {
    const verifier = new FakeGoogleVerifier({
      sub: 'admin-google',
      email: ADMIN_EMAIL,
      emailVerified: true
    });
    const { repository, service } = makeHarness({ googleVerifier: verifier });
    addUser(repository, ['admin_super'], {
      id: ADMIN_ID,
      phone: ADMIN_PHONE,
      email: ADMIN_EMAIL,
      googleSub: 'admin-google'
    });
    enableTwoFactor(repository, ADMIN_ID);

    const result = await service.loginWithGoogle({ id_token: 'google-id-token' });

    expect(result).toMatchObject({ mfa_required: true });
    expect(repository.sessions).toHaveLength(0);
  });

  it('stores the TOTP secret encrypted and decrypts the same value back', async () => {
    const harness = makeHarness();
    const { repository, service } = harness;
    await addAdminUser(repository);

    const { enrollToken, secret } = await startEnrollment(harness);
    const stored = repository.users.find((candidate) => candidate.id === ADMIN_ID);
    if (!stored?.totpSecretEncrypted) throw new Error('expected an encrypted secret');

    expect(stored.twoFactorEnabled).toBe(false);
    expect(stored.totpKeyId).toBe(testCipher().keyId);
    // The plaintext must not be recoverable from the column without the key.
    expect(stored.totpSecretEncrypted.toString('utf8')).not.toContain(secret);
    expect(testCipher().decrypt(stored.totpSecretEncrypted, stored.totpKeyId)).toBe(secret);

    const enrolled = await service.completeTwoFactorEnrollment({
      enroll_token: enrollToken,
      code: generateTotpCode(secret, harness.now())
    });
    expect(enrolled.backup_codes).toHaveLength(10);
    expect(stored.twoFactorEnabled).toBe(true);
  });

  it('fails enrollment closed when TOTP_ENCRYPTION_KEY is missing', async () => {
    const harness = makeHarness({ totpEncryptionKey: undefined });
    const { repository, service } = harness;
    await addAdminUser(repository);

    const challenge = await service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    if (!('mfa_setup_required' in challenge)) throw new Error('expected mfa_setup_required');

    await expect(
      service.beginTwoFactorEnrollment({ enroll_token: challenge.enroll_token })
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    const stored = repository.users.find((candidate) => candidate.id === ADMIN_ID);
    expect(stored?.totpSecretEncrypted).toBeNull();
    expect(repository.sessions).toHaveLength(0);
  });

  it('rejects wrong-kind, expired and reused challenges', async () => {
    const wrongKind = makeHarness();
    await addAdminUser(wrongKind.repository);
    const setup = await wrongKind.service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    if (!('mfa_setup_required' in setup)) throw new Error('expected mfa_setup_required');
    await expect(
      wrongKind.service.verifyTwoFactorCode({
        challenge_token: setup.enroll_token,
        code: '000000'
      })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const expired = makeHarness();
    await addAdminUser(expired.repository);
    const expiredSetup = await expired.service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    if (!('mfa_setup_required' in expiredSetup)) throw new Error('expected mfa_setup_required');
    expired.advance(TOTP_CHALLENGE_TTL_SECONDS + 1);
    await expect(
      expired.service.beginTwoFactorEnrollment({ enroll_token: expiredSetup.enroll_token })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const reused = makeHarness();
    await addAdminUser(reused.repository);
    const { enrollToken, secret } = await startEnrollment(reused);
    await reused.service.completeTwoFactorEnrollment({
      enroll_token: enrollToken,
      code: generateTotpCode(secret, reused.now())
    });
    await expect(
      reused.service.completeTwoFactorEnrollment({
        enroll_token: enrollToken,
        code: generateTotpCode(secret, reused.now())
      })
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('answers CONFLICT when enrollment races an already-enabled account', async () => {
    const { repository, service } = makeHarness();
    await addAdminUser(repository);
    const setup = await service.loginWithPassword({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });
    if (!('mfa_setup_required' in setup)) throw new Error('expected mfa_setup_required');

    // Simulates the account being enrolled by another request meanwhile.
    enableTwoFactor(repository, ADMIN_ID);

    await expect(
      service.beginTwoFactorEnrollment({ enroll_token: setup.enroll_token })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
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
      full_name: 'Budi Santoso',
      consent: CONSENT,
      ip: '203.0.113.1',
      userAgent: 'vitest'
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
    expect(repository.consents).toEqual([
      {
        policyCode: 'tos',
        policyVersionId: TOS_VERSION_ID,
        acceptedAt: expect.any(Date),
        ip: '203.0.113.1',
        userAgent: 'vitest'
      },
      {
        policyCode: 'privacy',
        policyVersionId: PRIVACY_VERSION_ID,
        acceptedAt: expect.any(Date),
        ip: '203.0.113.1',
        userAgent: 'vitest'
      }
    ]);
  });

  it('rejects a stale policy version instead of recording it', async () => {
    const { repository, service } = makeHarness();

    await expect(
      service.register({
        email: 'stale@tarlink.id',
        password: NEW_PASSWORD,
        consent: { tos_version_id: PRIVACY_VERSION_ID, privacy_version_id: PRIVACY_VERSION_ID }
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect(repository.users).toHaveLength(0);
    expect(repository.consents).toHaveLength(0);
  });

  it('rejects a duplicate email with CONFLICT', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], { email: NEW_EMAIL, phone: '629111000111' });

    await expect(
      service.register({
        email: 'NEW.CUSTOMER@tarlink.id',
        password: NEW_PASSWORD,
        phone: '081234567890',
        consent: CONSENT
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(repository.users).toHaveLength(1);
    expect(repository.sessions).toHaveLength(0);
  });

  it('rejects a duplicate phone with CONFLICT', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], { email: 'other@tarlink.id', phone: NEW_PHONE });

    await expect(
      service.register({
        email: NEW_EMAIL,
        password: NEW_PASSWORD,
        phone: '08123456789',
        consent: CONSENT
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(repository.users).toHaveLength(1);
  });

  it('registers a customer without a phone number', async () => {
    const { repository, service } = makeHarness();

    const result = await service.register({
      email: 'no.phone@tarlink.id',
      password: NEW_PASSWORD,
      full_name: 'Tanpa Nomor',
      consent: CONSENT
    });
    const claims = verifyAccessToken(result.access_token, SECRET);

    expect(result.user.roles).toEqual(['customer']);
    expect(claims.roles).toEqual(['customer']);
    expect(result.user.email).toBe('no.phone@tarlink.id');
    expect(result.user.phone).toBeNull();
    expect(claims.sub).toBe(repository.users[0]?.id);

    const stored = repository.users[0];
    expect(stored).toMatchObject({
      phone: null,
      email: 'no.phone@tarlink.id',
      name: 'Tanpa Nomor',
      googleSub: null,
      emailVerifiedAt: null
    });
    expect(stored?.passwordHash).toMatch(/^scrypt\$/);
    expect(repository.roles).toEqual([{ userId: stored?.id, role: 'customer' }]);
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

    const result = sessionOf(
      await service.loginWithGoogle({ id_token: 'google-id-token', consent: CONSENT })
    );
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

    const result = sessionOf(await service.loginWithGoogle({ id_token: 'google-id-token' }));

    expect(repository.users).toHaveLength(1);
    expect(repository.users[0]?.googleSub).toBe('google-sub-existing');
    expect(repository.users[0]?.emailVerifiedAt).not.toBeNull();
    expect(result.user.id).toBe(USER_ID);
    expect(result.user.roles).toEqual(['customer']);
  });

  it('rejects a new Google account without policy consent', async () => {
    const verifier = verifierWith({
      sub: 'google-sub-no-consent',
      email: GOOGLE_EMAIL,
      emailVerified: true
    });
    const { repository, service } = makeHarness({ googleVerifier: verifier });

    await expect(service.loginWithGoogle({ id_token: 'google-id-token' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Persetujuan Syarat & Ketentuan serta Kebijakan Privasi wajib dicentang'
    });

    expect(repository.users).toHaveLength(0);
    expect(repository.sessions).toHaveLength(0);
    expect(repository.consents).toHaveLength(0);
  });

  it('rejects a new Google account with a stale policy version', async () => {
    const verifier = verifierWith({
      sub: 'google-sub-stale',
      email: GOOGLE_EMAIL,
      emailVerified: true
    });
    const { repository, service } = makeHarness({ googleVerifier: verifier });

    await expect(
      service.loginWithGoogle({
        id_token: 'google-id-token',
        consent: { tos_version_id: PRIVACY_VERSION_ID, privacy_version_id: PRIVACY_VERSION_ID }
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Versi kebijakan sudah berubah. Muat ulang halaman pendaftaran.'
    });

    expect(repository.users).toHaveLength(0);
    expect(repository.consents).toHaveLength(0);
  });

  it('records ToS and privacy consent for a new Google account', async () => {
    const verifier = verifierWith({
      sub: 'google-sub-with-consent',
      email: GOOGLE_EMAIL,
      emailVerified: true
    });
    const { repository, service } = makeHarness({ googleVerifier: verifier });

    const result = sessionOf(
      await service.loginWithGoogle({
        id_token: 'google-id-token',
        consent: CONSENT,
        ip: '203.0.113.9',
        userAgent: 'vitest'
      })
    );
    const claims = verifyAccessToken(result.access_token, SECRET);

    expect(result.user.roles).toEqual(['customer']);
    expect(claims.sub).toBe(repository.users[0]?.id);
    expect(repository.sessions).toHaveLength(1);
    expect(repository.consents).toEqual([
      {
        policyCode: 'tos',
        policyVersionId: TOS_VERSION_ID,
        acceptedAt: expect.any(Date),
        ip: '203.0.113.9',
        userAgent: 'vitest'
      },
      {
        policyCode: 'privacy',
        policyVersionId: PRIVACY_VERSION_ID,
        acceptedAt: expect.any(Date),
        ip: '203.0.113.9',
        userAgent: 'vitest'
      }
    ]);
  });

  it('logs in an existing Google account without consent', async () => {
    const verifier = verifierWith({
      sub: 'google-sub-repeat',
      email: GOOGLE_EMAIL,
      emailVerified: true
    });
    const { repository, service } = makeHarness({ googleVerifier: verifier });
    addUser(repository, ['customer'], {
      id: USER_ID,
      email: GOOGLE_EMAIL,
      phone: null,
      googleSub: 'google-sub-repeat'
    });

    const result = sessionOf(await service.loginWithGoogle({ id_token: 'google-id-token' }));

    expect(result.user.id).toBe(USER_ID);
    expect(repository.users).toHaveLength(1);
    expect(repository.consents).toHaveLength(0);
    expect(repository.sessions).toHaveLength(1);
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
        consent: CONSENT,
        role: 'vendor_owner'
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('accepts registration without a phone number', async () => {
    let capturedInput: unknown;
    const service = {
      register: async (input: unknown) => {
        capturedInput = input;
        return {
          access_token: 'fake-token',
          refresh_token: 'fake-refresh',
          token_type: 'Bearer',
          expires_in: 900,
          user: { id: 'fake-id', phone: null, roles: ['customer'], email: 'user@tarlink.id' }
        };
      }
    } as unknown as AuthService;
    const controller = new AuthController(service);

    await controller.register(
      { email: 'user@tarlink.id', password: 'kata-sandi-2026', consent: CONSENT },
      '203.0.113.1'
    );
    expect(capturedInput).toMatchObject({
      email: 'user@tarlink.id',
      password: 'kata-sandi-2026',
      consent: CONSENT,
      ip: '203.0.113.1'
    });
    expect((capturedInput as { phone?: string }).phone).toBeUndefined();
  });

  it('rejects registration without policy consent before calling the service', async () => {
    const service = {
      register: async () => {
        throw new Error('service must not be called');
      }
    } as unknown as AuthService;
    const controller = new AuthController(service);

    await expect(
      controller.register({ email: 'user@tarlink.id', password: 'kata-sandi-2026' }, '203.0.113.1')
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('AuthService.getProfile', () => {
  it('returns the database profile with roles read from user_roles', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], { email: 'user@tarlink.id', name: 'Budi Santoso' });
    repository.roles.push({ userId: USER_ID, role: 'vendor_owner' });

    const result = await service.getProfile(USER_ID);

    expect(result).toEqual({
      user: {
        id: USER_ID,
        phone: PHONE,
        roles: ['customer', 'vendor_owner'],
        email: 'user@tarlink.id',
        full_name: 'Budi Santoso',
        created_at: '2026-10-01T00:00:00.000Z'
      }
    });
  });

  it('keeps email and full_name null when the account has none', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], { email: null, phone: null });

    const result = await service.getProfile(USER_ID);

    expect(result.user).toMatchObject({ email: null, full_name: null, roles: ['customer'] });
  });

  it('rejects an unknown subject with UNAUTHENTICATED', async () => {
    const { service } = makeHarness();

    await expect(service.getProfile(USER_ID)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
  });
});

describe('AuthService.deleteAccount (FR-101)', () => {
  function seedSession(repository: FakeAuthRepository) {
    repository.sessions.push({
      id: 'session-row-seed-1',
      jti: 'jti-delete-1',
      userId: USER_ID,
      issuedAt: new Date('2026-10-21T09:00:00.000Z'),
      expiresAt: new Date('2026-10-21T09:15:00.000Z'),
      userAgent: null,
      ip: null,
      refreshTokenHash: 'refresh-hash',
      refreshExpiresAt: new Date('2026-11-20T09:00:00.000Z'),
      familyId: 'family-1',
      parentId: null,
      revokedAt: null
    });
  }

  it('anonymises personal data, revokes sessions and roles, and records the request', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer', 'vendor_owner'], {
      email: 'user@tarlink.id',
      name: 'Budi Santoso',
      passwordHash: 'scrypt$1$salt$hash',
      googleSub: 'google-1'
    });
    seedSession(repository);

    const result = await service.deleteAccount(USER_ID, 'tidak dipakai lagi');

    expect(result.status).toBe('completed');
    expect(result.reason).toBe('tidak dipakai lagi');
    expect(result.completed_at).toBe('2026-10-21T09:00:00.000Z');

    const user = repository.users.find((candidate) => candidate.id === USER_ID);
    expect(user).toMatchObject({
      phone: null,
      email: null,
      name: 'Pengguna dihapus',
      passwordHash: null,
      googleSub: null
    });
    expect(repository.sessions.every((session) => session.revokedAt !== null)).toBe(true);
    expect(repository.roles.filter((row) => row.userId === USER_ID)).toHaveLength(0);
    expect(repository.deletionRequests).toHaveLength(1);
  });

  it('is idempotent: a second request returns the same completed record', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer']);

    const first = await service.deleteAccount(USER_ID);
    const second = await service.deleteAccount(USER_ID);

    expect(second.id).toBe(first.id);
    expect(repository.deletionRequests).toHaveLength(1);
  });

  it('removes private document files after anonymisation', async () => {
    const removed: string[] = [];
    const { repository, service } = makeHarness({
      removePrivateFiles: async (keys) => {
        removed.push(...keys);
      }
    });
    addUser(repository, ['customer']);
    repository.privateKeys = ['ktp/user/ktp.png'];

    await service.deleteAccount(USER_ID);

    expect(removed).toEqual(['ktp/user/ktp.png']);
  });

  it('exposes the deletion status and rejects an unknown account', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer']);

    expect(await service.getDeletionStatus(USER_ID)).toBeNull();
    await service.deleteAccount(USER_ID);
    expect((await service.getDeletionStatus(USER_ID))?.status).toBe('completed');

    await expect(service.deleteAccount('missing-user')).rejects.toMatchObject({
      code: 'NOT_FOUND'
    });
  });
});

describe('AuthService.refresh', () => {
  const EMAIL = 'user@tarlink.id';
  const PASSWORD = 'kata-sandi-2026';

  async function signIn(
    repository: FakeAuthRepository,
    service: AuthService
  ): Promise<string | undefined> {
    const login = sessionOf(await service.loginWithPassword({ email: EMAIL, password: PASSWORD }));
    return verifyAccessToken(login.access_token, SECRET).jti;
  }

  function activeJtis(repository: FakeAuthRepository): string[] {
    return repository.sessions
      .filter((session) => !session.revokedAt)
      .map((session) => session.jti);
  }

  it('rotates the session and mints a token carrying the new jti', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], {
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD)
    });
    const login = sessionOf(await service.loginWithPassword({ email: EMAIL, password: PASSWORD }));
    const loginJti = verifyAccessToken(login.access_token, SECRET).jti;
    repository.roles.push({ userId: USER_ID, role: 'vendor_owner' });

    const refreshed = await service.refresh(USER_ID, loginJti);
    const claims = verifyAccessToken(refreshed.access_token, SECRET);

    expect(loginJti).toBeTruthy();
    expect(claims.jti).toBeTruthy();
    expect(claims.jti).not.toBe(loginJti);
    expect(claims.sub).toBe(USER_ID);
    expect(claims.roles).toEqual(['customer', 'vendor_owner']);
    expect(refreshed.user).toMatchObject({
      id: USER_ID,
      phone: PHONE,
      roles: ['customer', 'vendor_owner'],
      email: EMAIL
    });
    expect(refreshed.token_type).toBe('Bearer');
    expect(refreshed.expires_in).toBe(900);
    expect(activeJtis(repository)).toEqual([claims.jti]);
  });

  it('keeps exactly one active session across several refreshes', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], {
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD)
    });
    let jti = await signIn(repository, service);

    for (let round = 0; round < 3; round += 1) {
      const refreshed = await service.refresh(USER_ID, jti);
      jti = verifyAccessToken(refreshed.access_token, SECRET).jti;
      expect(activeJtis(repository)).toEqual([jti]);
    }

    expect(repository.sessions).toHaveLength(4);
  });

  it('rejects a reused jti: the rotated session is already revoked', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], {
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD)
    });
    const loginJti = await signIn(repository, service);

    await service.refresh(USER_ID, loginJti);

    await expect(service.refresh(USER_ID, loginJti)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Sesi sudah berakhir. Silakan masuk lagi.'
    });
    expect(activeJtis(repository)).toHaveLength(1);
  });

  it('rejects a token without a jti claim', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], { email: EMAIL });

    await expect(service.refresh(USER_ID)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Sesi tidak valid. Silakan masuk lagi.'
    });
    await expect(service.refresh(USER_ID, null)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
    expect(repository.sessions).toHaveLength(0);
  });

  it('rejects an unknown jti with UNAUTHENTICATED', async () => {
    const { service } = makeHarness();

    await expect(service.refresh(USER_ID, 'unknown-jti')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Sesi sudah berakhir. Silakan masuk lagi.'
    });
  });

  it('rejects a valid jti that belongs to another user', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], {
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD)
    });
    const loginJti = await signIn(repository, service);

    await expect(service.refresh(ADMIN_ID, loginJti)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
    expect(activeJtis(repository)).toHaveLength(1);
  });

  it('rejects a token whose sessions were revoked by setPassword', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], {
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD)
    });
    const loginJti = await signIn(repository, service);

    await service.setPassword(USER_ID, 'kata-sandi-baru-2026');

    await expect(service.refresh(USER_ID, loginJti)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Sesi sudah berakhir. Silakan masuk lagi.'
    });
  });

  it('logout revokes only the session carrying that jti', async () => {
    const { repository, service } = makeHarness();
    addUser(repository, ['customer'], {
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD)
    });
    const firstJti = await signIn(repository, service);
    const secondJti = await signIn(repository, service);

    await expect(service.logout(USER_ID, firstJti)).resolves.toEqual({ revoked: 1 });

    expect(activeJtis(repository)).toEqual([secondJti]);
    await expect(service.refresh(USER_ID, firstJti)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
    await expect(service.refresh(USER_ID, secondJti)).resolves.toMatchObject({
      token_type: 'Bearer'
    });
  });

  it('keeps tokens without a jti claim valid: the claim is additive', () => {
    const token = signAccessToken({ sub: USER_ID, roles: ['customer'] }, SECRET, 900);

    expect(verifyAccessToken(token, SECRET).jti).toBeUndefined();
    expect(() =>
      new AuthGuard(SECRET).canActivate({
        getHandler: () => (): void => undefined,
        getClass: () => class TestController {},
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }),
          getResponse: () => undefined,
          getNext: () => undefined
        })
      } as unknown as ExecutionContext)
    ).not.toThrow();
  });
});

describe('the refresh/me routes require a valid bearer token', () => {
  const guard = new AuthGuard(SECRET);

  function contextFor(request: {
    headers: Record<string, string | undefined>;
    user?: { id: string; roles: Role[] };
  }): ExecutionContext {
    return {
      getHandler: () => (): void => undefined,
      getClass: () => class TestController {},
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => undefined,
        getNext: () => undefined
      })
    } as unknown as ExecutionContext;
  }

  it('rejects a request without a token', () => {
    expect(() => guard.canActivate(contextFor({ headers: {} }))).toThrowError(AppError);
  });

  it('rejects a garbage token', () => {
    expect(() =>
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer not-a-jwt' } }))
    ).toThrowError(AppError);
  });

  it('rejects an expired token', () => {
    const expired = signAccessToken({ sub: USER_ID, roles: ['customer'] }, SECRET, -1);
    expect(() =>
      guard.canActivate(contextFor({ headers: { authorization: `Bearer ${expired}` } }))
    ).toThrowError(AppError);
  });

  it('accepts a live token and sets the identity', () => {
    const token = signAccessToken({ sub: USER_ID, roles: ['customer'] }, SECRET, 900);
    const request = { headers: { authorization: `Bearer ${token}` } };

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request).toMatchObject({ user: { id: USER_ID, roles: ['customer'] } });
  });
});

describe('AuthController.me / refresh', () => {
  it('returns the profile under the data envelope', async () => {
    const profile = {
      user: {
        id: USER_ID,
        phone: PHONE,
        roles: ['customer' as Role],
        email: 'user@tarlink.id',
        full_name: null,
        created_at: '2026-10-01T00:00:00.000Z'
      }
    };
    const service = { getProfile: async () => profile } as unknown as AuthService;
    const controller = new AuthController(service);

    await expect(
      controller.me({ headers: {}, user: { id: USER_ID, roles: ['customer'] } })
    ).resolves.toEqual({ data: profile });
  });

  it('rejects /me without a verified user', async () => {
    const controller = new AuthController({} as AuthService);
    await expect(controller.me({ headers: {} })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
  });

  it('rejects /refresh without a verified user', async () => {
    const controller = new AuthController({} as AuthService);
    await expect(controller.refresh({ headers: {} })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
  });
});

describe('AuthService refresh token + IP limits', () => {
  const EMAIL = 'refresh@tarlink.id';
  const PASSWORD = 'kata-sandi-2026';

  async function signedIn(overrides: Partial<AuthServiceDeps> = {}) {
    const harness = makeHarness(overrides);
    addUser(harness.repository, ['customer'], {
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD)
    });
    const login = sessionOf(
      await harness.service.loginWithPassword({ email: EMAIL, password: PASSWORD })
    );
    return { ...harness, login };
  }

  it('stores only the refresh hash and returns an opaque token', async () => {
    const { repository, login } = await signedIn();

    expect(login.refresh_token.length).toBeGreaterThanOrEqual(32);
    expect(repository.sessions).toHaveLength(1);
    expect(repository.sessions[0]?.refreshTokenHash).toHaveLength(64);
    expect(repository.sessions[0]?.refreshTokenHash).not.toBe(login.refresh_token);
  });

  it('rotates the refresh token and keeps one active session', async () => {
    const { repository, service, login } = await signedIn();

    const refreshed = await service.refreshWithToken(login.refresh_token);
    expect(refreshed.refresh_token).not.toBe(login.refresh_token);
    expect(refreshed.access_token).not.toBe(login.access_token);
    const active = repository.sessions.filter((session) => session.revokedAt === null);
    expect(active).toHaveLength(1);

    // The child row must point at the old row's `id` (the FK target), not its
    // jti, which is a different value and made PostgreSQL reject the rotation.
    const oldSession = repository.sessions[0];
    const newSession = active[0];
    expect(oldSession?.id).not.toBe(oldSession?.jti);
    expect(newSession?.parentId).toBe(oldSession?.id);
    expect(newSession?.parentId).not.toBe(oldSession?.jti);
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const { repository, service, login } = await signedIn();

    await service.refreshWithToken(login.refresh_token);
    await expect(service.refreshWithToken(login.refresh_token)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
    expect(repository.sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it('rejects a refresh token after its TTL', async () => {
    const { service, login, advance } = await signedIn({ refreshTtlSeconds: 60 });

    advance(61);
    await expect(service.refreshWithToken(login.refresh_token)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED'
    });
  });

  it('limits failed logins from one IP across different emails', async () => {
    const { service } = makeHarness({ loginIpRateLimitMax: 2 });
    const attempt = (email: string) =>
      service.loginWithPassword({ email, password: 'salah-sekali', ip: '203.0.113.9' });

    await expect(attempt('a@tarlink.id')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(attempt('b@tarlink.id')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(attempt('c@tarlink.id')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('limits OTP requests from one IP', async () => {
    const { service } = makeHarness({ otpIpRateLimitMax: 2 });
    const request = (email: string) =>
      service.requestOtp({ email, ip: '203.0.113.10' });

    await request('one@tarlink.id');
    await request('two@tarlink.id');
    await expect(request('three@tarlink.id')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('omits dev_code when OTP_DEV_MODE is off', async () => {
    const { service } = makeHarness({ nodeEnv: 'development', otpDevMode: false });
    const result = await service.requestOtp({ email: EMAIL });
    expect(result).not.toHaveProperty('dev_code');
  });
});
