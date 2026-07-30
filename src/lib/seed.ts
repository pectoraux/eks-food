import { db } from "@/lib/db";

/**
 * Idempotent seed for the Eks-Food reference deployment.
 * Safe to call repeatedly — it upserts on stable slugs/codes.
 */
export async function seedDatabase(force = false) {
  if (force) {
    await db.auditLog.deleteMany();
    await db.demandSignal.deleteMany();
    await db.inspection.deleteMany();
    await db.payswapTransfer.deleteMany();
    await db.payswapPayment.deleteMany();
    await db.booking.deleteMany();
    await db.certification.deleteMany();
    await db.cookAvailability.deleteMany();
    await db.favorite.deleteMany();
    await db.address.deleteMany();
    await db.cook.deleteMany();
    await db.customer.deleteMany();
    await db.pricingRule.deleteMany();
    await db.featureFlag.deleteMany();
    await db.region.deleteMany();
    await db.mealCategory.deleteMany();
    await db.service.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
  }

  const org = await db.organization.upsert({
    where: { slug: "eks-ghana" },
    update: {},
    create: {
      slug: "eks-ghana",
      name: "Eks-Food Ghana",
      country: "Ghana",
      baseCurrency: "GHS",
      status: "ACTIVE",
    },
  });

  // ---- Configurable catalog (Admin-driven) ----
  const services = [
    { code: "IN_HOME_COOKING", name: "In-Home Cooking", description: "A verified cook prepares meals in your kitchen.", basePrice: 80, estimatedMins: 120 },
    { code: "MEAL_PREP", name: "Weekly Meal Prep", description: "Batch-cook meals for the week, packaged & labelled.", basePrice: 160, estimatedMins: 180 },
    { code: "EVENT_CATERING", name: "Event Catering", description: "Cooks & support for private events.", basePrice: 450, estimatedMins: 300 },
    { code: "SPECIAL_DIET", name: "Special Diet Cooking", description: "Vegan, keto, diabetic-friendly meal preparation.", basePrice: 120, estimatedMins: 120 },
  ];
  for (const s of services) {
    await db.service.upsert({
      where: { organizationId_code: { organizationId: org.id, code: s.code } },
      update: {},
      create: { organizationId: org.id, ...s, currency: "GHS", config: "{}" },
    });
  }

  const mealCats = [
    { name: "Ghanaian", icon: "🍲", sortOrder: 1 },
    { name: "Nigerian", icon: "🌶️", sortOrder: 2 },
    { name: "Vegan", icon: "🥗", sortOrder: 3 },
    { name: "Continental", icon: "🍝", sortOrder: 4 },
    { name: "Pastries", icon: "🥐", sortOrder: 5 },
    { name: "Grills", icon: "🔥", sortOrder: 6 },
  ];
  for (const c of mealCats) {
    await db.mealCategory.upsert({
      where: { organizationId_name: { organizationId: org.id, name: c.name } },
      update: {},
      create: { organizationId: org.id, ...c },
    });
  }

  const regions = [
    { name: "Accra Central", country: "Ghana", bounds: JSON.stringify({ ne: { lat: 5.6, lng: -0.18 }, sw: { lat: 5.54, lng: -0.24 } }) },
    { name: "East Legon", country: "Ghana", bounds: JSON.stringify({ ne: { lat: 5.66, lng: -0.16 }, sw: { lat: 5.62, lng: -0.2 } }) },
    { name: "Kumasi", country: "Ghana", bounds: JSON.stringify({ ne: { lat: 6.72, lng: -1.6 }, sw: { lat: 6.68, lng: -1.64 } }) },
    { name: "Takoradi", country: "Ghana", bounds: JSON.stringify({ ne: { lat: 4.92, lng: -1.74 }, sw: { lat: 4.88, lng: -1.78 } }) },
  ];
  for (const r of regions) {
    await db.region.upsert({
      where: { organizationId_name: { organizationId: org.id, name: r.name } },
      update: {},
      create: { organizationId: org.id, ...r, active: true },
    });
  }

  const pricingRules = [
    { name: "Standard Hourly", kind: "SLIDER", config: JSON.stringify({ perHour: 40, minCharge: 60, currency: "GHS" }) },
    { name: "Peak Surcharge", kind: "SURGE", config: JSON.stringify({ multiplier: 1.25, windowHours: [17, 18, 19, 20] }) },
    { name: "Event Flat", kind: "FIXED", config: JSON.stringify({ amount: 450 }) },
    { name: "Volume Tier", kind: "TIERED", config: JSON.stringify({ tiers: [{ upTo: 4, perHead: 25 }, { upTo: 10, perHead: 20 }, { upTo: 999, perHead: 16 }] }) },
  ];
  for (const p of pricingRules) {
    const existing = await db.pricingRule.findFirst({ where: { organizationId: org.id, name: p.name } });
    if (!existing) {
      await db.pricingRule.create({ data: { organizationId: org.id, ...p, active: true } });
    }
  }

  const flags = [
    { key: "ai_assistant", enabled: true, config: JSON.stringify({ model: "glm-4.6" }) },
    { key: "group_purchasing", enabled: false, config: JSON.stringify({}) },
    { key: "shared_cooking", enabled: false, config: JSON.stringify({}) },
    { key: "restaurant_marketplace", enabled: false, config: JSON.stringify({}) },
    { key: "ready_meals", enabled: false, config: JSON.stringify({}) },
    { key: "procurement", enabled: true, config: JSON.stringify({}) },
    { key: "food_intelligence", enabled: true, config: JSON.stringify({}) },
  ];
  for (const f of flags) {
    await db.featureFlag.upsert({
      where: { organizationId_key: { organizationId: org.id, key: f.key } },
      update: {},
      create: { organizationId: org.id, ...f },
    });
  }

  // ---- Users & profiles ----
  type CookSeed = {
    email: string; name: string; phone: string; bio: string; cuisines: string;
    skills: string; languages: string; hourlyRate: number; rating: number;
    totalJobs: number; completedJobs: number; responseTimeMins: number;
    verificationStatus: string; homeRegion: string; lat: number; lng: number;
    availabilityMode: string; avatarUrl: string;
    certs: { title: string; issuer: string; status: string }[];
  };
  const cooks: CookSeed[] = [
    {
      email: "amara@eks.food", name: "Amara Mensah", phone: "+233 24 000 0001",
      bio: "Home-style Ghanaian cooking with a modern, healthy twist. 12 years experience catering for families in Accra.",
      cuisines: "ghanaian|nigerian|vegan", skills: "grilling|baking|meal_prep", languages: "en|tw",
      hourlyRate: 55, rating: 4.9, totalJobs: 312, completedJobs: 301, responseTimeMins: 9,
      verificationStatus: "APPROVED", homeRegion: "East Legon", lat: 5.641, lng: -0.183,
      availabilityMode: "FLEXIBLE", avatarUrl: "/images/cook-amara.png",
      certs: [
        { title: "Food Safety Level 2", issuer: "Ghana FDA", status: "VERIFIED" },
        { title: "Hygiene Certification", issuer: "Eks-Food Inspectors", status: "VERIFIED" },
      ],
    },
    {
      email: "kwame@eks.food", name: "Kwame Owusu", phone: "+233 24 000 0002",
      bio: "Specialist in traditional Ghanaian cuisine — jollof, fufu, banku, light soup. Catered 200+ events.",
      cuisines: "ghanaian|grills", skills: "grilling|stews|catering", languages: "en|tw|ga",
      hourlyRate: 50, rating: 4.8, totalJobs: 421, completedJobs: 408, responseTimeMins: 12,
      verificationStatus: "APPROVED", homeRegion: "Accra Central", lat: 5.557, lng: -0.215,
      availabilityMode: "FLEXIBLE", avatarUrl: "/images/cook-kwame.png",
      certs: [
        { title: "Food Safety Level 2", issuer: "Ghana FDA", status: "VERIFIED" },
      ],
    },
    {
      email: "zainab@eks.food", name: "Zainab Adamu", phone: "+233 24 000 0003",
      bio: "East African & vegan specialist. Plant-forward meals, pastry, and healthy meal prep for busy professionals.",
      cuisines: "vegan|continental|pastries", skills: "baking|pastry|meal_prep", languages: "en|ha",
      hourlyRate: 60, rating: 5.0, totalJobs: 188, completedJobs: 184, responseTimeMins: 6,
      verificationStatus: "APPROVED", homeRegion: "East Legon", lat: 5.648, lng: -0.175,
      availabilityMode: "SCHEDULED", avatarUrl: "/images/cook-zainab.png",
      certs: [
        { title: "Vegan Nutrition Certificate", issuer: "Africa Culinary Institute", status: "VERIFIED" },
        { title: "Food Safety Level 2", issuer: "Ghana FDA", status: "VERIFIED" },
      ],
    },
    {
      email: "tunde@eks.food", name: "Tunde Bello", phone: "+233 24 000 0004",
      bio: "Nigerian & West African fusion. Bold flavours, event catering specialist, large party expertise.",
      cuisines: "nigerian|ghanaian|grills", skills: "grilling|stews|catering", languages: "en|yo",
      hourlyRate: 65, rating: 4.7, totalJobs: 256, completedJobs: 247, responseTimeMins: 18,
      verificationStatus: "APPROVED", homeRegion: "Accra Central", lat: 5.561, lng: -0.209,
      availabilityMode: "FLEXIBLE", avatarUrl: "/images/cook-tunde.png",
      certs: [
        { title: "Event Catering License", issuer: "Eks-Food Inspectors", status: "VERIFIED" },
      ],
    },
  ];

  for (const c of cooks) {
    const user = await db.user.upsert({
      where: { email: c.email },
      update: {},
      create: {
        email: c.email,
        name: c.name,
        phone: c.phone,
        roles: "COOK",
        status: "ACTIVE",
        organizationId: org.id,
        avatarUrl: c.avatarUrl,
      },
    });
    const cook = await db.cook.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        organizationId: org.id,
        userId: user.id,
        bio: c.bio,
        cuisines: c.cuisines,
        skills: c.skills,
        languages: c.languages,
        hourlyRate: c.hourlyRate,
        rating: c.rating,
        totalJobs: c.totalJobs,
        completedJobs: c.completedJobs,
        responseTimeMins: c.responseTimeMins,
        verificationStatus: c.verificationStatus,
        homeRegion: c.homeRegion,
        lat: c.lat,
        lng: c.lng,
        availabilityMode: c.availabilityMode,
        avatarUrl: c.avatarUrl,
      },
    });
    for (const cert of c.certs) {
      const existing = await db.certification.findFirst({ where: { cookId: cook.id, title: cert.title } });
      if (!existing) {
        await db.certification.create({
          data: {
            cookId: cook.id,
            title: cert.title,
            issuer: cert.issuer,
            status: cert.status,
            issuedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 200),
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 165),
          },
        });
      }
    }
    // Availability: Mon-Sat, 8am-8pm
    for (const weekday of [1, 2, 3, 4, 5, 6]) {
      const exists = await db.cookAvailability.findFirst({ where: { cookId: cook.id, weekday, startHour: 8 } });
      if (!exists) {
        await db.cookAvailability.create({ data: { cookId: cook.id, weekday, startHour: 8, endHour: 20 } });
      }
    }
  }

  // Demo customer
  const customerEmail = "abena@household.com";
  const cUser = await db.user.upsert({
    where: { email: customerEmail },
    update: {},
    create: { email: customerEmail, name: "Abena Boateng", phone: "+233 24 555 0101", roles: "CUSTOMER", organizationId: org.id, status: "ACTIVE" },
  });
  const customer = await db.customer.upsert({
    where: { userId: cUser.id },
    update: {},
    create: {
      organizationId: org.id,
      userId: cUser.id,
      dietaryPrefs: "low_sodium",
      favoriteCuisines: "ghanaian|vegan",
      rating: 4.9,
      totalBookings: 14,
    },
  });
  const addrExisting = await db.address.findFirst({ where: { customerId: customer.id, line1: "12 Liberation Road" } });
  if (!addrExisting) {
    await db.address.create({
      data: { customerId: customer.id, label: "Home", line1: "12 Liberation Road", city: "Accra", region: "East Legon", lat: 5.645, lng: -0.181, instructions: "Gate code 4421", isDefault: true },
    });
  }

  // Manager + Inspector + Admin
  await db.user.upsert({
    where: { email: "manager@eks.food" },
    update: {},
    create: { email: "manager@eks.food", name: "Kojo Asante", roles: "MANAGER", organizationId: org.id, status: "ACTIVE" },
  });
  await db.user.upsert({
    where: { email: "inspector@eks.food" },
    update: {},
    create: { email: "inspector@eks.food", name: "Dr. Efua Darko", roles: "INSPECTOR", organizationId: org.id, status: "ACTIVE" },
  });
  await db.user.upsert({
    where: { email: "admin@eks.food" },
    update: {},
    create: { email: "admin@eks.food", name: "Yusuf Ibrahim", roles: "SUPER_ADMIN", organizationId: org.id, status: "ACTIVE" },
  });

  // ---- Food Intelligence: demand signals (anonymized, aggregated) ----
  const regionNames = ["Accra Central", "East Legon", "Kumasi", "Takoradi"];
  const cuisineNames = ["ghanaian", "nigerian", "vegan", "continental", "grills"];
  const today = new Date();
  const existingSignals = await db.demandSignal.count({ where: { organizationId: org.id } });
  if (existingSignals === 0) {
    const rows: { organizationId: string; region: string; cuisine: string; day: string; hour: number; demandScore: number; avgPrice: number; bookings: number }[] = [];
    for (let d = 13; d >= 0; d--) {
      const day = new Date(today);
      day.setDate(today.getDate() - d);
      const dayStr = day.toISOString().slice(0, 10);
      for (const region of regionNames) {
        for (const cuisine of cuisineNames) {
          for (const hour of [8, 12, 17, 19, 20]) {
            // deterministic pseudo-random based on inputs
            const seedVal = hashStr(`${region}${cuisine}${dayStr}${hour}`);
            const base = (seedVal % 60) + 20;
            const weekendBoost = (day.getDay() === 0 || day.getDay() === 6) ? 15 : 0;
            const hourBoost = (hour === 12 || hour === 19) ? 18 : 0;
            const demandScore = Math.min(100, base + weekendBoost + hourBoost);
            const avgPrice = 60 + (seedVal % 40) + (cuisine === "continental" ? 25 : 0);
            const bookings = Math.round(demandScore / 8);
            rows.push({ organizationId: org.id, region, cuisine, day: dayStr, hour, demandScore, avgPrice, bookings });
          }
        }
      }
    }
    // Insert in chunks to keep SQLite happy
    for (let i = 0; i < rows.length; i += 50) {
      await db.demandSignal.createMany({ data: rows.slice(i, i + 50) as any });
    }
  }

  // ---- Sample booking history + payments ----
  const sampleCook = await db.cook.findFirst({ where: { organizationId: org.id }, orderBy: { rating: "desc" } });
  const inHomeService = await db.service.findFirst({ where: { organizationId: org.id, code: "IN_HOME_COOKING" } });
  if (sampleCook && inHomeService && customer) {
    const existingHistory = await db.booking.count({ where: { organizationId: org.id, customerId: customer.id } });
    if (existingHistory === 0) {
      for (let i = 0; i < 5; i++) {
        const scheduled = new Date(today);
        scheduled.setDate(today.getDate() - (i + 1) * 6);
        const code = `EKS-${(1000 + i).toString()}`;
        const quoted = 80 + i * 20;
        const booking = await db.booking.create({
          data: {
            organizationId: org.id,
            code,
            customerId: customer.id,
            cookId: sampleCook.id,
            serviceId: inHomeService.id,
            bookingType: "SCHEDULED",
            scheduledFor: scheduled,
            durationMins: 120,
            partySize: 2 + i,
            addressLine1: "12 Liberation Road",
            city: "Accra",
            region: "East Legon",
            lat: 5.645,
            lng: -0.181,
            status: "COMPLETED",
            matchScore: 0.92,
            matchDebug: JSON.stringify({ distance: 1.2, rating: 4.9, cuisine: "ghanaian", language: "en" }),
            quotedPrice: quoted,
            currency: "GHS",
          },
        });
        await db.payswapPayment.create({
          data: {
            organizationId: org.id,
            payswapId: `pi_hist_${code}`,
            bookingCode: code,
            customerId: cUser.id,
            amount: quoted,
            currency: "GHS",
            status: "SUCCEEDED",
            methodSummary: JSON.stringify({ method: "mobile_money", provider: "mtn" }),
            idempotencyKey: `idmp_hist_${code}`,
          },
        }).catch(() => null);
        // worker payout
        await db.payswapTransfer.create({
          data: {
            organizationId: org.id,
            payswapId: `tr_hist_${code}`,
            payeeUserId: sampleCook.userId,
            amount: quoted * 0.8,
            currency: "GHS",
            status: "PAID",
            metadata: JSON.stringify({ bookingCode: code }),
          },
        }).catch(() => null);
      }
    }
  }

  return {
    organization: org.slug,
    cooks: await db.cook.count({ where: { organizationId: org.id } }),
    customers: await db.customer.count({ where: { organizationId: org.id } }),
    services: await db.service.count({ where: { organizationId: org.id } }),
    bookings: await db.booking.count({ where: { organizationId: org.id } }),
    demandSignals: await db.demandSignal.count({ where: { organizationId: org.id } }),
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
