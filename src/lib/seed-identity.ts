import { db } from "@/lib/db";
import { hashPassword } from "@eks/auth";
import { ORGANIZATION_TYPES } from "@eks/organizations";
import { GLOBAL_ROLES, ORG_ROLES } from "@eks/authorization";

/**
 * Idempotent seed for the IAM platform: organization types, a demo org,
 * system roles + permissions, users with memberships, teams, invitations,
 * and MFA + login history samples.
 */
export async function seedIdentity(force = false) {
  if (force) {
    await db.notificationLog.deleteMany();
    await db.verificationRequest.deleteMany();
    await db.featureFlagAssignment.deleteMany();
    await db.tenantConfiguration.deleteMany();
    await db.teamMember.deleteMany();
    await db.team.deleteMany();
    await db.invitation.deleteMany();
    await db.recoveryCode.deleteMany();
    await db.mFAConfiguration.deleteMany();
    await db.loginHistory.deleteMany();
    await db.session.deleteMany();
    await db.device.deleteMany();
    await db.rolePermission.deleteMany();
    await db.policy.deleteMany();
    await db.permission.deleteMany();
    await db.membership.deleteMany();
    await db.role.deleteMany();
    await db.userPreference.deleteMany();
    await db.identity.deleteMany();
    await db.user.deleteMany({ where: { email: { contains: "@eks.demo" } } });
    await db.organizationType.deleteMany();
    await db.organization.deleteMany({ where: { slug: "eks-demo-org" } });
  }

  // 1. Organization types (extensible registry).
  for (const t of ORGANIZATION_TYPES) {
    await db.organizationType.upsert({
      where: { code: t.code },
      update: {},
      create: { code: t.code, name: t.name, description: t.description, sortOrder: ORGANIZATION_TYPES.indexOf(t) },
    });
  }

  // 2. Permissions (the full registry).
  const { PERMISSIONS } = await import("@eks/authorization");
  const permMap = new Map<string, string>();
  for (const p of PERMISSIONS) {
    const perm = await db.permission.upsert({
      where: { code: p.code },
      update: {},
      create: { code: p.code, name: p.name, resource: p.resource, description: p.description },
    });
    permMap.set(p.code, perm.id);
  }

  // 3. Demo organization (ENTERPRISE type).
  const householdType = await db.organizationType.findUnique({ where: { code: "ENTERPRISE" } });
  const org = await db.organization.upsert({
    where: { slug: "eks-demo-org" },
    update: {},
    create: {
      slug: "eks-demo-org",
      name: "Eks-Food Demo Enterprise",
      country: "Ghana",
      baseCurrency: "GHS",
      status: "ACTIVE",
      typeId: householdType?.id,
    },
  });
  await db.tenantConfiguration.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      branding: JSON.stringify({ primaryColor: "#d97706", logoUrl: "/logo.svg" }),
      localization: JSON.stringify({ defaultLanguage: "en", supportedLanguages: ["en", "tw", "ha"] }),
    },
  });

  // 4. System roles for this org + grant permissions.
  const roleMap = new Map<string, string>();
  for (const def of [...GLOBAL_ROLES, ...ORG_ROLES]) {
    const existing = await db.role.findFirst({ where: { organizationId: def.scope === "GLOBAL" ? null : org.id, code: def.code } });
    let roleId: string;
    if (!existing) {
      const role = await db.role.create({
        data: {
          organizationId: def.scope === "GLOBAL" ? null : org.id,
          code: def.code,
          name: def.name,
          description: def.description,
          scope: def.scope,
          isSystem: def.isSystem,
          active: true,
        },
      });
      roleId = role.id;
    } else {
      roleId = existing.id;
    }
    roleMap.set(def.code, roleId);
    // Grant the role its permissions.
    for (const permCode of def.permissions) {
      const permId = permMap.get(permCode);
      if (permId) {
        await db.rolePermission.upsert({
          where: { roleId_permissionId: { roleId, permissionId: permId } },
          update: {},
          create: { roleId, permissionId: permId },
        });
      }
    }
  }

  // 5. Users with email/password identities + memberships.
  const users = [
    { email: "admin@eks.demo", name: "Yusuf Ibrahim", password: "AdminPass123!", role: "OWNER", status: "ACTIVE" },
    { email: "manager@eks.demo", name: "Kojo Asante", password: "Manager123!", role: "MANAGER", status: "ACTIVE" },
    { email: "cook@eks.demo", name: "Amara Mensah", password: "CookPass123!", role: "MEMBER", status: "ACTIVE" },
    { email: "support@eks.demo", name: "Efua Darko", password: "Support123!", role: "ADMIN", status: "ACTIVE" },
    { email: "newuser@eks.demo", name: "New User", password: "NewUser123!", role: "VIEWER", status: "PENDING" },
  ];

  for (const u of users) {
    const user = await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name, status: u.status, organizationId: org.id },
      create: {
        email: u.email,
        name: u.name,
        organizationId: org.id,
        roles: u.role,
        status: u.status,
      },
    });
    // Email/password identity.
    const existingIdentity = await db.identity.findUnique({ where: { provider_subject: { provider: "EMAIL", subject: u.email } } });
    if (!existingIdentity) {
      const hash = await hashPassword(u.password);
      await db.identity.create({
        data: { userId: user.id, provider: "EMAIL", subject: u.email, credentialHash: hash, verified: u.email !== "newuser@eks.demo" },
      });
    }
    // User preferences.
    await db.userPreference.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, language: "en", timezone: "Africa/Accra", currency: "GHS" },
    });
    // Membership.
    const roleId = roleMap.get(u.role);
    if (roleId) {
      await db.membership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
        update: {},
        create: { userId: user.id, organizationId: org.id, roleId, status: "ACTIVE", acceptedAt: new Date() },
      });
    }
    // Login history sample.
    if (u.status === "ACTIVE") {
      const existingHistory = await db.loginHistory.count({ where: { userId: user.id } });
      if (existingHistory === 0) {
        for (let i = 0; i < 3; i++) {
          await db.loginHistory.create({
            data: {
              userId: user.id,
              organizationId: org.id,
              result: "SUCCESS",
              method: "PASSWORD",
              ipAddress: "41.215.0.1",
              userAgent: "Mozilla/5.0",
              createdAt: new Date(Date.now() - i * 86400000),
            },
          });
        }
      }
    }
  }

  // 6. Teams.
  const adminUser = await db.user.findUnique({ where: { email: "admin@eks.demo" } });
  const cookUser = await db.user.findUnique({ where: { email: "cook@eks.demo" } });
  if (adminUser && cookUser) {
    for (const teamDef of [
      { name: "Operations Team", kind: "OPERATIONS", description: "Day-to-day operations" },
      { name: "Kitchen Team", kind: "KITCHEN", description: "Cooking & meal prep" },
      { name: "Finance Team", kind: "FINANCE", description: "Payments & payouts" },
    ]) {
      const existing = await db.team.findUnique({ where: { organizationId_name: { organizationId: org.id, name: teamDef.name } } });
      if (!existing) {
        await db.team.create({ data: { organizationId: org.id, ...teamDef } });
      }
    }
  }

  // 7. A pending invitation.
  const existingInvite = await db.invitation.findFirst({ where: { organizationId: org.id, email: "invitee@eks.demo" } });
  if (!existingInvite && adminUser) {
    const memberRole = roleMap.get("MEMBER");
    if (memberRole) {
      await db.invitation.create({
        data: {
          organizationId: org.id,
          email: "invitee@eks.demo",
          invitedById: adminUser.id,
          roleId: memberRole,
          status: "PENDING",
          tokenHash: "seed_inv_" + Date.now(),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
    }
  }

  return {
    organizationTypes: await db.organizationType.count(),
    permissions: await db.permission.count(),
    roles: await db.role.count(),
    users: await db.user.count({ where: { email: { contains: "@eks.demo" } } }),
    memberships: await db.membership.count(),
    teams: await db.team.count(),
    invitations: await db.invitation.count(),
  };
}
