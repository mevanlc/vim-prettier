# Test Vim Driver

This is the small subset of `vim-driver@1.0.1` used by the Jest formatting
harness, adapted locally under the same MIT license as the upstream package.
See `LICENSE` for upstream attribution.

The local copy avoids the unused `shortid -> nanoid` dependency path by using
deterministic process-local counters for client and request IDs. It is test-only
infrastructure and is not part of vim-prettier runtime behavior.
