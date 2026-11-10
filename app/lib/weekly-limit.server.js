// Weekly order limit: a customer may place N paid Online Store orders per
// calendar week (Monday to Sunday, shop timezone). Exempt tags skip the
// limit; tag overrides replace N, and the highest override among the
// customer's tags wins.
//
// The checkout Function can't call the app, so the app keeps two things in Shopify:
//   - the validation's `$app:config` metafield: the rule settings (syncValidation)
//   - each customer's `$app:weekly_orders` metafield: { week, count, orders }
//     (recountCustomer, run from the orders/paid + orders/cancelled webhooks)
// The Function (extensions/weekly-order-limit) reads both. Its date and
// message helpers mirror the ones in this file, so keep the two in step.
import db from "../db.server";

export const FUNCTION_HANDLE = "weekly-order-limit";
export const CUSTOMER_METAFIELD_KEY = "weekly_orders";
export const CONFIG_METAFIELD_KEY = "config";

// What counts as a "completed" order: placed in the Online Store (so not
// draft orders, POS or API-created orders), paid, and not cancelled.
const COUNTED_SOURCE = "web";
const PAID_STATUSES = new Set(["PAID", "PARTIALLY_REFUNDED"]);

import { DEFAULT_MESSAGES, LANGUAGES, MESSAGE_KEYS } from "./weekly-limit-messages";

export { DEFAULT_MESSAGES, LANGUAGES, MESSAGE_KEYS };

export const DEFAULT_WEEKLY_LIMIT_SETTINGS = {
  enabled: false,
  defaultLimit: 3,
  exemptTags: [],
  overrides: [],
  messages: {},
  validationId: null,
  lastSyncedAt: null,
  lastSyncError: null,
  updatedBy: null,
};

// ---------------------------------------------------------------- settings

export async function getWeeklyLimitSettings(shop) {
  const row = await db.weeklyOrderLimitSettings.findUnique({ where: { shop } });
  return normalizeSettings(row ? row : { shop, ...DEFAULT_WEEKLY_LIMIT_SETTINGS });
}

export async function saveWeeklyLimitSettings(shop, data) {
  const row = await db.weeklyOrderLimitSettings.upsert({
    where: { shop },
    create: { shop, ...DEFAULT_WEEKLY_LIMIT_SETTINGS, ...data },
    update: data,
  });
  return normalizeSettings(row);
}

function normalizeSettings(row) {
  return {
    ...row,
    exemptTags: cleanTags(row.exemptTags),
    overrides: cleanOverrides(row.overrides),
    messages: row.messages && typeof row.messages === "object" ? row.messages : {},
  };
}

export function cleanTags(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[,\n]/);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const tag = String(raw || "").trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

export function cleanOverrides(value) {
  if (!Array.isArray(value)) return [];
  const byTag = new Map();
  for (const item of value) {
    const tag = String(item?.tag || "").trim();
    const limit = Number.parseInt(item?.limit, 10);
    if (!tag || !Number.isFinite(limit) || limit < 0) continue;
    byTag.set(tag.toLowerCase(), { tag, limit });
  }
  return [...byTag.values()];
}

// Admin-entered text with blank fields falling back to the defaults.
export function resolveMessages(messages) {
  const out = {};
  for (const lang of LANGUAGES) {
    out[lang] = {};
    for (const key of MESSAGE_KEYS) {
      const custom = String(messages?.[lang]?.[key] || "").trim();
      out[lang][key] = custom || DEFAULT_MESSAGES[lang][key];
    }
  }
  return out;
}

// What the Function reads. `tags` is also its input variable, used for
// `customer.hasTags(tags: $tags)` (see the input_variables setting in the
// extension's shopify.extension.toml).
export function buildFunctionConfig(settings) {
  const exemptTags = cleanTags(settings.exemptTags);
  const overrides = cleanOverrides(settings.overrides);
  return {
    enabled: Boolean(settings.enabled),
    limit: settings.defaultLimit,
    tags: cleanTags([...exemptTags, ...overrides.map((o) => o.tag)]),
    exemptTags,
    overrides,
    messages: resolveMessages(settings.messages),
  };
}

// Exempt beats any override; otherwise the highest matching override wins.
export function effectiveLimit(settings, customerTags) {
  const tags = new Set((customerTags || []).map((t) => String(t).trim().toLowerCase()));
  if (cleanTags(settings.exemptTags).some((t) => tags.has(t.toLowerCase()))) {
    return { exempt: true, limit: null, source: "exempt" };
  }
  let best = null;
  for (const o of cleanOverrides(settings.overrides)) {
    if (tags.has(o.tag.toLowerCase()) && (best === null || o.limit > best.limit)) best = o;
  }
  if (best) return { exempt: false, limit: best.limit, source: `tag:${best.tag}` };
  return { exempt: false, limit: settings.defaultLimit, source: "default" };
}

