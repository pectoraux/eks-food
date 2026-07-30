/**
 * @file shared/value-objects.ts
 * @package @eks-food/domain/shared
 *
 * Shared kernel value objects used by every bounded context in Eks-Food.
 *
 * Responsibility:
 *  - Define primitive branded types (UUID, ISODateString, EmailAddress, etc.)
 *    that flow across every bounded context.
 *  - Define structural value object interfaces (GeoPoint, Money, Page,
 *    PagedResult, Cursor, Version) reused by aggregates, repositories and
 *    domain services.
 *  - Provide the canonical `uuid()` factory backed by the Web Crypto API
 *    (`crypto.randomUUID()`).
 *
 * Constraints:
 *  - Pure TypeScript, no business logic, no Prisma, no Next.js.
 *  - Strongly typed; no `any`.
 *  - Smart constructors only perform brand assertion; semantic validation
 *    lives in the owning bounded context.
 */

/**
 * Branded primitive representing a UUID v4 string.
 * Construct via the {@link uuid} factory or via a context-specific smart
 * constructor. Never cast directly from untrusted input.
 */
export type UUID = string & { readonly __brand: 'UUID' };

/**
 * Branded primitive representing an ISO-8601 date-time string in UTC
 * (e.g. `2025-01-31T12:34:56.000Z`). Construct via {@link isoDate}.
 */
export type ISODateString = string & { readonly __brand: 'ISODateString' };

/**
 * Branded primitive representing a canonical lowercase email address.
 * Construct via {@link emailAddress}.
 */
export type EmailAddress = string & { readonly __brand: 'EmailAddress' };

/**
 * Branded primitive representing an ISO-4217 currency code (e.g. `USD`,
 * `GHS`, `NGN`). Construct via {@link currencyCode}.
 */
export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };

/**
 * Branded primitive representing an opaque pagination cursor. Cursors are
 * issued by repositories and never parsed by callers.
 */
export type Cursor = string & { readonly __brand: 'Cursor' };

/**
 * Branded primitive representing an aggregate version number used for
 * optimistic concurrency control. Starts at 0 for a fresh aggregate and
 * is monotonically incremented on each successful mutation.
 */
export type Version = number & { readonly __brand: 'Version' };

/**
 * Geographic point in WGS-84 coordinates. `lat` ∈ [-90, 90],
 * `lng` ∈ [-180, 180].
 */
export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Monetary amount with currency. `amount` is expressed in the smallest
 * unit of the currency (e.g. pesewas for GHS, cents for USD) to avoid
 * floating point rounding errors; the context is responsible for
 * documenting its precision convention.
 */
export interface Money {
  readonly amount: number;
  readonly currency: CurrencyCode;
}

/**
 * A bounded geo-rectangle used by distance queries and heatmaps.
 */
export interface GeoBounds {
  readonly southWest: GeoPoint;
  readonly northEast: GeoPoint;
}

/**
 * Page request forwarded to paginated repository finders. `cursor` is
 * `null` to request the first page; subsequent pages pass the
 * `nextCursor` returned by the previous response.
 */
export interface Page {
  readonly limit: number;
  readonly cursor: Cursor | null;
}

/**
 * Result of a paginated query. `hasMore` is true when `nextCursor` is
 * non-null and the caller may issue another request.
 */
export interface PagedResult<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor: Cursor | null;
  readonly hasMore: boolean;
}

/**
 * Time range with inclusive start and exclusive end ([start, end)).
 */
export interface TimeRange {
  readonly start: ISODateString;
  readonly end: ISODateString;
}

/**
 * A non-empty localized text label keyed by BCP-47 language tag.
 * The `default` key is always required and used as the fallback.
 */
export interface LocalizedText {
  readonly default: string;
  readonly translations?: Readonly<Record<string, string>>;
}

/**
 * Factory for a fresh UUID v4 using the Web Crypto API.
 *
 * This is a real, working implementation — it is the canonical way to
 * mint a {@link UUID} inside Eks-Food domain code.
 */
export function uuid(): UUID {
  return crypto.randomUUID() as UUID;
}

/**
 * Smart constructor for {@link ISODateString}. Performs only brand
 * assertion; callers are responsible for ensuring the input is a valid
 * ISO-8601 UTC string.
 */
export function isoDate(value: string): ISODateString {
  return value as ISODateString;
}

/**
 * Smart constructor for {@link EmailAddress}. Performs only brand
 * assertion; canonicalisation and validation live in the identity
 * bounded context.
 */
export function emailAddress(value: string): EmailAddress {
  return value as EmailAddress;
}

/**
 * Smart constructor for {@link CurrencyCode}. Performs only brand
 * assertion; the value should be an ISO-4217 code in uppercase.
 */
export function currencyCode(value: string): CurrencyCode {
  return value as CurrencyCode;
}

/**
 * Smart constructor for {@link Cursor}. Performs only brand assertion.
 */
export function cursor(value: string): Cursor {
  return value as Cursor;
}

/**
 * Smart constructor for {@link Version}. Performs only brand assertion.
 */
export function version(value: number): Version {
  return value as Version;
}
