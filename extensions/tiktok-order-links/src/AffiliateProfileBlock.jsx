import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const APP_URL = 'https://shopifykol-production.up.railway.app';
const FALLBACK_SHOP = 'gqsizecrm.myshopify.com';

const HANDLE_LABELS = {
  tiktok: 'TikTok',
  shopee: 'Shopee',
  lazada: 'Lazada',
  affiliate_plus: 'Affiliate+',
};

function getShopDomain() {
  try {
    const shopValue = globalThis.shopify?.shop?.value;

    const detected =
      shopValue?.myshopifyDomain ||
      shopValue?.domain ||
      shopValue?.storeDomain ||
      '';

    if (detected && detected.endsWith('.myshopify.com')) {
      return detected;
    }

    const hostname = globalThis.location?.hostname || '';
    if (hostname && hostname.endsWith('.myshopify.com')) {
      return hostname;
    }

    return FALLBACK_SHOP;
  } catch {
    return FALLBACK_SHOP;
  }
}

function formatBangkokDate(dateValue) {
  if (!dateValue) return '-';
  try {
    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(dateValue));
  } catch {
    return String(dateValue);
  }
}

export default async () => {
  render(<AffiliateProfileBlock />, document.body);
};

function AffiliateProfileBlock() {
  const [profile, setProfile] = useState(/** @type {any} */ (null));
  const [statusText, setStatusText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [gender, setGender] = useState('');
  const [dob, setDob] = useState('');

  const [handleType, setHandleType] = useState('tiktok');
  const [handleValue, setHandleValue] = useState('');

  const customer = globalThis.shopify?.customer?.value;
  const customerId = customer?.id || '';
  const customerEmail = customer?.emailAddress || customer?.email || '';
  const shop = getShopDomain();

  function applyProfile(data) {
    setProfile(data);
    setGender(data?.identity?.gender || '');
    setDob(data?.identity?.dob || '');
  }

  useEffect(() => {
    async function loadProfile() {
      if ((!customerId && !customerEmail) || !shop) {
        setLoading(false);
        return;
      }

      try {
        const params = new URLSearchParams({shop});
        if (customerId) params.set('customerId', customerId);
        else params.set('customerEmail', customerEmail);

        const response = await fetch(`${APP_URL}/api/affiliate-profile?${params}`, {
          method: 'GET',
          headers: {Accept: 'application/json'},
        });
        const result = await response.json();

        if (result?.ok) {
          applyProfile(result);
        } else {
          setStatusText(result?.error || 'ไม่สามารถโหลดข้อมูลโปรไฟล์ได้');
        }
      } catch (error) {
        console.error('Load affiliate profile failed:', error);
        setStatusText('ไม่สามารถโหลดข้อมูลโปรไฟล์ได้');
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [customerId, customerEmail, shop]);

  async function saveProfile(body) {
    if (!customerId) {
      setStatusText('ไม่พบข้อมูลลูกค้า กรุณารีเฟรชหน้าแล้วลองใหม่อีกครั้ง');
      return;
    }

    try {
      setSaving(true);
      setStatusText('');

      const response = await fetch(`${APP_URL}/api/affiliate-profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({shop, customerId, ...body}),
      });
      const result = await response.json();

      if (!response.ok || !result?.ok) {
        setStatusText(result?.error || 'บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        return;
      }

      applyProfile(result);
      setStatusText('บันทึกข้อมูลเรียบร้อยแล้ว');
    } catch (error) {
      console.error('Save affiliate profile failed:', error);
      setStatusText('เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveIdentity() {
    await saveProfile({gender, dob});
  }

  async function handleAddHandle() {
    const value = handleValue.trim();
    if (!value) {
      setStatusText('กรุณากรอกข้อมูลบัญชีที่ต้องการเพิ่ม');
      return;
    }
    await saveProfile({addHandle: {type: handleType, value}});
    setHandleValue('');
  }

  if (loading) {
    return (
      <s-box padding="base" border="base" border-radius="base">
        <s-text>กำลังโหลดข้อมูลโปรไฟล์...</s-text>
      </s-box>
    );
  }

  return (
    <s-box padding="base" border="base" border-radius="base">
      <s-stack direction="block" gap="base">
        <s-heading>โปรไฟล์ Affiliate</s-heading>

        {/* Identity */}
        <s-stack direction="block" gap="tight">
          <s-text emphasis="bold">ข้อมูลส่วนตัว</s-text>
          <s-text>ชื่อ: {profile?.identity?.name || '-'}</s-text>
          <s-text>อีเมล: {profile?.identity?.email || '-'}</s-text>

          <s-select label="เพศ" value={gender} onChange={(e) => setGender(e.target.value)}>
            <s-option value="">ไม่ระบุ</s-option>
            <s-option value="male">ชาย</s-option>
            <s-option value="female">หญิง</s-option>
            <s-option value="other">อื่นๆ</s-option>
          </s-select>

          <s-text-field
            label="วันเกิด"
            type="date"
            value={dob}
            onInput={(e) => setDob(e.target.value)}
          />

          <s-button onClick={handleSaveIdentity} disabled={saving}>
            {saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูลส่วนตัว'}
          </s-button>
        </s-stack>

        {/* Program */}
        <s-stack direction="block" gap="tight">
          <s-text emphasis="bold">ข้อมูลโปรแกรม Affiliate</s-text>
          <s-text>
            รหัสสมาชิก (Affiliate number): {profile?.program?.affiliateNumber || '-'}
          </s-text>
          <s-text>
            วันที่ลงทะเบียน: {formatBangkokDate(profile?.program?.registrationDate)}
          </s-text>
          <s-text>
            สถานะ LINE: {profile?.line?.connected ? 'เชื่อมต่อแล้ว' : 'ยังไม่เชื่อมต่อ'}
          </s-text>
        </s-stack>

        {/* Handles */}
        <s-stack direction="block" gap="tight">
          <s-text emphasis="bold">บัญชีโซเชียล / Affiliate</s-text>

          {Object.entries(HANDLE_LABELS).map(([key, label]) => (
            <s-box key={key} padding="tight" border="base" border-radius="base">
              <s-stack direction="block" gap="tight">
                <s-text emphasis="bold">{label}</s-text>
                {profile?.handles?.[key]?.length ? (
                  profile.handles[key].map((entry) => (
                    <s-text key={entry.value}>
                      {entry.value}
                      {entry.registered_at_display
                        ? ` (ลงทะเบียนเมื่อ ${entry.registered_at_display})`
                        : ''}
                    </s-text>
                  ))
                ) : (
                  <s-text>ยังไม่ได้ลงทะเบียน</s-text>
                )}
              </s-stack>
            </s-box>
          ))}

          <s-select
            label="แพลตฟอร์ม"
            value={handleType}
            onChange={(e) => setHandleType(e.target.value)}
          >
            {Object.entries(HANDLE_LABELS).map(([key, label]) => (
              <s-option key={key} value={key}>
                {label}
              </s-option>
            ))}
          </s-select>

          <s-text-field
            label="เพิ่มบัญชีใหม่"
            value={handleValue}
            onInput={(e) => setHandleValue(e.target.value)}
          />

          <s-button onClick={handleAddHandle} disabled={saving}>
            {saving ? 'กำลังบันทึก...' : 'เพิ่มบัญชี'}
          </s-button>
        </s-stack>

        {statusText ? (
          <s-box padding="tight" border="base" border-radius="base">
            <s-text>{statusText}</s-text>
          </s-box>
        ) : null}
      </s-stack>
    </s-box>
  );
}
