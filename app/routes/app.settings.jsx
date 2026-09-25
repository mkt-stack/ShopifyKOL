import { useFetcher, useLoaderData } from "react-router";
import { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";
import { getShopSettings, upsertShopSettings } from "../lib/shop-settings.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  return { settings };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const dailyLimitEnabled = formData.get("dailyLimitEnabled") === "on";
  const tiktokEnabled = formData.get("tiktokEnabled") === "on";
  const shopeeEnabled = formData.get("shopeeEnabled") === "on";
  const rawDailyLimit = formData.get("dailyLimit");
  const updatedBy = String(formData.get("updatedBy") || "").trim();

  const dailyLimit = Number.parseInt(rawDailyLimit, 10);

  if (!updatedBy) {
    return { ok: false, error: "กรุณาระบุชื่อผู้ทำรายการ" };
  }
  if (!Number.isFinite(dailyLimit) || dailyLimit <= 0) {
    return { ok: false, error: "กรุณาระบุจำนวนโควต้ารายวันที่ถูกต้อง (มากกว่า 0)" };
  }
  if (!tiktokEnabled && !shopeeEnabled) {
    return {
      ok: false,
      error: "ต้องเปิดรับลิงก์อย่างน้อย 1 ช่องทาง (TikTok หรือ Shopee)",
    };
  }

  const settings = await upsertShopSettings(session.shop, {
    dailyLimitEnabled,
    dailyLimit,
    tiktokEnabled,
    shopeeEnabled,
    updatedBy,
  });

  return { ok: true, settings };
}

const inputStyle = {
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};

const labelStyle = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 4,
};

const btnStyle = (variant = "default") => ({
  padding: "7px 14px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  border: "1px solid",
  ...(variant === "primary"
    ? { background: "#2563EB", color: "white", borderColor: "#2563EB" }
    : { background: "white", color: "#374151", borderColor: "#D1D5DB" }),
});

function ToggleRow({ title, description, checked, onChange, name }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 0",
        borderBottom: "1px solid #F2F4F7",
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>
          {title}
        </div>
        <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
          {description}
        </div>
      </div>
      <label
        style={{
          position: "relative",
          display: "inline-block",
          width: 40,
          height: 22,
          flexShrink: 0,
        }}
      >
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ opacity: 0, width: 0, height: 0 }}
        />
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 22,
            background: checked ? "#2563EB" : "#D1D5DB",
            transition: "background 0.15s",
            cursor: "pointer",
          }}
          onClick={() => onChange(!checked)}
        />
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "white",
            transition: "left 0.15s",
            pointerEvents: "none",
          }}
        />
      </label>
    </div>
  );
}

export default function SettingsPage() {
  const { settings } = useLoaderData();
  const fetcher = useFetcher();

  const [dailyLimitEnabled, setDailyLimitEnabled] = useState(
    settings.dailyLimitEnabled,
  );
  const [dailyLimit, setDailyLimit] = useState(String(settings.dailyLimit));
  const [tiktokEnabled, setTiktokEnabled] = useState(settings.tiktokEnabled);
  const [shopeeEnabled, setShopeeEnabled] = useState(settings.shopeeEnabled);
  const [updatedBy, setUpdatedBy] = useState("");

  const submitting = fetcher.state !== "idle";
  const result = fetcher.data;

  useEffect(() => {
    if (result?.ok && result.settings) {
      setDailyLimitEnabled(result.settings.dailyLimitEnabled);
      setDailyLimit(String(result.settings.dailyLimit));
      setTiktokEnabled(result.settings.tiktokEnabled);
      setShopeeEnabled(result.settings.shopeeEnabled);
    }
  }, [result]);

  function handleSubmit(e) {
    e.preventDefault();
    fetcher.submit(
      {
        dailyLimitEnabled: dailyLimitEnabled ? "on" : "",
        dailyLimit,
        tiktokEnabled: tiktokEnabled ? "on" : "",
        shopeeEnabled: shopeeEnabled ? "on" : "",
        updatedBy,
      },
      { method: "post" },
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <ui-title-bar title="Settings" />

      <form onSubmit={handleSubmit}>
        <div
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>
            โควต้ารายวันต่อลูกค้า
          </h3>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#6B7280" }}>
            จำกัดจำนวนลิงก์ที่ลูกค้าคนเดียวสามารถส่งได้ต่อวัน
            รวมทุกออเดอร์ของลูกค้าคนนั้น รีเซ็ตทุกเที่ยงคืนเวลาไทย (GMT+7)
          </p>

          <ToggleRow
            name="dailyLimitEnabled"
            title="เปิดใช้งานโควต้ารายวัน"
            description="เมื่อปิด ลูกค้าจะไม่ถูกจำกัดจำนวนลิงก์ต่อวัน (เหมือนเดิม)"
            checked={dailyLimitEnabled}
            onChange={setDailyLimitEnabled}
          />

          <div style={{ marginTop: 14, maxWidth: 240 }}>
            <label style={labelStyle}>จำนวนลิงก์สูงสุดต่อวันต่อลูกค้า</label>
            <input
              type="number"
              name="dailyLimit"
              min={1}
              style={inputStyle}
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              disabled={!dailyLimitEnabled}
              required
            />
          </div>
        </div>

        <div
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 20,
            marginBottom: 16,
          }}
        >
          <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>
            ช่องทางที่รับลิงก์
          </h3>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#6B7280" }}>
            เมื่อปิดช่องทางใด ลูกค้าจะไม่สามารถส่งลิงก์จากช่องทางนั้นได้
          </p>

          <ToggleRow
            name="tiktokEnabled"
            title="TikTok"
            description="tiktok.com, *.tiktok.com, vt.tiktok.com"
            checked={tiktokEnabled}
            onChange={setTiktokEnabled}
          />
          <ToggleRow
            name="shopeeEnabled"
            title="Shopee"
            description="shopee.co.th, *.shopee.co.th, shp.ee, *.shp.ee"
            checked={shopeeEnabled}
            onChange={setShopeeEnabled}
          />
        </div>

        <div
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            borderRadius: 12,
            padding: 20,
            display: "flex",
            gap: 12,
            alignItems: "end",
          }}
        >
          <div style={{ maxWidth: 240, flex: 1 }}>
            <label style={labelStyle}>ผู้ทำรายการ</label>
            <input
              type="text"
              name="updatedBy"
              style={inputStyle}
              placeholder="ชื่อแอดมิน"
              value={updatedBy}
              onChange={(e) => setUpdatedBy(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            style={{
              ...btnStyle("primary"),
              opacity: submitting ? 0.6 : 1,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
            disabled={submitting}
          >
            {submitting ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>

        {result ? (
          <div
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              background: result.ok ? "#F0FDF4" : "#FFF1F2",
              border: `1px solid ${result.ok ? "#86EFAC" : "#FECDD3"}`,
              color: result.ok ? "#166534" : "#9F1239",
            }}
          >
            {result.ok ? "บันทึกการตั้งค่าเรียบร้อยแล้ว" : `เกิดข้อผิดพลาด: ${result.error}`}
          </div>
        ) : null}
      </form>
    </div>
  );
}
