// Default checkout text for the weekly order limit. Kept out of the .server
// file so the admin page can show the defaults as placeholders.
export const DEFAULT_MESSAGES = {
  th: {
    ok: "คุณสั่งซื้อได้อีก {{remaining}} จาก {{limit}} ออเดอร์ในสัปดาห์นี้",
    fullTitle: "โควต้าการสั่งซื้อประจำสัปดาห์เต็มแล้ว",
    full: "คุณสั่งซื้อครบ {{limit}} ออเดอร์สำหรับสัปดาห์นี้แล้ว สามารถสั่งซื้อได้อีกครั้งในวันจันทร์ที่ {{date}}",
    login: "กรุณาเข้าสู่ระบบก่อนทำการสั่งซื้อ",
  },
  en: {
    ok: "You can place {{remaining}} more of {{limit}} orders this week.",
    fullTitle: "Weekly order limit reached",
    full: "You've placed {{limit}} orders this week. You can order again on Monday, {{date}}.",
    login: "Please log in to place your order.",
  },
};
export const MESSAGE_KEYS = ["ok", "fullTitle", "full", "login"];
export const LANGUAGES = ["th", "en"];
