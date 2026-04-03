import '@shopify/ui-extensions/preact';
import {render} from 'preact';

export default async () => {
  // In this target, Shopify exposes order context via shopify.orderId.
  // If there is no orderId, don't render the action.
  if (!globalThis.shopify?.orderId) {
    render(null, document.body);
    return;
  }

  render(<MenuItem />, document.body);
};

function MenuItem() {
  return (
    <s-button appearance="plain">
      ส่งลิงก์วิดีโอ
    </s-button>
  );
}