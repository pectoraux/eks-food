/**
 * @eks/organizations — organization, membership, team & invitation services.
 *
 * Organizations are first-class entities. A user may belong to multiple orgs
 * (multi-tenant). Every action emits a versioned domain event + audit log.
 */
export { OrganizationService } from "./service";
export { MembershipService } from "./membership";
export { TeamService } from "./team";
export { InvitationService } from "./invitation";
export { ORGANIZATION_TYPES, type OrganizationTypeCode } from "./types";
