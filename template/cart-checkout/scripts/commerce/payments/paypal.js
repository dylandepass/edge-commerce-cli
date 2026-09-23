import checkout from '../checkout-config.js';
import site from '../site-config.js';
import { createExpressFlow } from '../checkout-flow.js';

let sdkPromise;
export function loadPayPalSdk({ documentRef = document, windowRef = window } = {}) {
  if (windowRef.paypal?.createInstance) return Promise.resolve(windowRef.paypal);
  if (!sdkPromise)
    sdkPromise = new Promise((resolve, reject) => {
      const script = documentRef.createElement('script');
      script.src =
        checkout.paypal.environment === 'live'
          ? 'https://www.paypal.com/web-sdk/v6/core'
          : 'https://www.sandbox.paypal.com/web-sdk/v6/core';
      script.async = true;
      script.onload = () =>
        windowRef.paypal?.createInstance
          ? resolve(windowRef.paypal)
          : reject(new Error('PayPal SDK unavailable'));
      script.onerror = () => reject(new Error('PayPal SDK failed to load'));
      documentRef.head.append(script);
    }).catch((error) => {
      sdkPromise = null;
      throw error;
    });
  return sdkPromise;
}

export async function createExpressButton({
  flow = createExpressFlow(),
  sdk,
  onReview,
  onError = () => {},
} = {}) {
  const instance = await sdk.createInstance({
    clientId: checkout.paypal.clientId,
    components: ['paypal-payments'],
    pageType: 'cart',
    locale: site.locale,
  });
  const eligible = await instance.findEligibleMethods({ currencyCode: site.currency });
  if (!eligible.isEligible('paypal')) throw new Error('PayPal is not available for this buyer');
  const session = instance.createPayPalOneTimePaymentSession({
    onShippingAddressChange: (data) => flow.setAddress(data.shippingAddress),
    onShippingOptionsChange: (data) => flow.setShippingOption(data.selectedShippingOption?.id),
    onApprove: async (data) => {
      try {
        const result = await flow.approve(data.orderId);
        onReview(result.reviewUrl);
      } catch (error) {
        onError(error);
        throw error;
      }
    },
    onCancel: () => flow.cancel(),
    onError,
  });
  const start = async () => session.start({ presentationMode: 'auto' }, flow.start());
  start.hasReturned = () => Boolean(session.hasReturned?.());
  start.resume = () => session.resume();
  return start;
}