// -------------------------------------------------------------------- dates

const timezoneCache = new Map();

export async function getShopTimezone(admin, shop) {
  if (timezoneCache.has(shop)) return timezoneCache.get(shop);
  const json = await gql(admin, `#graphql
    query ShopTimezone { shop { ianaTimezone } }`);
  const tz = json?.data?.shop?.ianaTimezone || "Asia/Bangkok";
  timezoneCache.set(shop, tz);
  return tz;
}

// "YYYY-MM-DD" of `date` in `timeZone`.
export function localDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(date));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Monday ("YYYY-MM-DD") of the week holding `ymd`.
export function weekStart(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  return new Date(t - back * 86400000).toISOString().slice(0, 10);
}

export function addDays(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Thai: "17 พ.ย. 2569" (Buddhist year). English: "17 Nov 2026".
export function formatDate(ymd, lang) {
  const [y, m, d] = ymd.split("-").map(Number);
  return lang === "th" ? `${d} ${TH_MONTHS[m - 1]} ${y + 543}` : `${d} ${EN_MONTHS[m - 1]} ${y}`;
}

export function renderMessage(template, vars) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
    vars[k] === undefined || vars[k] === null ? "" : String(vars[k]),
  );
}

// ------------------------------------------------------------------- orders

export function orderCounts(order) {
  return (
    order.sourceName === COUNTED_SOURCE &&
    !order.cancelledAt &&
    PAID_STATUSES.has(order.displayFinancialStatus)
  );
}

// Webhook payloads (REST shape) → the GraphQL shape orderCounts reads.
export function orderFromWebhook(payload) {
  return {
    id: payload.admin_graphql_api_id || `gid://shopify/Order/${payload.id}`,
    name: payload.name,
    createdAt: payload.created_at,
    cancelledAt: payload.cancelled_at || null,
    sourceName: payload.source_name,
    displayFinancialStatus: String(payload.financial_status || "").toUpperCase(),
  };
}

// Rebuilds the customer's `$app:weekly_orders` metafield for the current
// week. `knownOrder` is the order from the webhook: it replaces the copy
// the Admin API returns, which can lag a few seconds behind the webhook.
export async function recountCustomer(admin, shop, customerGid, knownOrder = null) {
  const tz = await getShopTimezone(admin, shop);
  const week = weekStart(localDate(new Date(), tz));

  const json = await gql(
    admin,
    `#graphql
    query CustomerRecentOrders($id: ID!) {
      customer(id: $id) {
        id
        orders(first: 50, sortKey: CREATED_AT, reverse: true) {
          nodes { id name createdAt cancelledAt sourceName displayFinancialStatus }
        }
      }
    }`,
    { id: customerGid },
  );
  const customer = json?.data?.customer;
  if (!customer) return null;

  const orders = new Map(customer.orders.nodes.map((o) => [o.id, o]));
  if (knownOrder) orders.set(knownOrder.id, knownOrder);

  const counted = [...orders.values()].filter(
    (o) => orderCounts(o) && weekStart(localDate(o.createdAt, tz)) === week,
  );
  const value = { week, count: counted.length, orders: counted.map((o) => o.name) };
  await setWeeklyOrdersMetafields(admin, [{ customerId: customerGid, value }]);
  return value;
}

async function setWeeklyOrdersMetafields(admin, entries) {
  for (let i = 0; i < entries.length; i += 25) {
    const batch = entries.slice(i, i + 25);
    const json = await gql(
      admin,
      `#graphql
      mutation SetWeeklyOrders($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }`,
      {
        metafields: batch.map(({ customerId, value }) => ({
          ownerId: customerId,
          namespace: "$app",
          key: CUSTOMER_METAFIELD_KEY,
          type: "json",
          value: JSON.stringify(value),
        })),
      },
    );
    const errors = json?.data?.metafieldsSet?.userErrors || [];
    if (errors.length) throw new Error(`metafieldsSet: ${JSON.stringify(errors)}`);
  }
}

