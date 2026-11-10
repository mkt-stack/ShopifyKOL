/**
 * Weekly order limit widget at checkout (purchase.checkout.block.render;
 * placed by the merchant in the checkout editor).
 *
 * Asks the app (/api/weekly-limit) for the logged-in customer's status, and
 * gets back text already rendered from the admin page's messages plus the
 * numbers needed to draw the slot bar:
 *   ok     → bordered box: title + "2 of 3 left", one slot per order in the
 *            limit (green check = used, grey circle = free), reset date or
 *            the "last order" note
 *   full   → red banner: limit reached, all slots green, reorder date
 *   login  → guest: warning banner, no slots (the count isn't known)
 *   hidden → rule off, or the customer has an exempt tag
 * Limits above MAX_SLOTS draw a progress bar instead of slots.
 * The validation Function enforces the rule. This widget only shows it, so
 * if the app can't be reached the widget shows nothing.
 */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const APP_URL = 'https://shopifykol-production.up.railway.app';
const MAX_SLOTS = 12;

export default async () => {
  render(<WeeklyLimitBlock />, document.body);
};

function language() {
  const iso = String(shopify.localization?.language?.value?.isoCode || '');
  return iso.toLowerCase().startsWith('th') ? 'th' : 'en';
}

// Changes when the buyer logs in during checkout, so the status refetches.
function customerKey() {
  try {
    return shopify.buyerIdentity?.customer?.value?.id || '';
  } catch {
    return '';
  }
}

function WeeklyLimitBlock() {
  const [status, setStatus] = useState(null);
  const customer = customerKey();
  const lang = language();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await shopify.sessionToken.get();
        const res = await fetch(`${APP_URL}/api/weekly-limit?lang=${lang}`, {
          headers: {Authorization: `Bearer ${token}`},
        });
        const data = await res.json();
        if (!cancelled) setStatus(res.ok ? data : null);
      } catch (error) {
        console.error('Weekly order limit status failed:', error);
        if (!cancelled) setStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customer, lang]);

  if (!status || status.state === 'hidden') return null;

  if (status.state === 'login') {
    return (
      <s-banner tone="warning" heading={status.title}>
        <s-text>{status.message}</s-text>
      </s-banner>
    );
  }

  const limit = Math.max(0, Number(status.limit) || 0);
  const count = Math.min(limit, Math.max(0, Number(status.count) || 0));

  if (status.state === 'full') {
    return (
      <s-banner tone="critical" heading={status.title}>
        <s-stack direction="block" gap="small-200">
          <Slots count={count} limit={limit} />
          <s-text>{status.message}</s-text>
        </s-stack>
      </s-banner>
    );
  }

  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack direction="block" gap="small-200">
        <s-grid gridTemplateColumns="1fr auto" alignItems="center" gap="base">
          <s-text type="strong">{status.title}</s-text>
          <s-text color="subdued">{status.left}</s-text>
        </s-grid>
        <Slots count={count} limit={limit} />
        {status.last ? (
          <s-text tone="warning">{status.message}</s-text>
        ) : (
          <s-text color="subdued">{status.message}</s-text>
        )}
      </s-stack>
    </s-box>
  );
}

// One icon per order in the limit: used slots first (green check), then free
// ones (grey circle). Large limits get a progress bar instead.
function Slots({count, limit}) {
  if (!limit) return null;
  if (limit > MAX_SLOTS) {
    return (
      <s-progress
        value={count}
        max={limit}
        tone={count >= limit ? 'critical' : 'auto'}
        accessibilityLabel={`${count} / ${limit}`}
      />
    );
  }
  return (
    <s-stack direction="inline" gap="small-200">
      {Array.from({length: limit}, (_, i) =>
        i < count ? (
          <s-icon key={i} type="check-circle-filled" tone="success" />
        ) : (
          <s-icon key={i} type="circle" tone="neutral" />
        ),
      )}
      <s-text accessibilityVisibility="exclusive">{`${count} / ${limit}`}</s-text>
    </s-stack>
  );
}
