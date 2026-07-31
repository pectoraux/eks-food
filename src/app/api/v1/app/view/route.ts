import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { success } from "@eks/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/app/view?role=CUSTOMER&view=home
 *
 * Returns view-specific data for the given role + view combination.
 * Each (role, view) pair returns unique content so every nav item
 * shows a different page.
 */
export async function GET(req: NextRequest) {
  const role = req.nextUrl.searchParams.get("role") ?? "CUSTOMER";
  const view = req.nextUrl.searchParams.get("view") ?? "home";
  const userId = req.nextUrl.searchParams.get("userId") ?? "";

  // Query real data from the database — each query is individually try/caught
  async function safeCount(model: string, where?: unknown): Promise<number> {
    try {
      const delegate = (db as unknown as Record<string, { count: (args?: unknown) => Promise<number> }>)[model];
      if (!delegate) return 0;
      return await delegate.count(where ? { where } : undefined);
    } catch { return 0; }
  }

  async function safeFindMany(model: string, args: unknown): Promise<Record<string, unknown>[]> {
    try {
      const delegate = (db as unknown as Record<string, { findMany: (args: unknown) => Promise<Record<string, unknown>[]> }>)[model];
      if (!delegate) return [];
      return await delegate.findMany(args);
    } catch { return []; }
  }

  const [userCount, bookingCount, cookCount, restaurantCount, deliveryCount, waitlistCount, sessionCount] = await Promise.all([
    safeCount("user"),
    safeCount("booking"),
    safeCount("cook"),
    safeCount("restaurant"),
    safeCount("delivery"),
    safeCount("waitlistEntry"),
    safeCount("session", { revokedAt: null, expiresAt: { gt: new Date() } }),
  ]);

  const waitlistPending = await safeCount("waitlistEntry", { status: "PENDING" });
  const demoAccounts = await safeCount("demoAccount", { active: true });

  // Fetch REAL user-specific data for customer views
  let userOrders: Record<string, unknown>[] = [];
  let userFavorites: Record<string, unknown>[] = [];
  let userPantryItems: Record<string, unknown>[] = [];
  let userFamilyMembers: Record<string, unknown>[] = [];
  let userNotifications: Record<string, unknown>[] = [];
  let userMealPlans: Record<string, unknown>[] = [];

  if (userId && role === "CUSTOMER") {
    // Get the customer record
    const customer = await db.customer.findUnique({ where: { userId } }).catch(() => null);

    if (customer) {
      // Real orders from Booking model
      userOrders = await safeFindMany("booking", {
        where: { customerId: customer.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      });

      // Real favorites
      userFavorites = await safeFindMany("favorite", {
        where: { customerId: customer.id },
        include: { cook: { include: { user: true } } },
        orderBy: { createdAt: "desc" },
      });

      // Real notifications
      userNotifications = await safeFindMany("notificationLog", {
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
    }

    // Real pantry items
    const household = await db.household.findFirst({ where: { name: { contains: userId } } }).catch(() => null);
    if (household) {
      const pantry = await db.pantry.findUnique({ where: { householdId: household.id } }).catch(() => null);
      if (pantry) {
        userPantryItems = await safeFindMany("pantryItem", {
          where: { pantryId: pantry.id, status: { not: "REMOVED" } },
          orderBy: { createdAt: "desc" },
        });
      }

      // Real family members
      userFamilyMembers = await safeFindMany("householdMember", {
        where: { householdId: household.id },
      });

      // Real meal plans
      userMealPlans = await safeFindMany("mealPlan", {
        where: { householdId: household.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
    }
  }

  // Get the view data for this role+view combination
  const data = getViewData(role, view, {
    userCount, bookingCount, cookCount, restaurantCount, deliveryCount,
    waitlistCount, waitlistPending, sessionCount, demoAccounts,
  }, {
    userOrders, userFavorites, userPantryItems, userFamilyMembers, userNotifications, userMealPlans,
  });

  return success(data);
}

interface DBStats {
  userCount: number;
  bookingCount: number;
  cookCount: number;
  restaurantCount: number;
  deliveryCount: number;
  waitlistCount: number;
  waitlistPending: number;
  sessionCount: number;
  demoAccounts: number;
}

interface UserData {
  userOrders: Record<string, unknown>[];
  userFavorites: Record<string, unknown>[];
  userPantryItems: Record<string, unknown>[];
  userFamilyMembers: Record<string, unknown>[];
  userNotifications: Record<string, unknown>[];
  userMealPlans: Record<string, unknown>[];
}

function getViewData(role: string, view: string, stats: DBStats, userData?: UserData) {
  const key = `${role}:${view}`;

  // === CUSTOMER VIEWS ===
  const customerViews: Record<string, ReturnType<typeof makeView>> = {
    "CUSTOMER:home": makeView(
      "Welcome back! 👋", "Here's what's happening with your meals today.",
      [
        { label: "Today's Orders", value: String((userData?.userOrders ?? []).filter((o: Record<string, unknown>) => { const d = o.scheduledFor as Date; return d && d.toDateString() === new Date().toDateString(); }).length), subtext: "Scheduled today", icon: "Calendar", color: "text-blue-600" },
        { label: "Total Orders", value: String(userData?.userOrders.length ?? 0), subtext: "All time", icon: "Package", color: "text-green-600" },
        { label: "Favorite Cooks", value: String(userData?.userFavorites.length ?? 0), subtext: "Saved", icon: "ChefHat", color: "text-orange-600" },
        { label: "Pantry Items", value: String(userData?.userPantryItems.length ?? 0), subtext: "In stock", icon: "Utensils", color: "text-purple-600" },
      ],
      [
        { title: "Today's Meals", description: "Your scheduled meals for today", icon: "Utensils", items: (() => {
          const todayOrders = (userData?.userOrders ?? []).filter((o: Record<string, unknown>) => {
            const d = o.scheduledFor as Date;
            return d && d.toDateString() === new Date().toDateString();
          });
          return todayOrders.length > 0
            ? todayOrders.map((o: Record<string, unknown>) => ({
                title: `Order ${String(o.code ?? "—")} — ${String(o.partySize ?? 0)} portions`,
                subtitle: `${new Date(o.scheduledFor as Date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} · ${String(o.city ?? "")}`,
                badge: String(o.status ?? "PENDING"),
                badgeVariant: o.status === "CONFIRMED" ? "default" : "secondary",
              }))
            : [{ title: "No meals scheduled for today", subtitle: "Browse cooks and book a meal to get started." }];
        })()},
        { title: "Recent Orders", description: "Your latest orders", icon: "Package", items: (() => {
          const recent = (userData?.userOrders ?? []).slice(0, 3);
          return recent.length > 0
            ? recent.map((o: Record<string, unknown>) => ({
                title: `Order ${String(o.code ?? "—")} — ${String(o.partySize ?? 0)} portions`,
                subtitle: `${new Date(o.scheduledFor as Date).toLocaleDateString()} · ₵${String(o.quotedPrice ?? 0)}`,
                badge: String(o.status ?? "PENDING"),
              }))
            : [{ title: "No orders yet", subtitle: "Your recent orders will appear here." }];
        })()},
        { title: "Notifications", icon: "Bell", items: (() => {
          const notifs = userData?.userNotifications ?? [];
          return notifs.length > 0
            ? notifs.slice(0, 3).map((n: Record<string, unknown>) => {
                const payload = JSON.parse(String(n.payload ?? "{}"));
                return { title: String(payload.title ?? "Notification"), subtitle: new Date(n.createdAt as Date).toLocaleDateString() };
              })
            : [{ title: "No notifications", subtitle: "You're all caught up!" }];
        })()},
        { title: "Pantry Summary", icon: "Package", items: (() => {
          const items = userData?.userPantryItems ?? [];
          return items.length > 0
            ? items.slice(0, 3).map((i: Record<string, unknown>) => ({
                title: `${String(i.name ?? "Unknown")} — ${String(i.quantity ?? 0)}${String(i.unit ?? "")}`,
                subtitle: String(i.status ?? "IN_STOCK"),
                badge: String(i.status ?? "IN_STOCK"),
              }))
            : [{ title: "Your pantry is empty", subtitle: "Add items to track what's in your kitchen." }];
        })()},
      ],
    ),
    "CUSTOMER:upcoming": makeView(
      "Upcoming Meals", "Your scheduled meals for the coming days",
      [
        { label: "Upcoming", value: String((userData?.userOrders ?? []).filter((o: Record<string, unknown>) => { const d = o.scheduledFor as Date; return d && d > new Date(); }).length), subtext: "Future orders", icon: "Calendar", color: "text-blue-600" },
        { label: "Confirmed", value: String((userData?.userOrders ?? []).filter((o: Record<string, unknown>) => o.status === "CONFIRMED").length), subtext: "Ready to go", icon: "CheckCircle2", color: "text-green-600" },
      ],
      [
        { title: "Upcoming Orders", icon: "Calendar", items: (() => {
          const upcoming = (userData?.userOrders ?? []).filter((o: Record<string, unknown>) => {
            const d = o.scheduledFor as Date;
            return d && d > new Date();
          });
          return upcoming.length > 0
            ? upcoming.map((o: Record<string, unknown>) => ({
                title: `Order ${String(o.code ?? "—")} — ${String(o.partySize ?? 0)} portions`,
                subtitle: `${new Date(o.scheduledFor as Date).toLocaleString()} · ${String(o.city ?? "")} · ₵${String(o.quotedPrice ?? 0)}`,
                badge: String(o.status ?? "PENDING"),
                badgeVariant: o.status === "CONFIRMED" ? "default" : "outline",
              }))
            : [{ title: "No upcoming meals", subtitle: "Book a meal to see it here." }];
        })()},
      ],
    ),
    "CUSTOMER:recommended": makeView(
      "Recommended for You", "Based on your orders and favorites",
      [
        { label: "Your Orders", value: String(userData?.userOrders.length ?? 0), subtext: "All time", icon: "Package", color: "text-blue-600" },
        { label: "Favorites", value: String(userData?.userFavorites.length ?? 0), subtext: "Saved cooks", icon: "ChefHat", color: "text-orange-600" },
      ],
      [
        { title: "Quick Order", description: "Order a popular meal in one click", icon: "Utensils", items: [
          { title: "Jollof Rice with Chicken", subtitle: "₵25 per portion · Popular in your area", action: "Order" },
          { title: "Banku with Tilapia", subtitle: "₵30 per portion · Ghanaian classic", action: "Order" },
          { title: "Waakye Special", subtitle: "₵20 per portion · Street food favorite", action: "Order" },
        ]},
        { title: "Based on Your Pantry", description: "Meals you can make with what you have", icon: "Package", items: (() => {
          const items = userData?.userPantryItems ?? [];
          return items.length > 0
            ? items.slice(0, 3).map((i: Record<string, unknown>) => ({
                title: `Cook with ${String(i.name ?? "your ingredients")}`,
                subtitle: `You have ${String(i.quantity ?? 0)}${String(i.unit ?? "")} in your pantry`,
                action: "Order",
              }))
            : [{ title: "Add pantry items to get recipe suggestions", subtitle: "We'll recommend meals based on what you have." }];
        })()},
      ],
    ),
    "CUSTOMER:favorite-cooks": makeView(
      "Favorite Cooks", "Your top-rated cooks",
      [
        { label: "Favorites", value: String(userData?.userFavorites.length ?? 0), subtext: "Saved cooks", icon: "ChefHat", color: "text-orange-600" },
        { label: "Avg Rating", value: "4.8", subtext: "Across all favorites", icon: "Star", color: "text-yellow-600" },
      ],
      [
        { title: "Your Favorite Cooks", icon: "ChefHat", items: (userData?.userFavorites.length ?? 0) > 0
          ? userData!.userFavorites.map((f: Record<string, unknown>) => {
              const cook = f.cook as Record<string, unknown> | undefined;
              const cookUser = cook?.user as Record<string, unknown> | undefined;
              return {
                title: String(cookUser?.name ?? "Unknown Cook"),
                subtitle: String(cook?.cuisine ?? "Cook") + " · " + String(cook?.rating ?? "N/A") + "★",
                badge: "FAVORITE",
                action: "Book",
              };
            })
          : [
              { title: "No favorite cooks yet", subtitle: "Browse cooks and add them to your favorites." },
            ]
        },
      ],
    ),
    "CUSTOMER:family": makeView(
      "My Family", "Manage your family members and their preferences",
      [
        { label: "Members", value: String(userData?.userFamilyMembers.length ?? 0), subtext: "In household", icon: "Users", color: "text-blue-600" },
        { label: "Allergies", value: String((userData?.userFamilyMembers ?? []).filter((m: Record<string, unknown>) => { const a = JSON.parse(String(m.allergies ?? "[]")); return Array.isArray(a) && a.length > 0; }).length), subtext: "On file", icon: "AlertCircle", color: "text-orange-600" },
      ],
      [
        { title: "Family Members", icon: "Users", items: (userData?.userFamilyMembers.length ?? 0) > 0
          ? userData!.userFamilyMembers.map((m: Record<string, unknown>) => {
              const allergies = JSON.parse(String(m.allergies ?? "[]"));
              const favFoods = JSON.parse(String(m.favoriteFoods ?? "[]"));
              return {
                title: String(m.role ?? "Member"),
                subtitle: `Role: ${String(m.role ?? "Member")}${allergies.length > 0 ? " · Allergies: " + allergies.join(", ") : ""}${favFoods.length > 0 ? " · Favorites: " + favFoods.join(", ") : ""}`,
                badge: allergies.length > 0 ? "ALLERGY" : "OK",
                badgeVariant: allergies.length > 0 ? "destructive" : "default",
              };
            })
          : [
              { title: "No family members yet", subtitle: "Add family members to manage their dietary preferences." },
            ]
        },
      ],
    ),
    "CUSTOMER:meal-plans": makeView(
      "Meal Plans", "Your weekly and monthly meal plans",
      [
        { label: "Plans", value: String(userData?.userMealPlans.length ?? 0), subtext: "Created", icon: "Calendar", color: "text-blue-600" },
        { label: "Active", value: String((userData?.userMealPlans ?? []).filter((p: Record<string, unknown>) => p.status === "ACTIVE").length), subtext: "In progress", icon: "Calendar", color: "text-green-600" },
      ],
      [
        { title: "Your Meal Plans", icon: "Calendar", items: (() => {
          const plans = userData?.userMealPlans ?? [];
          return plans.length > 0
            ? plans.map((p: Record<string, unknown>) => ({
                title: String(p.name ?? "Unnamed Plan"),
                subtitle: `${String(p.type ?? "WEEKLY")} · ${new Date(p.startDate as Date).toLocaleDateString()} to ${new Date(p.endDate as Date).toLocaleDateString()}`,
                badge: String(p.status ?? "DRAFT"),
                badgeVariant: p.status === "ACTIVE" ? "default" : "outline",
              }))
            : [{ title: "No meal plans yet", subtitle: "Create a meal plan to organize your weekly meals." }];
        })()},
      ],
    ),
    "CUSTOMER:budget": makeView(
      "Budget", "Track your food spending",
      [
        { label: "Total Spent", value: `₵${(userData?.userOrders ?? []).reduce((sum: number, o: Record<string, unknown>) => sum + Number(o.quotedPrice ?? 0), 0)}`, subtext: "On all orders", icon: "Wallet", color: "text-green-600" },
        { label: "Total Orders", value: String(userData?.userOrders.length ?? 0), subtext: "All time", icon: "Package", color: "text-blue-600" },
      ],
      [
        { title: "Spending Summary", icon: "Wallet", items: (() => {
          const orders = userData?.userOrders ?? [];
          if (orders.length === 0) return [{ title: "No spending data yet", subtitle: "Your order spending will appear here." }];
          const total = orders.reduce((sum: number, o: Record<string, unknown>) => sum + Number(o.quotedPrice ?? 0), 0);
          const avg = orders.length > 0 ? Math.round(total / orders.length) : 0;
          return [
            { title: `Total spent: ₵${total}`, subtitle: `Across ${orders.length} orders` },
            { title: `Average per order: ₵${avg}`, subtitle: "Based on your history" },
          ];
        })()},
        { title: "Recent Transactions", icon: "Wallet", items: (() => {
          const orders = (userData?.userOrders ?? []).slice(0, 5);
          return orders.length > 0
            ? orders.map((o: Record<string, unknown>) => ({
                title: `Order ${String(o.code ?? "—")}`,
                subtitle: `${new Date(o.scheduledFor as Date).toLocaleDateString()} · ₵${String(o.quotedPrice ?? 0)}`,
                badge: String(o.status ?? "PENDING"),
              }))
            : [{ title: "No transactions yet", subtitle: "Your order payments will appear here." }];
        })()},
      ],
    ),
    "CUSTOMER:nutrition": makeView(
      "Nutrition", "Track your family's nutritional health",
      [
        { label: "Meals Tracked", value: String(userData?.userOrders.length ?? 0), subtext: "From orders", icon: "Package", color: "text-blue-600" },
        { label: "Family Members", value: String(userData?.userFamilyMembers.length ?? 0), subtext: "In household", icon: "Users", color: "text-green-600" },
      ],
      [
        { title: "Meal History", icon: "TrendingUp", items: (() => {
          const orders = (userData?.userOrders ?? []).slice(0, 5);
          return orders.length > 0
            ? orders.map((o: Record<string, unknown>) => ({
                title: `Meal from ${new Date(o.scheduledFor as Date).toLocaleDateString()}`,
                subtitle: `${String(o.partySize ?? 0)} portions · ₵${String(o.quotedPrice ?? 0)}`,
                badge: String(o.status ?? "PENDING"),
              }))
            : [{ title: "No meals tracked yet", subtitle: "Your meal history will appear here as you order." }];
        })()},
      ],
    ),
    "CUSTOMER:pantry": makeView(
      "My Pantry", "What's in your kitchen",
      [
        { label: "Items", value: String(userData?.userPantryItems.length ?? 0), subtext: "In stock", icon: "Package", color: "text-blue-600" },
        { label: "Expiring", value: String((userData?.userPantryItems ?? []).filter((i: Record<string, unknown>) => i.status === "EXPIRING").length), subtext: "Soon", icon: "AlertCircle", color: "text-orange-600" },
      ],
      [
        { title: "Pantry Items", icon: "Package", items: (userData?.userPantryItems.length ?? 0) > 0
          ? userData!.userPantryItems.map((i: Record<string, unknown>) => ({
              title: `${String(i.name ?? "Unknown")} — ${String(i.quantity ?? 0)}${String(i.unit ?? "")}`,
              subtitle: i.expirationDate ? `Expires: ${new Date(i.expirationDate as Date).toLocaleDateString()}` : "No expiration",
              badge: String(i.status ?? "IN_STOCK"),
              badgeVariant: i.status === "EXPIRING" ? "destructive" : i.status === "LOW" ? "outline" : "default",
            }))
          : [
              { title: "Your pantry is empty", subtitle: "Add ingredients to track what's in your kitchen." },
            ]
        },
      ],
    ),
    "CUSTOMER:shopping": makeView(
      "Shopping Assistance", "Based on your pantry and orders",
      [
        { label: "Pantry Items", value: String(userData?.userPantryItems.length ?? 0), subtext: "In stock", icon: "Package", color: "text-blue-600" },
        { label: "Low Stock", value: String((userData?.userPantryItems ?? []).filter((i: Record<string, unknown>) => i.status === "LOW" || i.status === "DEPLETED").length), subtext: "Need restocking", icon: "AlertCircle", color: "text-orange-600" },
      ],
      [
        { title: "Pantry Status", icon: "Package", items: (() => {
          const items = userData?.userPantryItems ?? [];
          return items.length > 0
            ? items.map((i: Record<string, unknown>) => ({
                title: `${String(i.name ?? "Unknown")} — ${String(i.quantity ?? 0)}${String(i.unit ?? "")}`,
                subtitle: String(i.status ?? "IN_STOCK"),
                badge: String(i.status ?? "IN_STOCK"),
                action: i.status === "LOW" || i.status === "DEPLETED" ? "Add to list" : undefined,
              }))
            : [{ title: "Your pantry is empty", subtitle: "Add items to get shopping suggestions." }];
        })()},
        { title: "Suggested Purchases", description: "Based on your order history", icon: "ShoppingBag", items: (() => {
          const orders = userData?.userOrders ?? [];
          return orders.length > 0
            ? [{ title: `You've ordered ${orders.length} times`, subtitle: "Common ingredients from your orders will appear here as shopping suggestions." }]
            : [{ title: "No suggestions yet", subtitle: "Order meals to get personalized shopping suggestions." }];
        })()},
      ],
    ),
    "CUSTOMER:orders": makeView(
      "Orders", "Your meal order history",
      [
        { label: "Total Orders", value: String(userData?.userOrders.length ?? stats.bookingCount ?? 0), subtext: "All time", icon: "Package", color: "text-blue-600" },
        { label: "This Month", value: String(userData?.userOrders.filter((o: Record<string, unknown>) => { const d = o.createdAt as Date; return d && d > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); }).length ?? 0), subtext: "Recent", icon: "Package", color: "text-orange-600" },
      ],
      [
        { title: "Recent Orders", icon: "Package", items: (userData?.userOrders.length ?? 0) > 0
          ? userData!.userOrders.map((o: Record<string, unknown>) => ({
              title: `Order ${String(o.code ?? "—")} — ${String(o.partySize ?? 0)} portions`,
              subtitle: `${new Date(o.scheduledFor as Date).toLocaleString()} · ${String(o.city ?? "")} · ₵${String(o.quotedPrice ?? 0)}`,
              badge: String(o.status ?? "PENDING"),
              badgeVariant: o.status === "COMPLETED" ? "default" : o.status === "CONFIRMED" ? "default" : "secondary",
            }))
          : [
              { title: "No orders yet", subtitle: "Your orders will appear here once you book a meal." },
            ]
        },
      ],
    ),
    "CUSTOMER:deliveries": makeView(
      "Deliveries", "Track your meal deliveries",
      [
        { label: "In Progress", value: String((userData?.userOrders ?? []).filter((o: Record<string, unknown>) => o.status === "CONFIRMED" || o.status === "EN_ROUTE").length), subtext: "Being prepared", icon: "Truck", color: "text-orange-600" },
        { label: "Completed", value: String((userData?.userOrders ?? []).filter((o: Record<string, unknown>) => o.status === "COMPLETED").length), subtext: "Delivered", icon: "CheckCircle2", color: "text-green-600" },
      ],
      [
        { title: "Active Deliveries", icon: "Truck", items: (() => {
          const active = (userData?.userOrders ?? []).filter((o: Record<string, unknown>) => o.status === "CONFIRMED" || o.status === "EN_ROUTE");
          return active.length > 0
            ? active.map((o: Record<string, unknown>) => ({
                title: `Order ${String(o.code ?? "—")} — ${String(o.partySize ?? 0)} portions`,
                subtitle: `${new Date(o.scheduledFor as Date).toLocaleString()} · ${String(o.city ?? "")}`,
                badge: String(o.status ?? "CONFIRMED"),
                badgeVariant: "secondary",
              }))
            : [{ title: "No active deliveries", subtitle: "Your deliveries will appear here once confirmed." }];
        })()},
        { title: "Completed Deliveries", icon: "History", items: (() => {
          const completed = (userData?.userOrders ?? []).filter((o: Record<string, unknown>) => o.status === "COMPLETED");
          return completed.length > 0
            ? completed.map((o: Record<string, unknown>) => ({
                title: `Order ${String(o.code ?? "—")} — ${String(o.partySize ?? 0)} portions`,
                subtitle: `${new Date(o.scheduledFor as Date).toLocaleDateString()} · ₵${String(o.quotedPrice ?? 0)}`,
                badge: "DELIVERED",
              }))
            : [{ title: "No completed deliveries yet", subtitle: "Your delivered orders will appear here." }];
        })()},
      ],
    ),
    "CUSTOMER:saved-recipes": makeView(
      "Saved Recipes", "Your favorite recipes from cooks",
      [
        { label: "Orders", value: String(userData?.userOrders.length ?? 0), subtext: "Can be reordered", icon: "Package", color: "text-blue-600" },
      ],
      [
        { title: "Your Past Meals", description: "Meals you've ordered before — reorder with one click", icon: "Heart", items: (() => {
          const orders = (userData?.userOrders ?? []).filter((o: Record<string, unknown>) => o.status === "COMPLETED");
          return orders.length > 0
            ? orders.map((o: Record<string, unknown>) => ({
                title: `Order ${String(o.code ?? "—")} — ${String(o.partySize ?? 0)} portions`,
                subtitle: `${new Date(o.scheduledFor as Date).toLocaleDateString()} · ₵${String(o.quotedPrice ?? 0)}`,
                action: "Reorder",
              }))
            : [{ title: "No saved recipes yet", subtitle: "Complete an order to save it for easy reordering." }];
        })()},
      ],
    ),
    "CUSTOMER:community": makeView(
      "Community Cooking", "Join community cooking events",
      [
        { label: "Available", value: "0", subtext: "Events near you", icon: "Users", color: "text-blue-600" },
      ],
      [
        { title: "Community Events", icon: "Users", items: [
          { title: "No community events available yet", subtitle: "Community cooking events will appear here when they're scheduled in your area." },
        ]},
      ],
    ),
    "CUSTOMER:rewards": makeView(
      "Rewards", "Your loyalty points and rewards",
      [
        { label: "Orders", value: String(userData?.userOrders.length ?? 0), subtext: "Earn points per order", icon: "Package", color: "text-blue-600" },
      ],
      [
        { title: "How Rewards Work", icon: "Star", items: [
          { title: "Earn 1 point per ₵1 spent", subtitle: "Points are awarded when your order is completed" },
          { title: "Redeem points for discounts", subtitle: "500 points = ₵10 off, 300 points = free delivery" },
          { title: "Climb the tiers", subtitle: "Bronze → Silver → Gold → Platinum based on total orders" },
        ]},
        { title: "Your Progress", icon: "Award", items: (() => {
          const completed = (userData?.userOrders ?? []).filter((o: Record<string, unknown>) => o.status === "COMPLETED");
          const points = completed.reduce((sum: number, o: Record<string, unknown>) => sum + Number(o.quotedPrice ?? 0), 0);
          return [
            { title: `Points: ${points}`, subtitle: `From ${completed.length} completed orders` },
            { title: `Tier: ${points >= 5000 ? "Gold" : points >= 1000 ? "Silver" : "Bronze"}`, subtitle: `${Math.max(0, 1000 - points)} points to next tier` },
          ];
        })()},
      ],
    ),
    "CUSTOMER:notifications": makeView(
      "Notifications", "Your recent activity",
      [
        { label: "Total", value: String(userData?.userNotifications.length ?? 0), subtext: "All notifications", icon: "Bell", color: "text-blue-600" },
      ],
      [
        { title: "Recent Notifications", icon: "Bell", items: (userData?.userNotifications.length ?? 0) > 0
          ? userData!.userNotifications.map((n: Record<string, unknown>) => {
              const payload = JSON.parse(String(n.payload ?? "{}"));
              return {
                title: String(payload.title ?? n.templateCode ?? "Notification"),
                subtitle: `${String(n.templateCode ?? "")} · ${new Date(n.createdAt as Date).toLocaleString()}`,
                badge: String(n.status ?? "DELIVERED"),
                badgeVariant: "default",
              };
            })
          : [
              { title: "No notifications yet", subtitle: "You'll see notifications here when you have activity." },
            ]
        },
      ],
    ),
    "CUSTOMER:profile": makeView(
      "Profile", "Your account settings",
      [
        { label: "Total Orders", value: String(userData?.userOrders.length ?? 0), subtext: "All time", icon: "Package", color: "text-blue-600" },
        { label: "Favorites", value: String(userData?.userFavorites.length ?? 0), subtext: "Saved cooks", icon: "ChefHat", color: "text-orange-600" },
      ],
      [
        { title: "Account Information", icon: "User", items: [
          { title: "Name: (from your account)", subtitle: "Set when your account was created" },
          { title: "Email: (from your account)", subtitle: "Used for login and notifications", badge: "VERIFIED" },
          { title: "Role: Customer", subtitle: "Your primary role on the platform" },
        ]},
        { title: "Your Activity", icon: "Activity", items: [
          { title: `Orders: ${userData?.userOrders.length ?? 0}`, subtitle: "Total orders placed" },
          { title: `Pantry items: ${userData?.userPantryItems.length ?? 0}`, subtitle: "Items in your pantry" },
          { title: `Family members: ${userData?.userFamilyMembers.length ?? 0}`, subtitle: "In your household" },
          { title: `Notifications: ${userData?.userNotifications.length ?? 0}`, subtitle: "Total received" },
        ]},
      ],
    ),
  };

  // === COOK VIEWS ===
  const cookViews: Record<string, ReturnType<typeof makeView>> = {
    "COOK:home": makeView(
      "Today's Schedule", "Your jobs and earnings",
      [
        { label: "Total Bookings", value: String(stats.bookingCount), subtext: "On platform", icon: "ListChecks", color: "text-blue-600" },
        { label: "Active Cooks", value: String(stats.cookCount), subtext: "Including you", icon: "ChefHat", color: "text-orange-600" },
        { label: "Total Users", value: String(stats.userCount), subtext: "Potential customers", icon: "Users", color: "text-green-600" },
        { label: "Active Sessions", value: String(stats.sessionCount), subtext: "Online now", icon: "Activity", color: "text-purple-600" },
      ],
      [
        { title: "Platform Overview", description: "Your cooking business on Eks-Food", icon: "Activity", items: [
          { title: `${stats.bookingCount} total bookings on the platform`, subtitle: "Some of these may be yours" },
          { title: `${stats.cookCount} active cooks`, subtitle: "You're one of them" },
          { title: `${stats.userCount} registered users`, subtitle: "Potential customers in your area" },
        ]},
        { title: "Getting Started", icon: "FileText", items: [
          { title: "Set your availability", subtitle: "Tell customers when you can cook" },
          { title: "Create your menu", subtitle: "List the meals you can prepare" },
          { title: "Complete your profile", subtitle: "Add certifications and cuisine specialties" },
        ]},
      ],
    ),
    "COOK:earnings": makeView(
      "Earnings", "Your income from cooking",
      [
        { label: "Platform Bookings", value: String(stats.bookingCount), subtext: "Total", icon: "Package", color: "text-blue-600" },
        { label: "Active Cooks", value: String(stats.cookCount), subtext: "Competitors", icon: "ChefHat", color: "text-orange-600" },
      ],
      [
        { title: "Your Earnings", description: "Earnings data will appear here once you start receiving bookings", icon: "Wallet", items: [
          { title: "No earnings data yet", subtitle: "Your earnings will be calculated from completed bookings." },
          { title: "How earnings work", subtitle: "You set your price per meal. Eks-Food takes a platform commission." },
        ]},
      ],
    ),
    "COOK:upcoming": makeView(
      "Upcoming Jobs", "Your scheduled cooking jobs",
      [
        { label: "Platform Bookings", value: String(stats.bookingCount), subtext: "Total", icon: "Calendar", color: "text-blue-600" },
      ],
      [
        { title: "Your Upcoming Jobs", icon: "Calendar", items: [
          { title: "No upcoming jobs yet", subtitle: "When customers book you, their orders will appear here." },
        ]},
      ],
    ),
    "COOK:performance": makeView(
      "Performance", "Your cooking performance metrics",
      [
        { label: "Platform Bookings", value: String(stats.bookingCount), subtext: "Total", icon: "Package", color: "text-blue-600" },
        { label: "Active Cooks", value: String(stats.cookCount), subtext: "On platform", icon: "ChefHat", color: "text-orange-600" },
      ],
      [
        { title: "Your Performance", description: "Performance data will appear here once you have completed bookings", icon: "Star", items: [
          { title: "No performance data yet", subtitle: "Your ratings, on-time rate, and customer reviews will appear here." },
        ]},
      ],
    ),
  };

  // === RESTAURANT VIEWS ===
  const restaurantViews: Record<string, ReturnType<typeof makeView>> = {
    "RESTAURANT_OWNER:home": makeView(
      "Restaurant Dashboard", "Your restaurant operations",
      [
        { label: "Total Bookings", value: String(stats.bookingCount), subtext: "On platform", icon: "ListChecks", color: "text-blue-600" },
        { label: "Restaurants", value: String(stats.restaurantCount), subtext: "On platform", icon: "Store", color: "text-green-600" },
        { label: "Active Cooks", value: String(stats.cookCount), subtext: "Available", icon: "ChefHat", color: "text-orange-600" },
        { label: "Active Sessions", value: String(stats.sessionCount), subtext: "Online now", icon: "Activity", color: "text-purple-600" },
      ],
      [
        { title: "Platform Overview", description: "Your restaurant on Eks-Food", icon: "Store", items: [
          { title: `${stats.bookingCount} total bookings on the platform`, subtitle: "Some may be for your restaurant" },
          { title: `${stats.restaurantCount} restaurants registered`, subtitle: "You're one of them" },
        ]},
        { title: "Getting Started", icon: "FileText", items: [
          { title: "Set up your menu", subtitle: "List your restaurant's dishes and prices" },
          { title: "Manage your kitchen", subtitle: "Track orders and kitchen status" },
          { title: "Add staff", subtitle: "Invite your kitchen team" },
        ]},
      ],
    ),
    "RESTAURANT_OWNER:kitchen-status": makeView(
      "Kitchen Status", "Real-time kitchen operations",
      [
        { label: "Platform Bookings", value: String(stats.bookingCount), subtext: "Total", icon: "Utensils", color: "text-blue-600" },
      ],
      [
        { title: "Kitchen Orders", description: "Your active kitchen orders will appear here", icon: "Utensils", items: [
          { title: "No active kitchen orders", subtitle: "Orders will appear here when customers place them." },
        ]},
      ],
    ),
    "RESTAURANT_OWNER:staff": makeView(
      "Staff", "Manage your restaurant team",
      [
        { label: "Platform Users", value: String(stats.userCount), subtext: "Total", icon: "Users", color: "text-blue-600" },
      ],
      [
        { title: "Your Staff", description: "Add and manage your restaurant staff", icon: "Users", items: [
          { title: "No staff added yet", subtitle: "Invite team members to manage your restaurant." },
        ]},
      ],
    ),
  };

  // === DEVELOPER VIEWS ===
  const developerViews: Record<string, ReturnType<typeof makeView>> = {
    "DEVELOPER:dashboard": makeView(
      "Developer Dashboard", "Build and manage your extensions",
      [
        { label: "Platform Users", value: String(stats.userCount), subtext: "Total", icon: "Users", color: "text-blue-600" },
        { label: "Total Bookings", value: String(stats.bookingCount), subtext: "Via API", icon: "Package", color: "text-green-600" },
        { label: "Active Sessions", value: String(stats.sessionCount), subtext: "API consumers", icon: "Activity", color: "text-orange-600" },
      ],
      [
        { title: "API Overview", description: "Platform API statistics", icon: "Activity", items: [
          { title: `${stats.bookingCount} total bookings`, subtitle: "All created via the platform API" },
          { title: `${stats.userCount} registered users`, subtitle: "Accessible via /api/v1/users" },
          { title: `${stats.demoAccounts} demo accounts`, subtitle: "Available for testing" },
        ]},
        { title: "Getting Started", icon: "Code", items: [
          { title: "Explore the API", subtitle: "Use the API Explorer to test endpoints", action: "Try" },
          { title: "Read the docs", subtitle: "Full API reference available" },
          { title: "Create an API key", subtitle: "Authenticate your applications" },
        ]},
      ],
    ),
    "DEVELOPER:extensions": makeView(
      "Extensions", "Manage your extensions",
      [
        { label: "Platform Extensions", value: String(stats.bookingCount > 0 ? "Available" : "0"), subtext: "On platform", icon: "Puzzle", color: "text-blue-600" },
      ],
      [
        { title: "Your Extensions", description: "Extensions you've built will appear here", icon: "Puzzle", items: [
          { title: "No extensions yet", subtitle: "Create an extension to extend the Eks-Food platform." },
        ]},
      ],
    ),
    "DEVELOPER:api-explorer": makeView(
      "API Explorer", "Explore the Eks-Food API",
      [
        { label: "Total Bookings", value: String(stats.bookingCount), subtext: "Via API", icon: "Globe", color: "text-blue-600" },
        { label: "Platform Users", value: String(stats.userCount), subtext: "Via API", icon: "Users", color: "text-green-600" },
      ],
      [
        { title: "Available Endpoints", icon: "Globe", items: [
          { title: "GET /api/v1/app/view", subtitle: "Get role-specific view data", action: "Try" },
          { title: "GET /api/v1/app/search?q=...", subtitle: "Search the platform", action: "Try" },
          { title: "GET /api/v1/auth/demo-accounts", subtitle: "List demo accounts", action: "Try" },
          { title: "POST /api/v1/auth/demo-login", subtitle: "Login as a demo user", action: "Try" },
          { title: "POST /api/v1/app/orders", subtitle: "Create a new order", action: "Try" },
          { title: "GET /api/v1/app/orders?userId=...", subtitle: "List user's orders", action: "Try" },
          { title: "POST /api/v1/app/pantry", subtitle: "Add pantry item", action: "Try" },
          { title: "POST /api/v1/app/meal-plans", subtitle: "Create meal plan", action: "Try" },
        ]},
      ],
    ),
  };

  // === PLATFORM_ADMIN / SUPER_ADMIN VIEWS ===
  const adminViews: Record<string, ReturnType<typeof makeView>> = {
    "PLATFORM_ADMIN:home": makeView(
      "Platform Health", "Everything running smoothly",
      [
        { label: "Uptime", value: "99.97%", subtext: "Last 30 days", icon: "Gauge", color: "text-green-600" },
        { label: "Active Users", value: String(stats.userCount), subtext: "Total registered", icon: "Users", color: "text-blue-600" },
        { label: "API Calls", value: "2.1M", subtext: "Today", icon: "Activity", color: "text-orange-600" },
        { label: "Open Incidents", value: "0", subtext: "All clear", icon: "CheckCircle2", color: "text-green-600" },
      ],
      [
        { title: "Waitlist Approvals", icon: "Users", description: `${stats.waitlistPending} pending applications`, items: [
          { title: `${stats.waitlistPending} applications pending review`, subtitle: `Out of ${stats.waitlistCount} total`, badge: "REVIEW", badgeVariant: "secondary", action: "Review" },
        ]},
        { title: "System Status", icon: "Server", items: [
          { title: "Database — Neon PostgreSQL", subtitle: "Healthy · 12ms avg latency", badge: "HEALTHY" },
          { title: "API Gateway", subtitle: "Healthy · 45ms p99", badge: "HEALTHY" },
          { title: "AI Platform", subtitle: "Healthy · 3 active agents", badge: "HEALTHY" },
          { title: "Connector Platform", subtitle: "Healthy · 10 connectors", badge: "HEALTHY" },
        ]},
      ],
    ),
    "PLATFORM_ADMIN:waitlist": makeView(
      "Waitlist Approvals", "Review and approve user applications",
      [
        { label: "Pending", value: String(stats.waitlistPending), subtext: "Awaiting review", icon: "Users", color: "text-orange-600" },
        { label: "Total", value: String(stats.waitlistCount), subtext: "All entries", icon: "Users", color: "text-blue-600" },
      ],
      [
        { title: "Pending Applications", icon: "Users", items: stats.waitlistPending > 0 ? [
          { title: "Review pending applications", subtitle: `${stats.waitlistPending} users waiting for approval`, action: "Review" },
        ] : [
          { title: "No pending applications", subtitle: "All caught up!" },
        ]},
        { title: "Statistics", icon: "BarChart3", items: [
          { title: "Total Waitlist Entries", subtitle: String(stats.waitlistCount) },
          { title: "Pending Review", subtitle: String(stats.waitlistPending) },
          { title: "Active Demo Accounts", subtitle: String(stats.demoAccounts) },
          { title: "Active Sessions", subtitle: String(stats.sessionCount) },
        ]},
      ],
    ),
    "PLATFORM_ADMIN:operations": makeView(
      "Operations", "Platform operations center",
      [
        { label: "Health", value: "99.97%", subtext: "Uptime", icon: "Gauge", color: "text-green-600" },
        { label: "Regions", value: "3", subtext: "All healthy", icon: "Globe", color: "text-blue-600" },
      ],
      [
        { title: "Active Deployments", icon: "GitBranch", items: [
          { title: "v1.0.0 — Production", subtitle: "Deployed 2 hours ago · Healthy", badge: "LIVE" },
        ]},
        { title: "Background Jobs", icon: "Activity", items: [
          { title: "Materialization worker", subtitle: "Running · 0 backlog", badge: "HEALTHY" },
          { title: "Notification sender", subtitle: "Running · 0 backlog", badge: "HEALTHY" },
        ]},
      ],
    ),
    "PLATFORM_ADMIN:analytics": makeView(
      "Analytics", "Platform-wide analytics",
      [
        { label: "Total Users", value: String(stats.userCount), subtext: "Registered", icon: "Users", color: "text-blue-600" },
        { label: "Bookings", value: String(stats.bookingCount), subtext: "All time", icon: "Package", color: "text-orange-600" },
        { label: "Cooks", value: String(stats.cookCount), subtext: "Active", icon: "ChefHat", color: "text-green-600" },
        { label: "Restaurants", value: String(stats.restaurantCount), subtext: "Active", icon: "Store", color: "text-purple-600" },
      ],
      [
        { title: "Platform Metrics", icon: "BarChart3", items: [
          { title: "Total Users", subtitle: String(stats.userCount) },
          { title: "Total Bookings", subtitle: String(stats.bookingCount) },
          { title: "Active Cooks", subtitle: String(stats.cookCount) },
          { title: "Active Restaurants", subtitle: String(stats.restaurantCount) },
          { title: "Total Deliveries", subtitle: String(stats.deliveryCount) },
          { title: "Active Sessions", subtitle: String(stats.sessionCount) },
        ]},
      ],
    ),
  };

  // Copy admin views for SUPER_ADMIN
  const superAdminViews: Record<string, ReturnType<typeof makeView>> = {};
  for (const [k, v] of Object.entries(adminViews)) {
    superAdminViews[k.replace("PLATFORM_ADMIN", "SUPER_ADMIN")] = v;
  }

// === RIDER VIEWS ===
const riderViews: Record<string, ReturnType<typeof makeView>> = {
  "RIDER:home": makeView(
    "Go Online", "Start earning with deliveries",
    [
      { label: "Platform Deliveries", value: String(stats.deliveryCount), subtext: "Total", icon: "Truck", color: "text-blue-600" },
      { label: "Platform Users", value: String(stats.userCount), subtext: "Potential customers", icon: "Users", color: "text-green-600" },
    ],
    [
      { title: "Available Deliveries", description: "Delivery requests will appear here when you go online", icon: "Package", items: [
        { title: "No deliveries available right now", subtitle: "Go online to receive delivery requests from nearby restaurants and kitchens." },
      ]},
      { title: "Getting Started", icon: "FileText", items: [
        { title: "Set your availability", subtitle: "Tell the platform when you can deliver" },
        { title: "Add your vehicle", subtitle: "Motorcycle, bicycle, or car" },
        { title: "Set your delivery zones", subtitle: "Areas where you want to pick up deliveries" },
      ]},
    ],
  ),
  "RIDER:earnings": makeView(
    "Earnings", "Your income from deliveries",
    [
      { label: "Platform Deliveries", value: String(stats.deliveryCount), subtext: "Total", icon: "Truck", color: "text-blue-600" },
    ],
    [
      { title: "Your Earnings", description: "Earnings will appear here once you complete deliveries", icon: "Wallet", items: [
        { title: "No earnings data yet", subtitle: "Your delivery earnings will be tracked here." },
      ]},
    ],
  ),
  "RIDER:available": makeView(
    "Available Deliveries", "Pick up and earn",
    [
      { label: "Platform Deliveries", value: String(stats.deliveryCount), subtext: "Total", icon: "Package", color: "text-blue-600" },
    ],
    [
      { title: "Available Deliveries", description: "Delivery requests will appear here when available", icon: "Package", items: [
        { title: "No deliveries available right now", subtitle: "Delivery requests will appear here when you go online." },
      ]},
    ],
  ),
  "RIDER:history": makeView(
    "Delivery History", "Your past deliveries",
    [
      { label: "Platform Deliveries", value: String(stats.deliveryCount), subtext: "Total", icon: "Package", color: "text-blue-600" },
    ],
    [
      { title: "Your Deliveries", description: "Your delivery history will appear here", icon: "History", items: [
        { title: "No deliveries yet", subtitle: "Your completed deliveries will be listed here." },
      ]},
    ],
  ),
  "RIDER:performance": makeView(
    "Performance", "Your delivery metrics",
    [
      { label: "Platform Deliveries", value: String(stats.deliveryCount), subtext: "Total", icon: "Package", color: "text-blue-600" },
    ],
    [
      { title: "Your Performance", description: "Performance data will appear here once you have deliveries", icon: "Star", items: [
        { title: "No performance data yet", subtitle: "Your ratings, on-time rate, and delivery stats will appear here." },
      ]},
    ],
  ),
};

// === SUPPLIER VIEWS ===
const supplierViews: Record<string, ReturnType<typeof makeView>> = {
  "SUPPLIER:home": makeView(
    "Purchase Orders", "Your supply chain",
    [
      { label: "Platform Restaurants", value: String(stats.restaurantCount), subtext: "Potential customers", icon: "Store", color: "text-blue-600" },
      { label: "Platform Bookings", value: String(stats.bookingCount), subtext: "Total orders", icon: "Package", color: "text-green-600" },
    ],
    [
      { title: "Purchase Orders", description: "POs from restaurants will appear here", icon: "Package", items: [
        { title: "No purchase orders yet", subtitle: "When restaurants order from you, their POs will appear here." },
      ]},
      { title: "Getting Started", icon: "FileText", items: [
        { title: "Add your products", subtitle: "List the ingredients and supplies you sell" },
        { title: "Set your delivery areas", subtitle: "Tell restaurants where you can deliver" },
        { title: "Manage your inventory", subtitle: "Track stock levels and get alerts" },
      ]},
    ],
  ),
  "SUPPLIER:inventory": makeView(
    "Inventory", "Your current stock levels",
    [
      { label: "Platform Restaurants", value: String(stats.restaurantCount), subtext: "Potential buyers", icon: "Store", color: "text-blue-600" },
    ],
    [
      { title: "Your Inventory", description: "Your products and stock levels will appear here", icon: "Package", items: [
        { title: "No inventory items yet", subtitle: "Add products to start tracking your inventory." },
      ]},
    ],
  ),
  "SUPPLIER:deliveries": makeView(
    "Upcoming Deliveries", "Your scheduled deliveries",
    [
      { label: "Platform Bookings", value: String(stats.bookingCount), subtext: "Total on platform", icon: "Package", color: "text-blue-600" },
    ],
    [
      { title: "Your Deliveries", description: "Scheduled deliveries will appear here", icon: "Truck", items: [
        { title: "No deliveries scheduled", subtitle: "Your delivery schedule will appear here once you receive orders." },
      ]},
    ],
  ),
  "SUPPLIER:customers": makeView(
    "Customers", "Your restaurant and kitchen clients",
    [
      { label: "Platform Restaurants", value: String(stats.restaurantCount), subtext: "On platform", icon: "Store", color: "text-blue-600" },
    ],
    [
      { title: "Your Customers", description: "Restaurants that order from you will appear here", icon: "Users", items: [
        { title: "No customers yet", subtitle: "Restaurants will appear here when they place orders with you." },
      ]},
    ],
  ),
};

// === FOOD_INSPECTOR VIEWS ===
const inspectorViews: Record<string, ReturnType<typeof makeView>> = {
  "FOOD_INSPECTOR:home": makeView(
    "Today's Inspections", "Keep food safe in your area",
    [
      { label: "Platform Restaurants", value: String(stats.restaurantCount), subtext: "To inspect", icon: "Store", color: "text-blue-600" },
      { label: "Platform Cooks", value: String(stats.cookCount), subtext: "To verify", icon: "ChefHat", color: "text-orange-600" },
    ],
    [
      { title: "Assigned Inspections", description: "Your inspection schedule will appear here", icon: "ShieldCheck", items: [
        { title: "No inspections assigned yet", subtitle: "Your inspection assignments will appear here." },
      ]},
      { title: "Getting Started", icon: "FileText", items: [
        { title: "Set your inspection area", subtitle: "Tell the platform which regions you cover" },
        { title: "Review compliance standards", subtitle: "Familiarize yourself with food safety requirements" },
      ]},
    ],
  ),
  "FOOD_INSPECTOR:compliance": makeView(
    "Compliance", "Compliance tracking across inspected kitchens",
    [
      { label: "Platform Restaurants", value: String(stats.restaurantCount), subtext: "On platform", icon: "Store", color: "text-blue-600" },
    ],
    [
      { title: "Compliance Records", description: "Your inspection results will appear here", icon: "ShieldCheck", items: [
        { title: "No compliance records yet", subtitle: "Your inspection results will be tracked here." },
      ]},
    ],
  ),
  "FOOD_INSPECTOR:violations": makeView(
    "Violations", "Open and resolved violations",
    [
      { label: "Platform Restaurants", value: String(stats.restaurantCount), subtext: "Monitored", icon: "Store", color: "text-blue-600" },
    ],
    [
      { title: "Open Violations", description: "Violations will appear here when found", icon: "AlertTriangle", items: [
        { title: "No open violations", subtitle: "Violations will be listed here when identified during inspections." },
      ]},
    ],
  ),
};

// === ORG_ADMIN VIEWS ===
const orgAdminViews: Record<string, ReturnType<typeof makeView>> = {
  "ORG_ADMIN:home": makeView(
    "Overview", "Manage your organization",
    [
      { label: "Total Users", value: String(stats.userCount), subtext: "Registered", icon: "Users", color: "text-blue-600" },
      { label: "Active Sessions", value: String(stats.sessionCount), subtext: "Currently online", icon: "Activity", color: "text-green-600" },
      { label: "Waitlist", value: String(stats.waitlistPending), subtext: "Pending approval", icon: "User", color: "text-orange-600" },
      { label: "Demo Accounts", value: String(stats.demoAccounts), subtext: "Available", icon: "Users", color: "text-purple-600" },
    ],
    [
      { title: "Platform Statistics", icon: "BarChart3", items: [
        { title: "Total Users", subtitle: String(stats.userCount) },
        { title: "Total Bookings", subtitle: String(stats.bookingCount) },
        { title: "Active Cooks", subtitle: String(stats.cookCount) },
        { title: "Active Restaurants", subtitle: String(stats.restaurantCount) },
        { title: "Total Deliveries", subtitle: String(stats.deliveryCount) },
        { title: "Active Sessions", subtitle: String(stats.sessionCount) },
      ]},
      { title: "Waitlist", icon: "User", items: stats.waitlistPending > 0 ? [
        { title: `${stats.waitlistPending} applications pending review`, subtitle: `Out of ${stats.waitlistCount} total`, action: "Review" },
      ] : [
        { title: "No pending applications", subtitle: "All caught up!" },
      ]},
    ],
  ),
  "ORG_ADMIN:team": makeView(
    "Team", "Manage your team members",
    [
      { label: "Total Users", value: String(stats.userCount), subtext: "All roles", icon: "Users", color: "text-blue-600" },
      { label: "Active", value: String(stats.sessionCount), subtext: "Online now", icon: "Activity", color: "text-green-600" },
    ],
    [
      { title: "Team Members", icon: "Users", items: [
        { title: "View all users", subtitle: `${stats.userCount} registered users`, action: "View" },
      ]},
    ],
  ),
  "ORG_ADMIN:organizations": makeView(
    "Organizations", "Manage organizations on the platform",
    [
      { label: "Organizations", value: "1", subtext: "Active", icon: "Building2", color: "text-blue-600" },
    ],
    [
      { title: "Your Organizations", icon: "Building2", items: [
        { title: "Eks-Food Demo Organization", subtitle: "Ghana · GHS · Active", badge: "ACTIVE" },
      ]},
    ],
  ),
};


  // Merge all view maps
  const allViews = {
    ...customerViews,
    ...cookViews,
    ...restaurantViews,
    ...developerViews,
    ...adminViews,
    ...superAdminViews,
    ...riderViews,
    ...supplierViews,
    ...inspectorViews,
    ...orgAdminViews,
  };

  // Return the specific view, or a default that's honest about the state
  return allViews[key] ?? makeView(
    getRoleLabel(role),
    getRoleSubtitle(role),
    [
      { label: "Role", value: role.replace(/_/g, " "), subtext: "Your account", icon: "User", color: "text-blue-600" },
      { label: "Platform Users", value: String(stats.userCount), subtext: "Registered", icon: "Users", color: "text-green-600" },
    ],
    [
      { title: "This Section", icon: "FileText", items: [
        { title: "This page is part of the " + role.replace(/_/g, " ").toLowerCase() + " workspace", subtitle: "The data shown here will be populated as you use the platform. Some features for this role are still being connected to the backend." },
      ]},
      { title: "Available Actions", icon: "Activity", items: [
        { title: "Log out anytime", subtitle: "Click 'Log out' in the sidebar" },
        { title: "Switch roles", subtitle: "Log out and sign in as a different demo role" },
        { title: "Search the platform", subtitle: "Use the search bar in the header" },
      ]},
    ],
  );
}

function makeView(title: string, subtitle: string, stats: ViewStat[], cards: ViewCard[]) {
  return { title, subtitle, stats, cards };
}

function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    CUSTOMER: "Customer Home", COOK: "Cook Home", RESTAURANT_OWNER: "Restaurant Home",
    RESTAURANT_STAFF: "Staff Home", VENDOR: "Vendor Home", SUPPLIER: "Supplier Home",
    FOOD_INSPECTOR: "Inspector Home", RIDER: "Rider Home", FLEET_MANAGER: "Fleet Home",
    AREA_MANAGER: "Area Manager Home", ORG_ADMIN: "Admin Home", DEVELOPER: "Developer Home",
    MARKETPLACE_PUBLISHER: "Publisher Home", PLATFORM_ADMIN: "Platform Health",
    SUPER_ADMIN: "Platform Health",
  };
  return labels[role] ?? "Dashboard";
}

function getRoleSubtitle(role: string): string {
  const subs: Record<string, string> = {
    CUSTOMER: "Your food, simplified", COOK: "Manage your kitchen and earnings",
    RESTAURANT_OWNER: "Run your restaurant efficiently", RESTAURANT_STAFF: "Your kitchen, organized",
    VENDOR: "Sell more, deliver faster", SUPPLIER: "Supply chain, simplified",
    FOOD_INSPECTOR: "Keep food safe", RIDER: "Deliver and earn", FLEET_MANAGER: "Manage your fleet",
    AREA_MANAGER: "Regional operations", ORG_ADMIN: "Manage your organization",
    DEVELOPER: "Build on Eks-Food", MARKETPLACE_PUBLISHER: "Publish and grow",
    PLATFORM_ADMIN: "Platform health and governance", SUPER_ADMIN: "Full platform access",
  };
  return subs[role] ?? "Welcome to Eks-Food";
}

interface ViewStat { label: string; value: string; subtext: string; icon: string; color: string }
interface ViewItem { title: string; subtitle?: string; badge?: string; badgeVariant?: string; action?: string }
interface ViewCard { title: string; description?: string; icon?: string; items: ViewItem[] }

