import { useFetcher, useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";
import { DEFAULT_MESSAGES, LANGUAGES, MESSAGE_KEYS } from "../lib/weekly-limit-messages";
import {
  backfillCurrentWeek,
  cleanOverrides,
  cleanTags,
  findValidation,
  getCustomerStatus,
  getWeeklyLimitSettings,
  saveWeeklyLimitSettings,
  syncValidation,
} from "../lib/weekly-limit.server";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getWeeklyLimitSettings(session.shop);
  let validation = null;
  let validationError = null;
  try {
    validation = await findValidation(admin);
  } catch (error) {
    validationError = String(error.message || error);
  }
  return { settings, validation, validationError, defaults: DEFAULT_MESSAGES };
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "backfill") {
    try {
      return { intent, ok: true, backfill: await backfillCurrentWeek(admin, shop) };
    } catch (error) {
      return { intent, ok: false, error: String(error.message || error) };
    }
  }

  if (intent === "lookup") {
    const email = String(formData.get("email") || "").trim();
    if (!email) return { intent, ok: false, error: "กรุณาระบุอีเมลลูกค้า" };
    try {
      const resp = await admin.graphql(
        `#graphql
        query FindCustomer($query: String!) {
          customers(first: 1, query: $query) { nodes { id } }
        }`,
        { variables: { query: `email:${email}` } },
      );
      const json = await resp.json();
      const id = json?.data?.customers?.nodes?.[0]?.id;
      if (!id) return { intent, ok: false, error: "ไม่พบลูกค้าที่ใช้อีเมลนี้" };
      const settings = await getWeeklyLimitSettings(shop);
      return { intent, ok: true, status: await getCustomerStatus(admin, shop, id, settings) };
    } catch (error) {
      return { intent, ok: false, error: String(error.message || error) };
    }
  }

  // intent === "save"
  const updatedBy = String(formData.get("updatedBy") || "").trim();
  const defaultLimit = Number.parseInt(formData.get("defaultLimit"), 10);
  if (!updatedBy) return { intent, ok: false, error: "กรุณาระบุชื่อผู้ทำรายการ" };
  if (!Number.isFinite(defaultLimit) || defaultLimit < 1) {
    return { intent, ok: false, error: "จำนวนออเดอร์ต่อสัปดาห์ต้องมากกว่า 0" };
  }

  let overrides;
  let messages;
  try {
    overrides = JSON.parse(String(formData.get("overrides") || "[]"));
    messages = JSON.parse(String(formData.get("messages") || "{}"));
  } catch {
    return { intent, ok: false, error: "ข้อมูลไม่ถูกต้อง กรุณาลองใหม่" };
  }
  const badOverride = (Array.isArray(overrides) ? overrides : []).find(
    (o) => String(o.tag || "").trim() && !(Number.parseInt(o.limit, 10) >= 0),
  );
  if (badOverride) {
    return { intent, ok: false, error: `กรุณาระบุโควต้าของแท็ก "${badOverride.tag}" (0 ขึ้นไป)` };
  }

  let settings = await saveWeeklyLimitSettings(shop, {
    enabled: formData.get("enabled") === "on",
    defaultLimit,
    exemptTags: cleanTags(String(formData.get("exemptTags") || "")),
    overrides: cleanOverrides(overrides),
    messages,
    updatedBy,
  });

  // Copy the settings to the checkout rule. The saved settings are kept
  // even if this fails (e.g. the Function isn't deployed yet); saving again
  // retries.
  try {
    const validation = await syncValidation(admin, settings);
    settings = await saveWeeklyLimitSettings(shop, {
      validationId: validation.id,
      lastSyncedAt: new Date(),
      lastSyncError: null,
    });
    return { intent, ok: true, settings, validation };
  } catch (error) {
    const message = String(error.message || error);
    settings = await saveWeeklyLimitSettings(shop, { lastSyncError: message });
    return {
      intent,
      ok: false,
      settings,
      error: `บันทึกการตั้งค่าแล้ว แต่ส่งไปยัง Checkout ไม่สำเร็จ: ${message}`,
    };
  }
}

// ------------------------------------------------------------------- UI

const card = {
  background: "white",
  border: "1px solid #E5E7EB",
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};

const inputStyle = {
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const labelStyle = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 4,
};

const hint = { margin: "0 0 12px", fontSize: 13, color: "#6B7280" };

