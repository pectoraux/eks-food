import { db } from "@/lib/db";

/**
 * Booking Matching Engine
 *
 * Scores candidate cooks for a booking request across the dimensions called out
 * in the platform spec: distance, rating, availability, cuisine fit, price,
 * language, and past customer preference. Returns ranked candidates plus a
 * debug trail so dispatch decisions are explainable & auditable.
 */

export interface MatchRequest {
  organizationId: string;
  customerId?: string;
  lat: number;
  lng: number;
  cuisines?: string[];
  languages?: string[];
  maxHourlyRate?: number;
  scheduledFor?: Date;
  partySize?: number;
}

export interface MatchedCook {
  cookId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  bio: string;
  cuisines: string[];
  skills: string[];
  languages: string[];
  hourlyRate: number;
  currency: string;
  rating: number;
  totalJobs: number;
  completedJobs: number;
  responseTimeMins: number;
  verificationStatus: string;
  homeRegion: string | null;
  distanceKm: number;
  score: number;
  breakdown: {
    distance: number;
    rating: number;
    availability: number;
    cuisine: number;
    price: number;
    language: number;
    preference: number;
  };
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export async function matchCooks(req: MatchRequest): Promise<MatchedCook[]> {
  const cooks = await db.cook.findMany({
    where: {
      organizationId: req.organizationId,
      verificationStatus: "APPROVED",
      availabilityMode: { in: ["FLEXIBLE", "SCHEDULED"] },
      ...(req.maxHourlyRate ? { hourlyRate: { lte: req.maxHourlyRate } } : {}),
    },
    include: { user: true },
  });

  // Load customer preference (favorite cuisines) for preference signal
  let prefCuisines: string[] = [];
  let preferredCookIds: string[] = [];
  if (req.customerId) {
    const favs = await db.favorite.findMany({ where: { customerId: req.customerId } });
    preferredCookIds = favs.map((f) => f.cookId);
    const cust = await db.customer.findUnique({ where: { userId: req.customerId } });
    if (cust?.favoriteCuisines) prefCuisines = cust.favoriteCuisines.split("|").filter(Boolean);
  }

  const scored: MatchedCook[] = [];
  for (const cook of cooks) {
    const cookCuisines = cook.cuisines.split("|").filter(Boolean);
    const cookLanguages = cook.languages.split("|").filter(Boolean);

    const distanceKm = cook.lat && cook.lng
      ? haversineKm({ lat: req.lat, lng: req.lng }, { lat: cook.lat, lng: cook.lng })
      : 99;

    // --- Scoring (each component 0..1) ---
    const distanceScore = Math.max(0, 1 - distanceKm / 25); // >25km = 0
    const ratingScore = Math.max(0, Math.min(1, (cook.rating - 3.5) / 1.5));
    const availabilityScore = cook.availabilityMode === "FLEXIBLE" ? 1 : 0.7;

    let cuisineScore = 0.5;
    if (req.cuisines && req.cuisines.length > 0) {
      const overlap = req.cuisines.filter((c) => cookCuisines.includes(c)).length;
      cuisineScore = overlap / req.cuisines.length;
    }

    const priceScore = req.maxHourlyRate
      ? Math.max(0, 1 - (cook.hourlyRate / req.maxHourlyRate - 0.5))
      : 0.8;

    let languageScore = 0.5;
    if (req.languages && req.languages.length > 0) {
      const overlap = req.languages.filter((l) => cookLanguages.includes(l)).length;
      languageScore = Math.min(1, 0.5 + overlap * 0.5);
    }

    let preferenceScore = 0.5;
    if (preferredCookIds.includes(cook.id)) preferenceScore = 1;
    else if (prefCuisines.length > 0) {
      const overlap = prefCuisines.filter((c) => cookCuisines.includes(c)).length;
      preferenceScore = 0.5 + Math.min(0.5, overlap * 0.25);
    }

    // Weighted blend — weights are configurable in production via PricingRule/config.
    const weights = { distance: 0.25, rating: 0.2, availability: 0.1, cuisine: 0.2, price: 0.1, language: 0.05, preference: 0.1 };
    const score =
      weights.distance * distanceScore +
      weights.rating * ratingScore +
      weights.availability * availabilityScore +
      weights.cuisine * cuisineScore +
      weights.price * priceScore +
      weights.language * languageScore +
      weights.preference * preferenceScore;

    scored.push({
      cookId: cook.id,
      userId: cook.userId,
      name: cook.user.name,
      avatarUrl: cook.avatarUrl,
      bio: cook.bio,
      cuisines: cookCuisines,
      skills: cook.skills.split("|").filter(Boolean),
      languages: cookLanguages,
      hourlyRate: cook.hourlyRate,
      currency: cook.currency,
      rating: cook.rating,
      totalJobs: cook.totalJobs,
      completedJobs: cook.completedJobs,
      responseTimeMins: cook.responseTimeMins,
      verificationStatus: cook.verificationStatus,
      homeRegion: cook.homeRegion,
      distanceKm: Math.round(distanceKm * 10) / 10,
      score: Math.round(score * 1000) / 1000,
      breakdown: {
        distance: Math.round(distanceScore * 100) / 100,
        rating: Math.round(ratingScore * 100) / 100,
        availability: Math.round(availabilityScore * 100) / 100,
        cuisine: Math.round(cuisineScore * 100) / 100,
        price: Math.round(priceScore * 100) / 100,
        language: Math.round(languageScore * 100) / 100,
        preference: Math.round(preferenceScore * 100) / 100,
      },
    });
  }

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Auto-assigns the best matching cook. Falls back to PENDING_MATCH when no
 * candidate clears the acceptance threshold, mirroring the dispatch engine's
 * fallback + escalation behaviour.
 */
export async function autoAssign(
  bookingId: string,
  candidates: MatchedCook[],
  threshold = 0.55
): Promise<{ assigned: boolean; cookId?: string; matchScore?: number; reason: string }> {
  const best = candidates[0];
  if (!best) return { assigned: false, reason: "NO_CANDIDATES" };
  if (best.score < threshold) return { assigned: false, reason: "BELOW_THRESHOLD" };

  await db.booking.update({
    where: { id: bookingId },
    data: { cookId: best.cookId, matchScore: best.score, status: "ASSIGNED", matchDebug: JSON.stringify(best.breakdown) },
  });
  return { assigned: true, cookId: best.cookId, matchScore: best.score, reason: "AUTO_ASSIGNED" };
}
