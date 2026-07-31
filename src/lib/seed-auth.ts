/**
 * @file seed-auth.ts
 *
 * Seeds the production admin account + 14 demo accounts.
 * Idempotent — safe to run multiple times.
 */
import { db } from "@/lib/db";
import { hashPassword } from "@eks/auth";

const PROD_ADMIN_EMAIL = "ekontetevi@gmail.com";
const PROD_ADMIN_PASSWORD = "Payswap123456";
const DEMO_PASSWORD = "demo123456";

interface DemoAccountDef {
  role: string;
  displayName: string;
  description: string;
  email: string;
  responsibilities: string[];
  availableTools: string[];
  aiTeam?: string;
  workflows: string[];
  icon: string;
  sortOrder: number;
}

const DEMO_ACCOUNTS: DemoAccountDef[] = [
  {
    role: "CUSTOMER",
    displayName: "Ama Mensah",
    description: "Household of 4 in Greater Accra. Loves Ghanaian cuisine.",
    email: "demo.customer@eks-food.com",
    responsibilities: ["Browse cooks", "Book meals", "Manage pantry", "Track spending"],
    availableTools: ["Meal Planner", "Pantry Dashboard", "Shopping Lists", "Preference Center"],
    aiTeam: "Savings Agent + Nutrition Agent + Meal Planning Agent",
    workflows: ["Weekly meal planning", "Grocery ordering", "Budget tracking"],
    icon: "Home",
    sortOrder: 1,
  },
  {
    role: "COOK",
    displayName: "Kwabena Owusu",
    description: "5 years experience. Ghanaian + Continental cuisine. Certified.",
    email: "demo.cook@eks-food.com",
    responsibilities: ["Accept bookings", "Manage schedule", "Update portfolio", "Track earnings"],
    availableTools: ["Shift Dashboard", "Portfolio", "Performance Metrics", "Compliance Center"],
    aiTeam: "Cook Schedule Agent + Kitchen Agent + Quality Agent",
    workflows: ["Shift management", "Quality reporting", "Certification tracking"],
    icon: "Utensils",
    sortOrder: 2,
  },
  {
    role: "RESTAURANT_OWNER",
    displayName: "Abena Frimpong",
    description: "Buka Restaurant — 3 locations, 45 staff, Ghanaian fine dining.",
    email: "demo.restaurant@eks-food.com",
    responsibilities: ["Manage locations", "Oversee operations", "Monitor SOPs", "Track performance"],
    availableTools: ["Restaurant Dashboard", "Location Manager", "SOP Manager", "Equipment Tracker"],
    aiTeam: "Restaurant Operations Agent + Menu Agent",
    workflows: ["Multi-location management", "SOP enforcement", "Capacity planning"],
    icon: "Store",
    sortOrder: 3,
  },
  {
    role: "RESTAURANT_STAFF",
    displayName: "Kofi Asante",
    description: "Kitchen Manager at Buka Restaurant. Handles daily operations.",
    email: "demo.staff@eks-food.com",
    responsibilities: ["Kitchen operations", "Staff coordination", "Quality control"],
    availableTools: ["Kitchen Dashboard", "SOP Manager", "Equipment Tracker"],
    workflows: ["Daily kitchen ops", "Staff scheduling", "Quality checks"],
    icon: "ChefHat",
    sortOrder: 4,
  },
  {
    role: "VENDOR",
    displayName: "Ekow Wilson",
    description: "Fresh produce vendor. 50+ products. Serves 20+ restaurants.",
    email: "demo.vendor@eks-food.com",
    responsibilities: ["Manage products", "Fulfill orders", "Track deliveries"],
    availableTools: ["Vendor Dashboard", "Product Catalog", "Order Manager"],
    workflows: ["Product management", "Order fulfillment", "Delivery tracking"],
    icon: "ShoppingBag",
    sortOrder: 5,
  },
  {
    role: "SUPPLIER",
    displayName: "Akosua Boateng",
    description: "Wholesale supplier. 200+ SKUs. Serves Greater Accra region.",
    email: "demo.supplier@eks-food.com",
    responsibilities: ["Manage inventory", "Process POs", "Warehouse operations"],
    availableTools: ["Supplier Dashboard", "Purchase Orders", "Warehouse Manager"],
    aiTeam: "Supplier Agent + Recall Agent",
    workflows: ["Inventory management", "PO processing", "Recall management"],
    icon: "Truck",
    sortOrder: 6,
  },
  {
    role: "FOOD_INSPECTOR",
    displayName: "Yaw Osei",
    description: "FDA-certified inspector. 10 years experience. Greater Accra region.",
    email: "demo.inspector@eks-food.com",
    responsibilities: ["Conduct inspections", "Issue certificates", "Track compliance"],
    availableTools: ["Compliance Center", "Inspection Scheduler", "Certificate Manager"],
    workflows: ["Scheduled inspections", "Compliance tracking", "Certificate issuance"],
    icon: "ShieldCheck",
    sortOrder: 7,
  },
  {
    role: "RIDER",
    displayName: "Kwesi Mensah",
    description: "Motorcycle rider. 500+ deliveries. Greater Accra.",
    email: "demo.rider@eks-food.com",
    responsibilities: ["Accept deliveries", "Navigate routes", "Update status"],
    availableTools: ["Delivery Console", "Tracking", "Route Optimizer"],
    aiTeam: "Dispatch Agent + Route Agent",
    workflows: ["Delivery acceptance", "Route optimization", "Proof of delivery"],
    icon: "Bike",
    sortOrder: 8,
  },
  {
    role: "FLEET_MANAGER",
    displayName: "Ama Darko",
    description: "Manages 15 vehicles and 20 riders across Greater Accra.",
    email: "demo.fleet@eks-food.com",
    responsibilities: ["Manage fleet", "Assign riders", "Track vehicles"],
    availableTools: ["Fleet Dashboard", "Vehicle Manager", "Rider Scheduler"],
    workflows: ["Fleet assignment", "Vehicle maintenance", "Rider scheduling"],
    icon: "Car",
    sortOrder: 9,
  },
  {
    role: "AREA_MANAGER",
    displayName: "Daniel Adjei",
    description: "Manages Greater Accra region. 50+ restaurants under management.",
    email: "demo.area@eks-food.com",
    responsibilities: ["Regional oversight", "Performance tracking", "Expansion planning"],
    availableTools: ["Regional Dashboard", "Restaurant Analytics", "Capacity Planner"],
    aiTeam: "Marketplace Intel Agent + Demand Intel Agent",
    workflows: ["Regional monitoring", "Expansion planning", "Performance reviews"],
    icon: "MapPin",
    sortOrder: 10,
  },
  {
    role: "ORG_ADMIN",
    displayName: "Grace Amoah",
    description: "Organization administrator for Eks-Food Demo Organization.",
    email: "demo.admin@eks-food.com",
    responsibilities: ["Manage users", "Configure settings", "Monitor activity"],
    availableTools: ["Admin Dashboard", "User Manager", "Settings"],
    workflows: ["User management", "Org configuration", "Activity monitoring"],
    icon: "Building2",
    sortOrder: 11,
  },
  {
    role: "DEVELOPER",
    displayName: "Samuel Tetteh",
    description: "Extension developer. 2 published extensions on the marketplace.",
    email: "demo.developer@eks-food.com",
    responsibilities: ["Build extensions", "Publish to marketplace", "Manage API keys"],
    availableTools: ["Developer Console", "Extension Builder", "API Explorer", "Marketplace Publisher"],
    workflows: ["Extension development", "Marketplace publishing", "API key management"],
    icon: "Code",
    sortOrder: 12,
  },
  {
    role: "MARKETPLACE_PUBLISHER",
    displayName: "Linda Quaye",
    description: "Marketplace publisher with 3 published extensions.",
    email: "demo.publisher@eks-food.com",
    responsibilities: ["Publish extensions", "Manage listings", "Track installs"],
    availableTools: ["Marketplace Publisher", "Listing Manager", "Install Tracker"],
    workflows: ["Extension publishing", "Listing management", "Analytics"],
    icon: "Package",
    sortOrder: 13,
  },
  {
    role: "PLATFORM_ADMIN",
    displayName: "Michael Ankomah",
    description: "Platform-wide administrator. Full system access.",
    email: "demo.platform-admin@eks-food.com",
    responsibilities: ["Platform oversight", "Manage all orgs", "System configuration"],
    availableTools: ["Platform Dashboard", "Operations Center", "Governance", "Compliance"],
    aiTeam: "Safety Agent + Learning Agent",
    workflows: ["Platform monitoring", "Incident management", "Governance"],
    icon: "Shield",
    sortOrder: 14,
  },
];

