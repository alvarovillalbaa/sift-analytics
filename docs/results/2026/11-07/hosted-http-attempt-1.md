# Hosted HTTP observation — attempt 1 failed on asset grammar

[Run 42410362522](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/42410362522), job `128516978014`, checked observer source `711b469ec298ba445090e960d21704fb94c2385f`. The packet remains **failed**.

The anonymous homepage GET completed with HTTP 200 and `text/html`: 7,313 original representation bytes, SHA-256 `3b2d4d0ad806a5747dacb69f5befc4d79b57f4dee55de03d6a920ab0b03120d1`. Response end/message completeness, request/response/socket close all passed within the finite deadline. No cookie/auth fields or redirect were observed.

All eight actual script URLs use `/_next/static/immutable/chunks/`. The checker admitted only `/_next/static/chunks/`, found zero candidates and correctly failed. No script body, worker, WASM or session endpoint was attempted. This is an observer grammar mismatch; it establishes neither a product failure nor complete hosted bootstrap. The correction admits exactly the two static prefixes, preserving same-origin, userinfo/query/hash/encoded-slash/traversal restrictions and every request/size/deadline/status/privacy gate.

The strict before/after 148-file source manifests are byte-identical: 53,315 bytes, SHA-256 `7730ee3f61990b3ba80ce7f8d0639508fd9bf06c7498c23e468359cc57d26be5`. The [originals manifest](hosted-http-attempt-1/originals.json) binds all four complete decoded captures plus the lossless full job log. Original log: 58,763 bytes, SHA-256 `eae07b5fd2269f67bb76bba834ec4624bed4d0213a66f1130a9b6de629b9404f`. Headers are labelled sanitized parsed JSON, not raw wire bytes.

The separately attested deployment remains `dpl_J5ZPhyWokYaNF9gYzRE13LqH2L3R` at browser-checked runtime `3b06822cf61ad5a18c0029004366f000a5f9db7f`; this HTTP response does not independently establish that Git identity. The [accepted browser packet](local-import-checks.md) stays separate. No authentication retry, protection bypass, model, account, database or hosted-browser exercise occurred. Earlier local DNS/web-fetch failures remain negative transport observations, not site-outage proof.