const btnStyle = (variant = "default", disabled = false) => ({
  padding: "7px 14px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.6 : 1,
  border: "1px solid",
  ...(variant === "primary"
    ? { background: "#2563EB", color: "white", borderColor: "#2563EB" }
    : variant === "danger"
      ? { background: "white", color: "#B42318", borderColor: "#FECACA" }
      : { background: "white", color: "#374151", borderColor: "#D1D5DB" }),
});

const MESSAGE_LABELS = {
  ok: "ข้อความเมื่อยังสั่งได้ (วิดเจ็ต)",
  fullTitle: "หัวข้อเมื่อโควต้าเต็ม (วิดเจ็ต)",
  full: "ข้อความเมื่อโควต้าเต็ม (วิดเจ็ต + ข้อความบล็อกการสั่งซื้อ)",
  login: "ข้อความให้เข้าสู่ระบบ (วิดเจ็ต + ข้อความบล็อกการสั่งซื้อ)",
};
const LANGUAGE_LABELS = { th: "ภาษาไทย", en: "English" };

function Notice({ ok, children }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: "10px 14px",
        borderRadius: 8,
        fontSize: 13,
        background: ok ? "#F0FDF4" : "#FFF1F2",
        border: `1px solid ${ok ? "#86EFAC" : "#FECDD3"}`,
        color: ok ? "#166534" : "#9F1239",
      }}
    >
      {children}
    </div>
  );
}