// Counts this week's orders for every customer who ordered this week, for
// switching the rule on mid-week. Customers with only uncounted orders
// (cancelled, unpaid, other channels) are written as 0.
export async function backfillCurrentWeek(admin, shop) {
  const tz = await getShopTimezone(admin, shop);
  const week = weekStart(localDate(new Date(), tz));
  // A day early in UTC so no order near midnight is missed; the exact week
  // is checked per order below.
  const since = addDays(week, -1);

  const byCustomer = new Map();
  let after = null;
  let scanned = 0;
  do {
    const json = await gql(
      admin,
      `#graphql
      query WeekOrders($query: String!, $after: String) {
        orders(first: 100, after: $after, query: $query, sortKey: CREATED_AT) {
          nodes {
            id name createdAt cancelledAt sourceName displayFinancialStatus
            customer { id }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { query: `created_at:>=${since}`, after },
    );
    const page = json?.data?.orders;
    if (!page) break;
    for (const o of page.nodes) {
      scanned += 1;
      if (!o.customer?.id || weekStart(localDate(o.createdAt, tz)) !== week) continue;
      const entry = byCustomer.get(o.customer.id) || { week, count: 0, orders: [] };
      if (orderCounts(o)) {
        entry.count += 1;
        entry.orders.push(o.name);
      }
      byCustomer.set(o.customer.id, entry);
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  await setWeeklyOrdersMetafields(
    admin,
    [...byCustomer].map(([customerId, value]) => ({ customerId, value })),
  );
  return {
    week,
    ordersScanned: scanned,
    customers: byCustomer.size,
    customersWithCountedOrders: [...byCustomer.values()].filter((v) => v.count > 0).length,
  };
}

// --------------------------------------------------------------- status

// The same decision the Function makes, for the checkout widget and the
// admin lookup. Reads the stored count (not a live recount) so the widget
// and the Function always agree.
export async function getCustomerStatus(admin, shop, customerGid, settings) {
  const tz = await getShopTimezone(admin, shop);
  const week = weekStart(localDate(new Date(), tz));
  const nextWeek = addDays(week, 7);

  const json = await gql(
    admin,
    `#graphql
    query CustomerWeeklyStatus($id: ID!) {
      customer(id: $id) {
        id
        email
        displayName
        tags
        weekly: metafield(namespace: "$app", key: "${CUSTOMER_METAFIELD_KEY}") { jsonValue }
      }
    }`,
    { id: customerGid },
  );
  const customer = json?.data?.customer;
  if (!customer) return null;

  const stored = customer.weekly?.jsonValue;
  const count = stored && stored.week === week ? Number(stored.count) || 0 : 0;
  const orders = stored && stored.week === week ? stored.orders || [] : [];
  const rule = effectiveLimit(settings, customer.tags);

  const base = {
    customer: { id: customer.id, email: customer.email, name: customer.displayName, tags: customer.tags },
    week,
    nextWeek,
    count,
    orders,
    limitSource: rule.source,
  };
  if (rule.exempt) return { ...base, state: "exempt", limit: null, remaining: null };
  const remaining = Math.max(rule.limit - count, 0);
  return { ...base, state: remaining > 0 ? "ok" : "full", limit: rule.limit, remaining };
}

// ------------------------------------------------------------- validation

// Creates the checkout rule the first time, then keeps its config metafield
// and on/off state in step with the admin page.
export async function syncValidation(admin, settings) {
  const config = buildFunctionConfig(settings);
  const metafields = [
    { namespace: "$app", key: CONFIG_METAFIELD_KEY, type: "json", value: JSON.stringify(config) },
  ];

  const existing = await findValidation(admin);
  if (existing) {
    const json = await gql(
      admin,
      `#graphql
      mutation UpdateWeeklyLimitValidation($id: ID!, $validation: ValidationUpdateInput!) {
        validationUpdate(id: $id, validation: $validation) {
          validation { id enabled }
          userErrors { field message }
        }
      }`,
      { id: existing.id, validation: { enable: config.enabled, blockOnFailure: false, metafields } },
    );
    const errors = json?.data?.validationUpdate?.userErrors || [];
    if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
    return json.data.validationUpdate.validation;
  }

  const json = await gql(
    admin,
    `#graphql
    mutation CreateWeeklyLimitValidation($validation: ValidationCreateInput!) {
      validationCreate(validation: $validation) {
        validation { id enabled }
        userErrors { field message }
      }
    }`,
    {
      validation: {
        functionHandle: FUNCTION_HANDLE,
        title: "Weekly order limit",
        enable: config.enabled,
        blockOnFailure: false,
        metafields,
      },
    },
  );
  const errors = json?.data?.validationCreate?.userErrors || [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  return json.data.validationCreate.validation;
}

export async function findValidation(admin) {
  const json = await gql(
    admin,
    `#graphql
    query WeeklyLimitValidations {
      validations(first: 50) {
        nodes { id enabled title shopifyFunction { handle } }
      }
    }`,
  );
  return (
    (json?.data?.validations?.nodes || []).find(
      (v) => v.shopifyFunction?.handle === FUNCTION_HANDLE,
    ) || null
  );
}

// ------------------------------------------------------------------ util

async function gql(admin, query, variables) {
  const resp = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await resp.json();
  if (json.errors?.length) {
    throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  }
  return json;
}
