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

function statusText(ok) {
  return ok ? 'Success' : 'Failed';
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

  const orderId = order?.id || '';
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
          setStatusTextMessage(result?.error || 'Unable to load saved links');
        }
      } catch (error) {
        console.error('Load links failed:', error);
        setStatusTextMessage('Unable to load saved links');
      }
    }

    loadLinks();
  }, [orderId, shop]);

  async function handleSave() {
    setStatusTextMessage('');

    const value = link.trim();

    if (!value) {
      setStatusTextMessage('Please paste a link before saving');
      return;
    }

    if (!isValidTikTokOrShopeeUrl(value)) {
      setStatusTextMessage('Please enter a valid TikTok or Shopee link');
      return;
    }

    if (!orderId) {
      setStatusTextMessage('Order information is missing');
      return;
    }

    if (!shop) {
      setStatusTextMessage('Shop information is missing');
      return;
    }

    try {
      setSaving(true);
      setStatusTextMessage('Saving...');

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
            'Unable to save link. Please try again.',
        );
        return;
      }

      setSavedLinks(result.links || []);
      setLink('');

      const latestSaved = result?.saved;
      if (
        latestSaved?.metafieldUpdated === false ||
        latestSaved?.noteUpdated === false
      ) {
        setStatusTextMessage('Link saved, but Shopify sync had an issue');
      } else {
        setStatusTextMessage('Link saved successfully');
      }
    } catch (error) {
      console.error('Save failed:', error);
      setStatusTextMessage('Connection failed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <s-customer-account-action
      primary-action={{
        content: saving ? 'Saving...' : 'Save link',
        onAction: handleSave,
        disabled: saving,
      }}
      secondary-action={{
        content: 'Close',
      }}
    >
      <s-stack direction="block" gap="base">
        <s-heading>Submit TikTok / Shopee link</s-heading>

        {orderName ? <s-text>Order: {orderName}</s-text> : null}

        <s-text-field
          label="TikTok / Shopee link"
          value={link}
          onInput={(e) => setLink(e.target.value)}
        />

        {statusTextMessage ? (
          <s-box padding="tight" border="base" border-radius="base">
            <s-text>{statusTextMessage}</s-text>
          </s-box>
        ) : null}

        <s-box padding="base" border="base" border-radius="base">
          <s-stack direction="block" gap="tight">
            <s-text emphasis="bold">Latest sync status</s-text>

            <s-text>
              Last saved:{' '}
              {latestEntry
                ? formatBangkokDateTime(getDisplayTimestamp(latestEntry))
                : '-'}
            </s-text>

            <s-text>
              Metafield update:{' '}
              {latestEntry ? statusText(Boolean(latestEntry.metafieldUpdated)) : '-'}
            </s-text>

            <s-text>
              Note update:{' '}
              {latestEntry ? statusText(Boolean(latestEntry.noteUpdated)) : '-'}
            </s-text>

            <s-text>
              Error:{' '}
              {latestEntry?.metafieldError ||
                latestEntry?.noteError ||
                '-'}
            </s-text>
          </s-stack>
        </s-box>

        {savedLinks.length > 0 ? (
          <s-box padding="base" border="base" border-radius="base">
            <s-stack direction="block" gap="tight">
              <s-text emphasis="bold">Saved links</s-text>

              {savedLinks.map((item) => (
                <s-box key={item.id} padding="tight" border="base" border-radius="base">
                  <s-stack direction="block" gap="extra-tight">
                    <s-text>{item.url}</s-text>
                    <s-text>
                      Saved: {formatBangkokDateTime(getDisplayTimestamp(item))}
                    </s-text>
                    <s-text>
                      Metafield: {statusText(Boolean(item.metafieldUpdated))}
                    </s-text>
                    <s-text>
                      Note: {statusText(Boolean(item.noteUpdated))}
                    </s-text>
                    {(item.metafieldError || item.noteError) ? (
                      <s-text>
                        Error: {item.metafieldError || item.noteError}
                      </s-text>
                    ) : null}
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