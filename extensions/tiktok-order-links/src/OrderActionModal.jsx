import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useMemo, useState} from 'preact/hooks';

const APP_URL = 'https://shopifykol-production.up.railway.app';
const FALLBACK_SHOP = 'gqsizecrm.myshopify.com';

function isValidTikTokOrShopeeUrl(value) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();

    return (
      host === 'tiktok.com' ||
      host.endsWith('.tiktok.com') ||
      host === 'vt.tiktok.com' ||
      host === 'shp.ee' ||
      host.endsWith('.shp.ee') ||
      host === 'shopee.co.th' ||
      host.endsWith('.shopee.co.th')
    );
  } catch {
    return false;
  }
}

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

function formatBangkokDateTime(dateValue) {
  if (!dateValue) return '-';

  try {
    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(dateValue));
  } catch {
    return String(dateValue);
  }
}

function getDisplayTimestamp(item) {
  if (!item) return null;
  return item.savedAt || item.createdAt || null;
}

export default async () => {
  render(<OrderActionModal />, document.body);
};

function OrderActionModal() {
  const [link, setLink] = useState('');
  const [savedLinks, setSavedLinks] = useState([]);
  const [statusTextMessage, setStatusTextMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const order = globalThis.shopify?.order?.value;
  const customer = globalThis.shopify?.customer?.value;

  // IMPORTANT: order action targets should use shopify.orderId
  const orderId = globalThis.shopify?.orderId || order?.id || '';
  const orderName = order?.name || '';
  const shop = getShopDomain();

  const customerEmail =
    order?.customer?.email ||
    customer?.emailAddress ||
    customer?.email ||
    '';

  const latestEntry = useMemo(() => {
    if (!savedLinks?.length) return null;
    return savedLinks[0];
  }, [savedLinks]);

  useEffect(() => {
    async function loadLinks() {
      if (!orderId || !shop) return;

      try {
        const response = await fetch(
          `${APP_URL}/api/tiktok-links?shop=${encodeURIComponent(
            shop,
          )}&orderId=${encodeURIComponent(orderId)}`,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
            },
          },
        );

        const result = await response.json();

        if (result?.ok) {
          setSavedLinks(result.links || []);
          setStatusTextMessage('');
        } else {
          setStatusTextMessage(
            result?.error || 'ไม่สามารถโหลดลิงก์ที่เคยส่งได้',
          );
        }
      } catch (error) {
        console.error('Load links failed:', error);
        setStatusTextMessage('ไม่สามารถโหลดลิงก์ที่เคยส่งได้');
      }
    }

    loadLinks();
  }, [orderId, shop]);

  async function handleSave() {
    setStatusTextMessage('');

    const value = link.trim();

    if (!value) {
      setStatusTextMessage('กรุณาวางลิงก์ก่อนส่ง');
      return;
    }

    if (!isValidTikTokOrShopeeUrl(value)) {
      setStatusTextMessage(
        'ลิงก์ไม่ถูกต้องหรือรูปแบบไม่ถูกต้อง กรุณาวางลิงก์ใหม่ ตรวจสอบอีกครั้ง แล้วคลิกส่งลิงก์',
      );
      return;
    }

    if (!orderId) {
      setStatusTextMessage('ไม่พบข้อมูลออเดอร์ กรุณาลองใหม่อีกครั้ง');
      return;
    }

    if (!shop) {
      setStatusTextMessage('ไม่พบข้อมูลร้านค้า กรุณาลองใหม่อีกครั้ง');
      return;
    }

    try {
      setSaving(true);
      setStatusTextMessage('กำลังส่งลิงก์...');

      const response = await fetch(`${APP_URL}/api/tiktok-links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          shop,
          orderId,
          orderName,
          customerEmail,
          url: value,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result?.ok) {
        setStatusTextMessage(
          result?.error ||
            result?.details ||
            'ส่งลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
        );
        return;
      }

      setSavedLinks(result.links || []);
      setLink('');

      if (result?.saved?.metafieldUpdated === false) {
        setStatusTextMessage(
          'ส่งลิงก์แล้ว แต่ระบบบันทึกประวัติไม่สำเร็จ กรุณาแจ้งแอดมิน',
        );
      } else {
        setStatusTextMessage('ส่งลิงก์เรียบร้อยแล้ว');
      }
    } catch (error) {
      console.error('Save failed:', error);
      setStatusTextMessage('เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSaving(false);
    }
  }

  return (
    <s-customer-account-action
      secondary-action={{
        content: 'Close',
      }}
    >
      <s-stack direction="block" gap="base">
        <s-heading>ส่งลิงก์ TikTok / Shopee</s-heading>

        {orderName ? <s-text>ออเดอร์: {orderName}</s-text> : null}

        <s-text-field
          label="TikTok / Shopee link"
          value={link}
          onInput={(e) => setLink(e.target.value)}
        />

        <s-button onClick={handleSave} disabled={saving}>
          {saving ? 'กำลังส่งลิงก์...' : 'ส่งลิงก์'}
        </s-button>

        {statusTextMessage ? (
          <s-box padding="tight" border="base" border-radius="base">
            <s-text>{statusTextMessage}</s-text>
          </s-box>
        ) : null}

        <s-box padding="base" border="base" border-radius="base">
          <s-stack direction="block" gap="tight">
            <s-text emphasis="bold">ประวัติการส่งล่าสุด</s-text>

            <s-text>
              ล่าสุด:{' '}
              {latestEntry
                ? formatBangkokDateTime(getDisplayTimestamp(latestEntry))
                : '-'}
            </s-text>
          </s-stack>
        </s-box>

        {savedLinks.length > 0 ? (
          <s-box padding="base" border="base" border-radius="base">
            <s-stack direction="block" gap="tight">
              <s-text emphasis="bold">ลิงก์ที่ส่งสำเร็จแล้ว</s-text>

              {savedLinks.map((item) => (
                <s-box
                  key={item.id}
                  padding="tight"
                  border="base"
                  border-radius="base"
                >
                  <s-stack direction="block" gap="extra-tight">
                    <s-text>{item.url}</s-text>
                    <s-text>
                      ส่งเมื่อ: {formatBangkokDateTime(getDisplayTimestamp(item))}
                    </s-text>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          </s-box>
        ) : null}
      </s-stack>
    </s-customer-account-action>
  );
}