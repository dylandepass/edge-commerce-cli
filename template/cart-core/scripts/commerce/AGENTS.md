# Commerce cart contract

This subtree is customer-owned. Keep storage scoped to the store view, rebase mutations on persisted state, distinguish cart lines by SKU/path/options/custom data, and never treat a browser price as authoritative. `getOrderItems()` projects only API-supported fields. Preserve the cart until payment is verified. See `docs/commerce/setup.md` and the cart unit tests. Do not add server secrets or Node runtime imports.
