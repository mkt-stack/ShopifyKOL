// @ts-check
/**
 * Weekly order limit at checkout.
 *
 * - Guests are blocked until they log in.
 * - A customer with an exempt tag is never limited.
 * - Otherwise the limit is the highest tag override the customer holds, or
 *   the default. Once this week's paid order count (the customer's
 *   `$app:weekly_orders` metafield, kept by the app's orders/paid and
 *   orders/cancelled webhooks) reaches the limit, checkout is blocked until
 *   next Monday.
 *
 * Cart interactions are never blocked, so adding to cart always works. The
 * rule only applies in checkout.
 *
 * Settings come from the validation's `$app:config` metafield (written by
 * app/lib/weekly-limit.server.js syncValidation). The date and message
 * helpers mirror that file, so keep the two in step.
 *
 * @typedef {{ week?: string, count?: number }} WeeklyOrders
 * @typedef {{ tag: string, limit: number }} Override
 * @typedef {{ ok: string, fullTitle: string, full: string, login: string }} Messages
 * @typedef {{
 *   enabled?: boolean, limit?: number, exemptTags?: string[],
 *   overrides?: Override[], messages?: { th?: Messages, en?: Messages }
 * }} Config
 */

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Fallbacks for a config written before a message existed (the app always
// sends the full set).
const FALLBACK = {
  th: {
    full: "คุณสั่งซื้อครบ {{limit}} ออเดอร์สำหรับสัปดาห์นี้แล้ว สามารถสั่งซื้อได้อีกครั้งในวันจันทร์ที่ {{date}}",
    login: "กรุณาเข้าสู่ระบบก่อนทำการสั่งซื้อ",
  },
  en: {
    full: "You've placed {{limit}} orders this week. You can order again on Monday, {{date}}.",
    login: "Please log in to place your order.",
  },
};

/** @param {string} ymd */
function weekStart(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - back * 86400000).toISOString().slice(0, 10);
}

/** @param {string} ymd @param {number} days */
function addDays(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

/** @param {string} ymd @param {"th" | "en"} lang */
function formatDate(ymd, lang) {
  const [y, m, d] = ymd.split("-").map(Number);
  return lang === "th" ? `${d} ${TH_MONTHS[m - 1]} ${y + 543}` : `${d} ${EN_MONTHS[m - 1]} ${y}`;
}

/** @param {string} template @param {Record<string, string | number>} vars */
function render(template, vars) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
    vars[k] === undefined ? "" : String(vars[k]),
  );
}

/**
 * @param {any} input
 * @returns {{ operations: { validationAdd: { errors: { message: string, target: string }[] } }[] }}
 */
export function cartValidationsGenerateRun(input) {
  const errors = [];
  const pass = () => ({ operations: [{ validationAdd: { errors } }] });

  /** @type {Config | undefined} */
  const config = input.validation?.config?.jsonValue;
  if (!config?.enabled) return pass();
  if (input.buyerJourney?.step === "CART_INTERACTION") return pass();

  /** @type {"th" | "en"} */
  const lang = input.localization?.language?.isoCode === "TH" ? "th" : "en";
  const messages = { ...FALLBACK[lang], ...(config.messages?.[lang] || {}) };

  const customer = input.cart?.buyerIdentity?.customer;
  if (!customer) {
    errors.push({ message: messages.login, target: "$.cart" });
    return pass();
  }

  const held = new Set(
    (customer.tags || [])
      .filter((/** @type {{ hasTag: boolean }} */ t) => t.hasTag)
      .map((/** @type {{ tag: string }} */ t) => t.tag.toLowerCase()),
  );
  if ((config.exemptTags || []).some((t) => held.has(t.toLowerCase()))) return pass();

  let limit = Number(config.limit);
  let overridden = false;
  for (const o of config.overrides || []) {
    if (!held.has(o.tag.toLowerCase())) continue;
    if (!overridden || o.limit > limit) limit = Number(o.limit);
    overridden = true;
  }
  if (!Number.isFinite(limit)) return pass();

  const week = weekStart(input.shop.localTime.date);
  /** @type {WeeklyOrders | undefined} */
  const weekly = customer.weekly?.jsonValue;
  const count = weekly && weekly.week === week ? Number(weekly.count) || 0 : 0;

  if (count >= limit) {
    errors.push({
      message: render(messages.full, {
        limit,
        count,
        remaining: 0,
        date: formatDate(addDays(week, 7), lang),
      }),
      target: "$.cart",
    });
  }
  return pass();
}
