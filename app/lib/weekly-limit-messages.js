// Default checkout text for the weekly order limit. Kept out of the .server
// file so the admin page can show the defaults as placeholders.
//
// Widget layout (extensions/weekly-order-limit-widget):
//   ok:    [title]                 [left]
//          ● ● ○  (one slot per order in the limit)
//          [ok]  or  [last] when one order is left
//   full:  red banner [fullTitle], slots, [full]
//   guest: warning banner [loginTitle], [login]
// `full` and `login` are also the validation Function's blocking messages.
export const DEFAULT_MESSAGES = {
  th: {
    title: "สิทธิ์สั่งซื้อสัปดาห์นี้",
    left: "เหลือ {{remaining}} จาก {{limit}}",
    ok: "รีเซ็ตโควต้าวันจันทร์ที่ {{date}}",
    last: "ออเดอร์นี้เป็นออเดอร์สุดท้ายของสัปดาห์",
    fullTitle: "โควต้าการสั่งซื้อประจำสัปดาห์เต็มแล้ว",
    full: "คุณสั่งซื้อครบ {{limit}} ออเดอร์สำหรับสัปดาห์นี้แล้ว สามารถสั่งซื้อได้อีกครั้งในวันจันทร์ที่ {{date}}",
    loginTitle: "กรุณาเข้าสู่ระบบ",
    login: "กรุณาเข้าสู่ระบบก่อนทำการสั่งซื้อ",
  },
  en: {
    title: "Your orders this week",
    left: "{{remaining}} of {{limit}} left",
    ok: "Resets Monday, {{date}}",
    last: "This is your last order for this week",
    fullTitle: "Weekly order limit reached",
    full: "You've placed {{limit}} orders this week. You can order again on Monday, {{date}}.",
    loginTitle: "Please log in",
    login: "Please log in to place your order.",
  },
};
export const MESSAGE_KEYS = ["title", "left", "ok", "last", "fullTitle", "full", "loginTitle", "login"];
export const LANGUAGES = ["th", "en"];
