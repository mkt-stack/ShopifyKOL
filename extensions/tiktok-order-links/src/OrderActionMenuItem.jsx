import '@shopify/ui-extensions/preact';
import {render} from 'preact';

export default async () => {
  render(<MenuItem />, document.body);
};

function MenuItem() {
  return (
    <s-button appearance="plain">
      Submit TikTok link
    </s-button>
  );
}