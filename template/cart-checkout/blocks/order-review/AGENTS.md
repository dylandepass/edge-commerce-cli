# Review block

Require an API order in payment_requires_confirmation state. Reuse the same idempotency key after uncertain confirmation; prevent concurrent clicks. Preserve cart on pending, error, or cancel. Only a verified payment_completed order may reach success. See `docs/commerce/architecture.md` and review tests.