export async function seedAuth(force = false) {
  if (!force) {
    const existing = await db.demoAccount.count();
    if (existing > 0) {
      return { skipped: true, reason: "Auth seed already exists (use force=true to re-seed)" };
    }
  }

  if (force) {
    await db.demoAccount.deleteMany();
    await db.session.deleteMany();
    await db.user.deleteMany({ where: { email: { startsWith: "demo." } } });
    await db.user.deleteMany({ where: { email: PROD_ADMIN_EMAIL } });
  }

  // Get or create the demo organization
  let org = await db.organization.findFirst();
  if (!org) {
    org = await db.organization.create({
      data: {
        slug: "eks-food-demo",
        name: "Eks-Food Demo Organization",
        country: "Ghana",
        baseCurrency: "GHS",
        status: "ACTIVE",
      },
    });
  }

  // 1. Create the production admin
  const adminHash = await hashPassword(PROD_ADMIN_PASSWORD);
  let adminUser = await db.user.findUnique({ where: { email: PROD_ADMIN_EMAIL } });
  if (!adminUser) {
    adminUser = await db.user.create({
      data: {
        email: PROD_ADMIN_EMAIL,
        name: "Platform Administrator",
        roles: "SUPER_ADMIN",
        status: "ACTIVE",
        organizationId: org.id,
        phone: "+233200000000",
      },
    });
    // Store the password hash in the Identity table
    await db.identity.create({
      data: {
        userId: adminUser.id,
        provider: "PASSWORD",
        subject: PROD_ADMIN_EMAIL,
        credentialHash: adminHash,
        verified: true,
      },
    });
  }

  // 2. Create demo accounts
  const demoHash = await hashPassword(DEMO_PASSWORD);
  let created = 0;

  for (const def of DEMO_ACCOUNTS) {
    // Check if user already exists
    let user = await db.user.findUnique({ where: { email: def.email } });
    if (!user) {
      user = await db.user.create({
        data: {
          email: def.email,
          name: def.displayName,
          roles: def.role,
          status: "ACTIVE",
          organizationId: org.id,
        },
      });
      await db.identity.create({
        data: {
          userId: user.id,
          provider: "PASSWORD",
          subject: def.email,
          credentialHash: demoHash,
          verified: true,
        },
      });
    }

    // Check if demo account already exists
    const existingDemo = await db.demoAccount.findUnique({ where: { role: def.role } });
    if (!existingDemo) {
      await db.demoAccount.create({
        data: {
          role: def.role,
          displayName: def.displayName,
          description: def.description,
          email: def.email,
          userId: user.id,
          organizationId: org.id,
          responsibilities: JSON.stringify(def.responsibilities),
          availableTools: JSON.stringify(def.availableTools),
          aiTeam: def.aiTeam ?? null,
          workflows: JSON.stringify(def.workflows),
          icon: def.icon,
          sortOrder: def.sortOrder,
          active: true,
        },
      });
      created++;
    }
  }

  return {
    ok: true,
    productionAdmin: adminUser ? 1 : 0,
    demoAccounts: created,
    totalDemoAccounts: DEMO_ACCOUNTS.length,
    organizationId: org.id,
  };
}
