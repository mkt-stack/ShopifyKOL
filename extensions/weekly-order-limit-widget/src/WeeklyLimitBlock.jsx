/**
 * Weekly order limit widget at checkout (purchase.checkout.block.render;
 * placed by the merchant in the checkout editor).
 *
 * Asks the app (/api/weekly-limit) for the logged-in customer's status, and
 * gets back text already rendered from the admin page's messages:
 *   ok     → "You can place 2 more of 3 orders this week."
 *   full   → red banner: limit reached + the Monday they can order again
 *   login  → guest: please log in (the validation Function blocks guests)
 *   hidden → rule off, or the customer has an exempt tag
 * The validation Function enforces the rule. This widget only shows it, so
 * if the app can't be reached the widget shows nothing.
 */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const APP_URL = 'https://shopifykol-production.up.railway.app';

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

  if (status.state === 'full') {
    return (
      <s-banner tone="critical" heading={status.title}>
        <s-text>{status.message}</s-text>
      </s-banner>
    );
  }

  if (status.state === 'login') {
    return (
      <s-banner tone="warning">
        <s-text>{status.message}</s-text>
      </s-banner>
    );
  }

  return (
    <s-banner tone="info">
      <s-text>{status.message}</s-text>
    </s-banner>
  );
}
