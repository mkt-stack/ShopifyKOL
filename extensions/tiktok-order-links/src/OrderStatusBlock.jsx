import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

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

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [link, setLink] = useState('');
  const [savedLinks, setSavedLinks] = useState([]);
  const [statusText, setStatusText] = useState('');
  const [saving, setSaving] = useState(false);

  const order = globalThis.shopify?.order?.value;
  const customer = globalThis.shopify?.customer?.value;

  const orderId = order?.id || '';
  const orderName = order?.name || '';
  const shop = getShopDomain();

  const customerEmail =
    order?.customer?.email ||
    customer?.emailAddress ||
    customer?.email ||
    '';

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
          setStatusText('');
        } else {
          setStatusText(result?.error || 'ไม่สามารถโหลดลิงก์ที่บันทึกไว้ได้');
        }
      } catch (error) {
        console.error('Load links failed:', error);
        setStatusText('ไม่สามารถโหลดลิงก์ที่บันทึกไว้ได้');
      }
    }

    loadLinks();
  }, [orderId, shop]);

  async function handleSave() {
    setStatusText('');

    const value = link.trim();

    if (!value) {
      setStatusText('กรุณาวางลิงก์ก่อนบันทึก');
      return;
    }

    if (!isValidTikTokOrShopeeUrl(value)) {
      setStatusText(
        'ลิงก์ไม่ถูกต้องหรือรูปแบบไม่ถูกต้อง กรุณาวางลิงก์ใหม่ ตรวจสอบอีกครั้ง แล้วคลิกบันทึกลิงก์',
      );
      return;
    }

    if (!orderId) {
      setStatusText('ไม่พบข้อมูลออเดอร์ กรุณารีเฟรชหน้าแล้วลองใหม่อีกครั้ง');
      return;
    }

    if (!shop) {
      setStatusText('ไม่พบข้อมูลร้านค้า กรุณารีเฟรชหน้าแล้วลองใหม่อีกครั้ง');
      return;
    }

    try {
      setSaving(true);
      setStatusText('กำลังบันทึก...');

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
      console.log('Save result:', result);

      if (!response.ok || !result?.ok) {
        setStatusText(
          result?.error ||
            result?.details ||
            'บันทึกลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
        );
        return;
      }

      setSavedLinks(result.links || []);
      setLink('');
      setStatusText('บันทึกลิงก์เรียบร้อยแล้ว สามารถเพิ่มลิงก์ใหม่ได้');
    } catch (error) {
      console.error('Save failed:', error);
      setStatusText(
        'เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือแจ้งแอดมิน',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <s-box padding="base" border="base" border-radius="base">
      <s-stack direction="block" gap="base">
        <s-heading>วางลิงก์วิดีโอ TikTok</s-heading>

        <s-text>
          วางลิงก์ TikTok หรือ Shopee ที่ถูกต้อง แล้วคลิกบันทึกลิงก์
        </s-text>

        <s-text-field
          label="ลิงก์ TikTok / Shopee"
          value={link}
          onInput={(e) => setLink(e.target.value)}
        />

        <s-button onClick={handleSave} disabled={saving}>
          {saving ? 'กำลังบันทึก...' : 'บันทึกลิงก์'}
        </s-button>

        {statusText ? (
          <s-box padding="tight" border="base" border-radius="base">
            <s-text>{statusText}</s-text>
          </s-box>
        ) : null}

        {savedLinks.length > 0 ? (
          <s-box padding="base" border="base" border-radius="base">
            <s-stack direction="block" gap="tight">
              <s-text>ลิงก์ที่บันทึกแล้ว</s-text>
              {savedLinks.map((item) => (
                <s-text key={item.id}>{item.url}</s-text>
              ))}
            </s-stack>
          </s-box>
        ) : null}
      </s-stack>
    </s-box>
  );
}