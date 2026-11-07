# Anonymous hosted HTTP observation — passed

[Run 42411324573](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/42411324573), job `128519917116`, passed at checker source `dad28070a9d0d4ebd40767d390cb53b32958643b`. This is a read-only public-network packet, separate from the [four accepted browser scenarios](local-import-checks.md).

All ten requests completed their actual response end, message framing, response/request close and socket close within their fifteen-second deadlines. Total work took 2.654 seconds, receiving 4,832,250 body bytes within the 8 MiB budget. Nine responses were 200; the expected disabled-session response was 503. No redirect, credential, cookie, authentication retry, model call, account, database or production write was used. Sanitized parsed-header captures report zero sensitive fields.

| Resource | Observed result |
| --- | --- |
| Homepage | GET 200, 7,313 complete bytes; SHA-256 `3b2d4d0ad806a5747dacb69f5befc4d79b57f4dee55de03d6a920ab0b03120d1` |
| Six client chunks | GET 200 and full closure for each. The first five retain hashes/metadata only. The sixth complete bundle is retained: 3,547,889 bytes; SHA-256 `f33a8f8882e739ad00624be7148fd7ded3f5f6bf6699300a237935ce2a7f3654` |
| Matched UI | The retained bundle contains `Choose a folder`, `Import selected` and `Choose a data folder` at independently checked JavaScript UTF-16 string indices 957177, 959334 and 957312. Its URL is `/_next/static/immutable/chunks/19y-yzcbfbh-e.js`. |
| DuckDB WASM | HEAD 200, `application/wasm`, zero response body. No WASM payload hash is claimed. |
| DuckDB worker | GET 200, 839,642 complete bytes; SHA-256 `964f678d3bfa5a23deb154e0a7950634a4d1415e571040ab2d47815dc3f13582` |
| Session configuration | GET 503 with the exact existing 87-byte unconfigured JSON error; SHA-256 `004aba35acc1d074a2e8d858411fe48eadab01189ad77858e89e330ac9a343f2`. This is not AI-session success. |

Both complete 162-file source manifests are byte-identical: 58,560 bytes, SHA-256 `b75f0974d6a3eab574c5c8d6e1b6f52060f8d6e87dd02b24b4c0d2b3c6fa4246`. Independent review read and hashed all 162 Git bodies/modes (3,669,526 bytes) against the immutable checker source.

The [originals manifest](hosted-http-attempt-3/originals.json) binds seven complete captures and the lossless full job log. Original log: 1,472,018 bytes, SHA-256 `75a8c64697ba196052729dfc3f5f03176a257f38576f6b883abc47301badda48`. The seven original captures total 4,529,959 bytes; all 470 encoded chunks, gzip EOF, sizes, canonical base64 and SHA-256 were independently checked. Large bodies are losslessly compressed with both identities recorded. No raw credential/header values were retained.

The [first](hosted-http-attempt-1.md) path-grammar failure, [second](hosted-http-attempt-2.md) capacity refusal and [local DNS observation](hosted-http-local/manifest.json) remain separate negative results. No earlier false result was relabelled. The temporary HTTP workflow was disabled after terminal success and removed; exact checked bytes remain in the [inactive example](../../../proposals/hosted-http-checks.workflow.yml.example).

Root separately observed production `dpl_J5ZPhyWokYaNF9gYzRE13LqH2L3R` READY at browser-checked runtime `3b06822cf61ad5a18c0029004366f000a5f9db7f`, assigned to [Sift](https://sift-analytics.vercel.app), before and after this packet. The [publication record](local-import-publication.json) preserves that provider observation. HTTP bodies do not independently attest Git identity, all-asset equivalence or uninterrupted alias identity between observations.

This establishes anonymous bootstrap/assets and the disabled-session endpoint. Hosted-browser import/IndexedDB/query durability, other browsers/devices, live PostgreSQL, Docker and real model/tool behavior remain unverified. The application/browser-test runtime inputs are unchanged by the receipt and workflow-retirement edition. SIFT_SESSION_SECRET setup stays owner-deferred; no paid enrollment occurred.
