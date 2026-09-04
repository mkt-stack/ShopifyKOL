import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const APP_URL = 'https://shopifykol-production.up.railway.app';
const FALLBACK_SHOP = 'gqsizecrm.myshopify.com';

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

function formatMoney(amount, currencyCode) {
  if (amount === null || amount === undefined || !currencyCode) return '-';
  try {
    return new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currencyCode}`;
  }
}

function formatCreditEarned(totalsByCurrency) {
  if (!totalsByCurrency) return '-';
  const entries = Object.entries(totalsByCurrency);
  if (entries.length === 0) return formatMoney(0, 'THB');
  // Most accounts will only ever have one currency; join if more than one.
  return entries
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(' + ');
}

const PIPELINE_TILES = [
  {key: 'completed', label: 'Sample completed', badge: 'Placed', tone: 'neutral'},
  {key: 'inTransit', label: 'Sample in transit', badge: 'Shipped', tone: 'info'},
  {key: 'pendingSubmission', label: 'Sample pending submission', badge: 'Received', tone: 'warning'},
  {key: 'submittedVideo', label: 'Sample with submitted video', badge: 'Submitted', tone: 'success'},
];

// Card-style tile using the Polaris section component, which gives the
// rounded-corner / elevated-surface look natively — no manual box-shadow
// prop exists on this platform's web components by design.
function StatCard({label, value}) {
  return (
    <s-section padding="base">
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-section>
  );
}

function PipelineCard({label, value, badge, tone}) {
  return (
    <s-section padding="base">
      <s-stack direction="block" gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text color="subdued">{label}</s-text>
          <s-badge tone={tone}>{badge}</s-badge>
        </s-stack>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-section>
  );
}

export default async () => {
  render(<AffiliateProgressPage />, document.body);
};

function AffiliateProgressPage() {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState('');

  const customer = globalThis.shopify?.customer?.value;
  const customerId = customer?.id || '';
  const customerEmail = customer?.emailAddress || customer?.email || '';
  const shop = getShopDomain();

  useEffect(() => {
    async function loadProgress() {
      if ((!customerId && !customerEmail) || !shop) {
        setLoading(false);
        return;
      }

      try {
        const params = new URLSearchParams({shop});
        if (customerId) params.set('customerId', customerId);
        else params.set('customerEmail', customerEmail);

        const response = await fetch(`${APP_URL}/api/affiliate-progress?${params}`, {
          method: 'GET',
          headers: {Accept: 'application/json'},
        });
        const result = await response.json();

        if (result?.ok) {
          setData(result);
        } else {
          setStatusText(result?.error || 'ไม่สามารถโหลดข้อมูลความคืบหน้าได้');
        }
      } catch (error) {
        console.error('Load affiliate progress failed:', error);
        setStatusText('ไม่สามารถโหลดข้อมูลความคืบหน้าได้');
      } finally {
        setLoading(false);
      }
    }

    loadProgress();
  }, [customerId, customerEmail, shop]);

  return (
    <s-page heading="ความคืบหน้า Affiliate ของฉัน">
      <s-grid gridTemplateColumns="minmax(auto, 760px)" justifyContent="center">
        <s-stack direction="block" gap="large">
          {loading ? (
            <s-section padding="base">
              <s-text>กำลังโหลดข้อมูล...</s-text>
            </s-section>
          ) : statusText ? (
            <s-section padding="base">
              <s-text>{statusText}</s-text>
            </s-section>
          ) : (
            <>
              <s-stack direction="block" gap="small-400">
                <s-heading>ภาพรวม</s-heading>
                <s-grid
                  gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
                  gap="base"
                >
                  <StatCard
                    label="เครดิตที่ได้รับสะสม"
                    value={formatCreditEarned(data?.totalCreditEarned)}
                  />
                  <StatCard
                    label="มูลค่าสินค้าตัวอย่างที่ขอทั้งหมด"
                    value={formatMoney(data?.totalSampleValue, 'THB')}
                  />
                  <StatCard
                    label="จำนวนสินค้าตัวอย่างที่ได้รับ"
                    value={String(data?.totalSampleQuantity ?? '-')}
                  />
                  <StatCard
                    label="จำนวนวิดีโอที่ส่งแล้ว"
                    value={String(data?.videosSubmitted ?? '-')}
                  />
                </s-grid>
              </s-stack>

              <s-stack direction="block" gap="small-400">
                <s-heading>สถานะออเดอร์ในโปรแกรม</s-heading>
                <s-grid
                  gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))"
                  gap="base"
                >
                  {PIPELINE_TILES.map(({key, label, badge, tone}) => (
                    <PipelineCard
                      key={key}
                      label={label}
                      value={data?.pipeline?.[key] ?? 0}
                      badge={badge}
                      tone={tone}
                    />
                  ))}
                </s-grid>
              </s-stack>
            </>
          )}
        </s-stack>
      </s-grid>
    </s-page>
  );
}
