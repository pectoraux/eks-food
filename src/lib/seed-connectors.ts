import { db } from "@/lib/db";

/** Idempotent seed for the production connector ecosystem. */
export async function seedConnectors(force = false) {
  if (force) {
    await db.communicationProvider.deleteMany();
    await db.notificationProvider.deleteMany();
    await db.governmentConnection.deleteMany();
    await db.merchantConnection.deleteMany();
    await db.procurementConnection.deleteMany();
    await db.restaurantConnection.deleteMany();
    await db.calendarConnection.deleteMany();
    await db.weatherProvider.deleteMany();
    await db.mapProvider.deleteMany();
    await db.synchronizationHistory.deleteMany();
    await db.connectorCache.deleteMany();
    await db.providerRegion.deleteMany();
    await db.providerCapability.deleteMany();
    await db.providerHealth.deleteMany();
    await db.providerCredential.deleteMany();
    await db.providerConfiguration.deleteMany();
    await db.externalProvider.deleteMany();
  }

  const org = await db.organization.findFirst();
  if (!org) return { error: "no_org" };

  // 1. Register external providers across all categories.
  const providers = [
    // Maps
    { category: "MAPS", code: "google-maps", name: "Google Maps", weight: 100, capabilities: ["geocoding", "reverse_geocoding", "routing", "places", "traffic_aware"], regions: ["global"] },
    { category: "MAPS", code: "here", name: "HERE Technologies", weight: 80, capabilities: ["geocoding", "reverse_geocoding", "routing", "places"], regions: ["global"] },
    { category: "MAPS", code: "mapbox", name: "Mapbox", weight: 75, capabilities: ["geocoding", "reverse_geocoding", "routing", "places"], regions: ["global"] },
    { category: "MAPS", code: "openstreetmap", name: "OpenStreetMap", weight: 50, capabilities: ["geocoding", "reverse_geocoding", "routing"], regions: ["global"] },
    // Weather
    { category: "WEATHER", code: "openweather", name: "OpenWeather", weight: 100, capabilities: ["current_weather", "hourly_forecast", "daily_forecast", "severe_alerts"], regions: ["global"] },
    { category: "WEATHER", code: "weatherapi", name: "WeatherAPI", weight: 85, capabilities: ["current_weather", "hourly_forecast", "daily_forecast"], regions: ["global"] },
    { category: "WEATHER", code: "accuweather", name: "AccuWeather", weight: 70, capabilities: ["current_weather", "daily_forecast", "historical"], regions: ["global"] },
    { category: "WEATHER", code: "open-meteo", name: "Open-Meteo", weight: 50, capabilities: ["current_weather", "hourly_forecast", "daily_forecast"], regions: ["global"] },
    // Calendar
    { category: "CALENDAR", code: "google-calendar", name: "Google Calendar", weight: 100, capabilities: ["read_events", "write_events", "free_busy", "recurring_events"], regions: ["global"] },
    { category: "CALENDAR", code: "outlook", name: "Microsoft Outlook", weight: 80, capabilities: ["read_events", "write_events", "free_busy"], regions: ["global"] },
    { category: "CALENDAR", code: "caldav", name: "CalDAV", weight: 60, capabilities: ["read_events", "write_events"], regions: ["global"] },
    // Government
    { category: "GOVERNMENT", code: "gh-fda", name: "Ghana FDA", weight: 100, capabilities: ["BUSINESS_REG", "FOOD_LICENSE", "FOOD_HANDLER_CERT", "INSPECTION"], regions: ["GH"] },
    { category: "GOVERNMENT", code: "ng-nafdac", name: "NAFDAC Nigeria", weight: 100, capabilities: ["BUSINESS_REG", "FOOD_LICENSE", "FOOD_HANDLER_CERT"], regions: ["NG"] },
    { category: "GOVERNMENT", code: "ke-kebs", name: "KEBS Kenya", weight: 100, capabilities: ["BUSINESS_REG", "FOOD_LICENSE"], regions: ["KE"] },
    { category: "GOVERNMENT", code: "za-sabs", name: "SABS South Africa", weight: 100, capabilities: ["BUSINESS_REG", "FOOD_LICENSE", "FOOD_HANDLER_CERT"], regions: ["ZA"] },
    // Restaurant
    { category: "RESTAURANT", code: "square", name: "Square POS", weight: 90, capabilities: ["menu_sync", "reservations", "operating_hours", "order_sync"], regions: ["global"] },
    { category: "RESTAURANT", code: "toast", name: "Toast POS", weight: 85, capabilities: ["menu_sync", "operating_hours", "order_sync", "kitchen_capacity"], regions: ["global"] },
    { category: "RESTAURANT", code: "lightspeed", name: "Lightspeed", weight: 75, capabilities: ["menu_sync", "reservations", "operating_hours"], regions: ["global"] },
    { category: "RESTAURANT", code: "clover", name: "Clover POS", weight: 70, capabilities: ["menu_sync", "order_sync"], regions: ["global"] },
    // Procurement
    { category: "PROCUREMENT", code: "sysco", name: "Sysco", weight: 100, capabilities: ["catalog_sync", "purchase_orders", "availability"], regions: ["global"] },
    { category: "PROCUREMENT", code: "usfoods", name: "US Foods", weight: 90, capabilities: ["catalog_sync", "purchase_orders", "availability"], regions: ["global"] },
    { category: "PROCUREMENT", code: "metro", name: "Metro", weight: 80, capabilities: ["catalog_sync", "purchase_orders"], regions: ["global"] },
    // Merchant
    { category: "MERCHANT", code: "corporate-meals", name: "Corporate Meals Platform", weight: 100, capabilities: ["contract_import", "recurring_orders", "approvals"], regions: ["global"] },
    { category: "MERCHANT", code: "catering", name: "Catering System", weight: 85, capabilities: ["contract_import", "recurring_orders"], regions: ["global"] },
    { category: "MERCHANT", code: "workplace-ordering", name: "Workplace Ordering", weight: 75, capabilities: ["recurring_orders", "approvals"], regions: ["global"] },
    // Notifications
    { category: "NOTIFICATIONS", code: "sendgrid", name: "SendGrid", weight: 100, capabilities: ["email"], regions: ["global"] },
    { category: "NOTIFICATIONS", code: "mailgun", name: "Mailgun", weight: 80, capabilities: ["email"], regions: ["global"] },
    { category: "NOTIFICATIONS", code: "twilio", name: "Twilio", weight: 100, capabilities: ["sms"], regions: ["global"] },
    { category: "NOTIFICATIONS", code: "messagebird", name: "MessageBird", weight: 80, capabilities: ["sms"], regions: ["global"] },
    { category: "NOTIFICATIONS", code: "fcm", name: "Firebase Cloud Messaging", weight: 100, capabilities: ["push"], regions: ["global"] },
    { category: "NOTIFICATIONS", code: "apns", name: "Apple Push Notification Service", weight: 95, capabilities: ["push"], regions: ["global"] },
    // Communications
    { category: "COMMUNICATIONS", code: "twilio-voice", name: "Twilio Voice", weight: 100, capabilities: ["voice"], regions: ["global"] },
    { category: "COMMUNICATIONS", code: "vonage", name: "Vonage", weight: 85, capabilities: ["voice", "sms"], regions: ["global"] },
    { category: "COMMUNICATIONS", code: "slack", name: "Slack", weight: 90, capabilities: ["chat"], regions: ["global"] },
    { category: "COMMUNICATIONS", code: "teams", name: "Microsoft Teams", weight: 85, capabilities: ["chat"], regions: ["global"] },
    { category: "COMMUNICATIONS", code: "whatsapp", name: "WhatsApp Business", weight: 80, capabilities: ["chat"], regions: ["global"] },
    // Identity
    { category: "IDENTITY", code: "google", name: "Google OAuth", weight: 100, capabilities: ["oauth2", "sso"], regions: ["global"] },
    { category: "IDENTITY", code: "apple", name: "Apple Sign In", weight: 90, capabilities: ["oauth2"], regions: ["global"] },
    { category: "IDENTITY", code: "azure-ad", name: "Azure Active Directory", weight: 85, capabilities: ["oauth2", "sso", "saml"], regions: ["global"] },
    { category: "IDENTITY", code: "okta", name: "Okta", weight: 80, capabilities: ["oauth2", "sso", "saml"], regions: ["global"] },
  ];

  for (const p of providers) {
    const existing = await db.externalProvider.findUnique({ where: { category_code: { category: p.category, code: p.code } } });
    if (!existing) {
      const provider = await db.externalProvider.create({
        data: {
          category: p.category,
          code: p.code,
          name: p.name,
          status: "ACTIVE",
          weight: p.weight,
          capabilities: JSON.stringify(p.capabilities),
          regions: JSON.stringify(p.regions),
          rateLimits: JSON.stringify({ perSecond: 10, perDay: 100000 }),
          pricing: JSON.stringify({ per1kCalls: p.weight > 80 ? 2.0 : p.weight > 50 ? 0.5 : 0 }),
        },
      });
      // Seed capabilities.
      for (const cap of p.capabilities) {
        await db.providerCapability.create({ data: { providerId: provider.id, code: cap, supported: true } }).catch(() => null);
      }
      // Seed health (healthy by default).
      await db.providerHealth.create({ data: { providerId: provider.id, status: "HEALTHY", score: 100, latencyMs: 100 + Math.floor(Math.random() * 200), errorRate: 0.01, successRate: 0.99 } });
      // Seed regions.
      for (const r of p.regions) {
        await db.providerRegion.create({ data: { providerId: provider.id, region: r, available: true, latencyMs: 100 } }).catch(() => null);
      }
    }
  }

  // 2. Category-specific connections for the demo org.
  const existingMap = await db.mapProvider.count({ where: { organizationId: org.id } });
  if (existingMap === 0) {
    await db.mapProvider.create({ data: { organizationId: org.id, providerCode: "google-maps", apiKey: "encrypted:google-maps-key", routingProfile: "driving", trafficAware: true } });
  }
  const existingWeather = await db.weatherProvider.count({ where: { organizationId: org.id } });
  if (existingWeather === 0) {
    await db.weatherProvider.create({ data: { organizationId: org.id, providerCode: "openweather", apiKey: "encrypted:openweather-key", defaultLat: 5.6037, defaultLng: -0.1870, cacheTtlSec: 600 } });
  }
  const existingCalendar = await db.calendarConnection.count({ where: { organizationId: org.id } });
  if (existingCalendar === 0) {
    await db.calendarConnection.create({ data: { organizationId: org.id, providerCode: "google-calendar", externalCalendarId: "primary", encryptedTokens: "encrypted:tokens", active: true, lastSyncAt: new Date() } });
  }
  const existingRestaurant = await db.restaurantConnection.count({ where: { organizationId: org.id } });
  if (existingRestaurant === 0) {
    await db.restaurantConnection.create({ data: { organizationId: org.id, providerCode: "square", restaurantId: "rest_001", encryptedCreds: "encrypted:creds", systemType: "POS", active: true, lastSyncAt: new Date() } });
  }
  const existingProcurement = await db.procurementConnection.count({ where: { organizationId: org.id } });
  if (existingProcurement === 0) {
    await db.procurementConnection.create({ data: { organizationId: org.id, providerCode: "sysco", supplierId: "supplier_001", encryptedCreds: "encrypted:creds", syncIntervalSec: 3600, active: true, lastSyncAt: new Date() } });
  }
  const existingMerchant = await db.merchantConnection.count({ where: { organizationId: org.id } });
  if (existingMerchant === 0) {
    await db.merchantConnection.create({ data: { organizationId: org.id, providerCode: "corporate-meals", merchantId: "merchant_001", encryptedCreds: "encrypted:creds", contract: JSON.stringify({ type: "recurring_meal", durationMonths: 12 }), active: true, lastSyncAt: new Date() } });
  }
  const existingGov = await db.governmentConnection.count({ where: { organizationId: org.id } });
  if (existingGov === 0) {
    await db.governmentConnection.create({ data: { organizationId: org.id, providerCode: "gh-fda", verificationType: "FOOD_LICENSE", encryptedCreds: "encrypted:creds", active: true, lastSyncAt: new Date() } });
  }
  // Notification providers (default per channel).
  const existingNotif = await db.notificationProvider.count({ where: { organizationId: org.id } });
  if (existingNotif === 0) {
    await db.notificationProvider.create({ data: { organizationId: org.id, providerCode: "sendgrid", channel: "EMAIL", encryptedCreds: "encrypted:creds", isDefault: true } });
    await db.notificationProvider.create({ data: { organizationId: org.id, providerCode: "twilio", channel: "SMS", encryptedCreds: "encrypted:creds", isDefault: true } });
    await db.notificationProvider.create({ data: { organizationId: org.id, providerCode: "fcm", channel: "PUSH", encryptedCreds: "encrypted:creds", isDefault: true } });
  }
  // Communication providers.
  const existingComm = await db.communicationProvider.count({ where: { organizationId: org.id } });
  if (existingComm === 0) {
    await db.communicationProvider.create({ data: { organizationId: org.id, providerCode: "twilio-voice", channel: "VOICE", encryptedCreds: "encrypted:creds", isDefault: true } });
    await db.communicationProvider.create({ data: { organizationId: org.id, providerCode: "slack", channel: "CHAT", encryptedCreds: "encrypted:creds", isDefault: true } });
  }

  // 3. Sync history (sample).
  const existingSync = await db.synchronizationHistory.count({ where: { organizationId: org.id } });
  if (existingSync === 0) {
    const mapsProvider = await db.externalProvider.findUnique({ where: { category_code: { category: "MAPS", code: "google-maps" } } });
    if (mapsProvider) {
      await db.synchronizationHistory.create({
        data: { organizationId: org.id, providerId: mapsProvider.id, resource: "geocoding_cache", mode: "FULL", status: "COMPLETED", recordsSynced: 500, durationMs: 12000, completedAt: new Date() },
      });
    }
    const weatherProvider = await db.externalProvider.findUnique({ where: { category_code: { category: "WEATHER", code: "openweather" } } });
    if (weatherProvider) {
      await db.synchronizationHistory.create({
        data: { organizationId: org.id, providerId: weatherProvider.id, resource: "weather_forecast", mode: "INCREMENTAL", status: "COMPLETED", recordsSynced: 24, durationMs: 800, nextCursor: `wthr_${Date.now()}`, completedAt: new Date() },
      });
    }
  }

  return {
    providers: await db.externalProvider.count(),
    connections: await db.mapProvider.count() + await db.weatherProvider.count() + await db.calendarConnection.count() + await db.restaurantConnection.count() + await db.procurementConnection.count() + await db.merchantConnection.count() + await db.governmentConnection.count() + await db.notificationProvider.count() + await db.communicationProvider.count(),
    syncHistory: await db.synchronizationHistory.count(),
  };
}
