/**
 * @file contexts/identity/services.ts
 * @package @eks-food/domain/contexts/identity
 *
 * Identity bounded context — domain service interfaces.
 *
 * Responsibility:
 *  - Declare pure domain services that span multiple aggregates or
 *    require collaboration with infrastructure ports (hashing, token
 *    signing, MFA verification) without leaking those concerns into
 *    aggregate method signatures.
 *
 * Constraints:
 *  - Interfaces only. Implementations live in the application /
 *    infrastructure layer and depend on these contracts.
 */

import type { Result } from '../../shared/result';
import type { DomainError } from '../../shared/errors';
import type { ISODateString, UUID } from '../../shared/value-objects';
import type {
  AuthorizationDecision,
  AuthorizationRequest,
  CredentialAggregate,
  SessionAggregate,
  UserAggregate,
} from './aggregates';
import type {
  AuthenticationMethod,
  HashedPassword,
  MfaSecret,
  OpaqueToken,
  PasswordHashAlgorithm,
} from './value-objects';

/**
 * Verifies credentials and produces a fresh Session aggregate. The
 * implementation is provided by the application layer and depends on
 * infrastructure ports for hashing and token minting.
 */
export interface AuthenticationService {
  authenticate(
    user: UserAggregate,
    credential: CredentialAggregate,
    password: string,
    mfaCode: string | null,
    method: AuthenticationMethod,
    now: ISODateString,
  ): Promise<Result<SessionAggregate, DomainError>>;
}

/**
 * Evaluates an authorization request against the user's effective
 * permissions (the union of all granted roles' permissions, scoped by
 * tenant). The implementation is a pure domain service that loads
 * roles via {@link import('./repositories').RoleRepository}.
 */
export interface AuthorizationService {
  evaluate(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}

/**
 * Hashes and verifies passwords. Declared as a domain service so
 * aggregates can express rotation/verification without depending on
 * concrete crypto libraries.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<{
    algorithm: PasswordHashAlgorithm;
    hash: HashedPassword;
  }>;
  verify(
    plaintext: string,
    hash: HashedPassword,
    algorithm: PasswordHashAlgorithm,
  ): Promise<boolean>;
}

/**
 * Issues and refreshes opaque tokens bound to a {@link SessionAggregate}.
 * The domain treats tokens as opaque blobs; the implementation is
 * responsible for signing and verification.
 */
export interface TokenService {
  issueAccessToken(session: SessionAggregate): Promise<OpaqueToken>;
  issueRefreshToken(session: SessionAggregate): Promise<OpaqueToken>;
  verifyAccessToken(token: OpaqueToken): Promise<Result<UUID, DomainError>>;
}

/**
 * Generates and verifies time-based one-time passwords for MFA.
 */
export interface MfaService {
  generateSecret(): MfaSecret;
  verifyCode(secret: MfaSecret, code: string): boolean;
}