function formatBangkok(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

const STATE_LABELS = {
  ok: "ยังสั่งซื้อได้",
  full: "โควต้าเต็ม",
  exempt: "ได้รับการยกเว้น (ไม่จำกัด)",
};

export default function WeeklyOrderLimitPage() {
  const { settings: initial, validation: initialValidation, validationError, defaults } =
    useLoaderData();
  const saver = useFetcher();
  const tools = useFetcher();

  const [settings, setSettings] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [defaultLimit, setDefaultLimit] = useState(String(initial.defaultLimit));
  const [exemptTags, setExemptTags] = useState(initial.exemptTags.join(", "));
  const [overrides, setOverrides] = useState(
    initial.overrides.map((o) => ({ tag: o.tag, limit: String(o.limit) })),
  );
  const [messages, setMessages] = useState(() => {
    const m = {};
    for (const lang of LANGUAGES) {
      m[lang] = {};
      for (const key of MESSAGE_KEYS) m[lang][key] = initial.messages?.[lang]?.[key] || "";
    }
    return m;
  });
  const [updatedBy, setUpdatedBy] = useState("");
  const [email, setEmail] = useState("");

  const saving = saver.state !== "idle";
  const saveResult = saver.data;
  const toolResult = tools.data;
  const toolBusy = tools.state !== "idle";
  const validation = saveResult?.validation || initialValidation;

  useEffect(() => {
    if (saveResult?.settings) setSettings(saveResult.settings);
  }, [saveResult]);

  function setMessage(lang, key, value) {
    setMessages((m) => ({ ...m, [lang]: { ...m[lang], [key]: value } }));
  }

  function save(e) {
    e.preventDefault();
    saver.submit(
      {
        intent: "save",
        enabled: enabled ? "on" : "",
        defaultLimit,
        exemptTags,
        overrides: JSON.stringify(overrides.filter((o) => o.tag.trim())),
        messages: JSON.stringify(messages),
        updatedBy,
      },
      { method: "post" },
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <ui-title-bar title="Weekly Order Limit" />

      <form onSubmit={save}>
        {/* Rule */}
        <div style={card}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>จำกัดจำนวนออเดอร์ต่อสัปดาห์</h3>
          <p style={hint}>
            นับเฉพาะออเดอร์จากหน้าร้านออนไลน์ (Online Store) ที่ชำระเงินแล้วและไม่ถูกยกเลิก
            ไม่นับ Draft order และออเดอร์ที่สร้างผ่าน API · สัปดาห์เริ่มวันจันทร์ รีเซ็ตทุกวันจันทร์
            00:00 ตามเวลาของร้าน · ลูกค้าต้องเข้าสู่ระบบก่อนสั่งซื้อทุกครั้ง
          </p>

          <label
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              padding: "12px 0",
              borderBottom: "1px solid #F2F4F7",
              cursor: "pointer",
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>
                เปิดใช้งานการจำกัดออเดอร์
              </div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                เมื่อเปิด ลูกค้าที่สั่งครบโควต้าแล้วจะไม่สามารถชำระเงินได้จนถึงวันจันทร์ถัดไป
                และลูกค้าที่ไม่ได้เข้าสู่ระบบจะสั่งซื้อไม่ได้
              </div>
            </div>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: 18, height: 18, flexShrink: 0, marginTop: 3 }}
            />
          </label>

          <div style={{ marginTop: 14, maxWidth: 240 }}>
            <label style={labelStyle}>จำนวนออเดอร์สูงสุดต่อสัปดาห์ (ค่าเริ่มต้น)</label>
            <input
              type="number"
              min={1}
              style={inputStyle}
              value={defaultLimit}
              onChange={(e) => setDefaultLimit(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Tags */}
        <div style={card}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>แท็กที่ได้รับการยกเว้น</h3>
          <p style={hint}>
            ลูกค้าที่มีแท็กใดแท็กหนึ่งนี้จะไม่ถูกจำกัดจำนวนออเดอร์ (มีผลเหนือโควต้าตามแท็กด้านล่าง)
            คั่นด้วย , หรือขึ้นบรรทัดใหม่
          </p>
          <textarea
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
            placeholder="STAFF, TEST"
            value={exemptTags}
            onChange={(e) => setExemptTags(e.target.value)}
          />

          <h3 style={{ margin: "20px 0 4px", fontSize: 15 }}>โควต้าตามแท็ก</h3>
          <p style={hint}>
            ลูกค้าที่มีแท็กเหล่านี้จะได้โควต้าตามที่กำหนดแทนค่าเริ่มต้น
            ถ้ามีหลายแท็ก จะใช้โควต้าที่สูงที่สุด
          </p>
          {overrides.map((o, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}
            >
              <input
                style={{ ...inputStyle, flex: 2 }}
                placeholder="แท็ก เช่น VIP"
                value={o.tag}
                onChange={(e) =>
                  setOverrides((list) =>
                    list.map((x, j) => (j === i ? { ...x, tag: e.target.value } : x)),
                  )
                }
              />
              <input
                type="number"
                min={0}
                style={{ ...inputStyle, flex: 1 }}
                placeholder="ออเดอร์/สัปดาห์"
                value={o.limit}
                onChange={(e) =>
                  setOverrides((list) =>
                    list.map((x, j) => (j === i ? { ...x, limit: e.target.value } : x)),
                  )
                }
              />
              <button
                type="button"
                style={btnStyle("danger")}
                onClick={() => setOverrides((list) => list.filter((_, j) => j !== i))}
              >
                ลบ
              </button>
            </div>
          ))}
          <button
            type="button"
            style={btnStyle()}
            onClick={() => setOverrides((list) => [...list, { tag: "", limit: "" }])}
          >
            + เพิ่มโควต้าตามแท็ก
          </button>
        </div>

        {/* Messages */}
        <div style={card}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>ข้อความที่แสดงในหน้า Checkout</h3>
          <p style={hint}>
            เว้นว่างไว้เพื่อใช้ข้อความเริ่มต้น · ใช้ตัวแปรได้: {"{{remaining}}"} จำนวนที่เหลือ,{" "}
            {"{{limit}}"} โควต้า, {"{{count}}"} จำนวนที่สั่งแล้ว, {"{{date}}"} วันจันทร์ถัดไป
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            {LANGUAGES.map((lang) => (
              <div key={lang}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                  {LANGUAGE_LABELS[lang]}
                </div>
                {MESSAGE_KEYS.map((key) => (
                  <div key={key} style={{ marginBottom: 10 }}>
                    <label style={labelStyle}>{MESSAGE_LABELS[key]}</label>
                    <textarea
                      rows={2}
                      style={{ ...inputStyle, resize: "vertical" }}
                      placeholder={defaults[lang][key]}
                      value={messages[lang][key]}
                      onChange={(e) => setMessage(lang, key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Save */}
        <div style={{ ...card, display: "flex", gap: 12, alignItems: "end" }}>
          <div style={{ maxWidth: 240, flex: 1 }}>
            <label style={labelStyle}>ผู้ทำรายการ</label>
            <input
              type="text"
              style={inputStyle}
              placeholder="ชื่อแอดมิน"
              value={updatedBy}
              onChange={(e) => setUpdatedBy(e.target.value)}
              required
            />
          </div>
          <button type="submit" style={btnStyle("primary", saving)} disabled={saving}>
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
        {saveResult ? (
          <Notice ok={saveResult.ok}>
            {saveResult.ok
              ? "บันทึกการตั้งค่าและอัปเดตกฎใน Checkout เรียบร้อยแล้ว"
              : `เกิดข้อผิดพลาด: ${saveResult.error}`}
          </Notice>
        ) : null}
      </form>

      {/* Status */}
      <div style={{ ...card, marginTop: 16 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>สถานะกฎใน Checkout</h3>
        <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.8 }}>
          <div>
            กฎ Checkout:{" "}
            {validation ? (
              <b style={{ color: validation.enabled ? "#027A48" : "#B42318" }}>
                {validation.enabled ? "เปิดใช้งานอยู่" : "ปิดอยู่"}
              </b>
            ) : (
              <b style={{ color: "#B42318" }}>ยังไม่ได้สร้าง (กดบันทึกเพื่อสร้าง)</b>
            )}
          </div>
          <div>ส่งการตั้งค่าล่าสุด: {formatBangkok(settings.lastSyncedAt)}</div>
          <div>แก้ไขล่าสุดโดย: {settings.updatedBy || "-"}</div>
          {settings.lastSyncError ? (
            <div style={{ color: "#B42318" }}>ข้อผิดพลาดล่าสุด: {settings.lastSyncError}</div>
          ) : null}
          {validationError ? (
            <div style={{ color: "#B42318" }}>อ่านสถานะกฎไม่สำเร็จ: {validationError}</div>
          ) : null}
        </div>
        <p style={{ ...hint, marginTop: 8, marginBottom: 0 }}>
          วิดเจ็ตแสดงโควต้า: ไปที่ Settings → Checkout → Customize แล้วเพิ่มบล็อก “Weekly order
          limit” ในตำแหน่งที่ต้องการ (เช่น ด้านบนช่องอีเมลในขั้นตอนแรก)
        </p>
      </div>

      {/* Tools */}
      <div style={card}>
        <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>เครื่องมือ</h3>
        <p style={hint}>
          นับออเดอร์ย้อนหลังของสัปดาห์นี้ใหม่ทั้งหมด (ใช้ตอนเปิดใช้งานครั้งแรก
          หรือถ้าจำนวนดูไม่ถูกต้อง) ปกติระบบจะนับให้อัตโนมัติเมื่อมีการชำระเงินหรือยกเลิกออเดอร์
        </p>
        <button
          type="button"
          style={btnStyle("default", toolBusy)}
          disabled={toolBusy}
          onClick={() => tools.submit({ intent: "backfill" }, { method: "post" })}
        >
          {toolBusy && tools.formData?.get("intent") === "backfill"
            ? "กำลังนับ..."
            : "นับออเดอร์สัปดาห์นี้ใหม่"}
        </button>

        <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "end", maxWidth: 480 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>ตรวจสอบโควต้าของลูกค้า (อีเมล)</label>
            <input
              type="email"
              style={inputStyle}
              placeholder="customer@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button
            type="button"
            style={btnStyle("default", toolBusy)}
            disabled={toolBusy}
            onClick={() => tools.submit({ intent: "lookup", email }, { method: "post" })}
          >
            ตรวจสอบ
          </button>
        </div>

        {toolResult ? (
          <Notice ok={toolResult.ok}>
            {!toolResult.ok ? `เกิดข้อผิดพลาด: ${toolResult.error}` : null}
            {toolResult.backfill ? (
              <span>
                นับใหม่เรียบร้อย (สัปดาห์เริ่ม {toolResult.backfill.week}): ตรวจ{" "}
                {toolResult.backfill.ordersScanned} ออเดอร์ อัปเดตลูกค้า{" "}
                {toolResult.backfill.customers} คน (มีออเดอร์ที่นับ{" "}
                {toolResult.backfill.customersWithCountedOrders} คน)
              </span>
            ) : null}
            {toolResult.status ? (
              <div style={{ lineHeight: 1.8 }}>
                <div>
                  <b>{toolResult.status.customer.name}</b> ({toolResult.status.customer.email})
                </div>
                <div>
                  แท็ก: {toolResult.status.customer.tags.join(", ") || "-"}
                </div>
                <div>
                  สถานะ: <b>{STATE_LABELS[toolResult.status.state]}</b> · สั่งแล้วสัปดาห์นี้{" "}
                  {toolResult.status.count}
                  {toolResult.status.limit !== null
                    ? ` / ${toolResult.status.limit} ออเดอร์ (${
                        toolResult.status.limitSource === "default"
                          ? "ค่าเริ่มต้น"
                          : `แท็ก ${toolResult.status.limitSource.replace("tag:", "")}`
                      })`
                    : ""}
                </div>
                <div>ออเดอร์ที่นับ: {toolResult.status.orders.join(", ") || "-"}</div>
                <div>สัปดาห์นี้เริ่ม {toolResult.status.week} · รีเซ็ต {toolResult.status.nextWeek}</div>
              </div>
            ) : null}
          </Notice>
        ) : null}
      </div>
    </div>
  );
}
