const SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loader = null;

export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(true);
  if (!loader) {
    loader = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = SRC;
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => {
        loader = null;
        script.remove();
        resolve(false);
      };
      document.body.appendChild(script);
    });
  }
  return loader;
}

/**
 * Opens Razorpay Checkout. Resolves with the gateway response on success,
 * rejects with { dismissed: true } if the shopper closes the modal, or with the
 * failure payload when the payment fails.
 */
export function openRazorpayCheckout(payment) {
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: payment.keyId,
      amount: payment.amount,
      currency: payment.currency,
      name: payment.name,
      description: payment.description,
      order_id: payment.razorpayOrderId,
      prefill: payment.prefill,
      theme: { color: '#6B1E2B' },
      handler: (response) => resolve(response),
      modal: { ondismiss: () => reject({ dismissed: true }), confirm_close: true },
    });
    rzp.on('payment.failed', (resp) => reject({ failed: true, reason: resp?.error?.description }));
    rzp.open();
  });
}
