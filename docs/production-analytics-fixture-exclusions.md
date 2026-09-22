# Production analytics fixture exclusions

## Bounded inventory

Kindred excludes a production session only when retained evidence binds its exact ID to a named supervised runner and overlapping telemetry. The reviewed inventory covers the recovery run ending **2026-09-22T15:11:16.321Z**; it is not a complete classification of traffic before or after that cutoff.

Runner receipt: `evidence/supervised-release/recovery-2/remote-attempt-1/gameplay-receipt.json`

Telemetry receipt: `evidence/supervised-release/monitoring-closure/product-events-readback.json`

| Session ID                         | Rows | First event              | Last event               |
| ---------------------------------- | ---: | ------------------------ | ------------------------ |
| `k57agtpm30kn5ktpawsvb00ba58exq3m` |    6 | 2026-09-22T15:10:49.338Z | 2026-09-22T15:11:02.508Z |
| `jn71m1d8747khhn92vkyxtnf258ewv0n` |   27 | 2026-09-22T15:10:53.661Z | 2026-09-22T15:11:01.598Z |
| `jn71tpe4grfe832g4hkza4a32n8ewa4e` |   43 | 2026-09-22T15:11:03.420Z | 2026-09-22T15:11:15.927Z |

The previously listed IDs `k57dq3shp968a2pa38xkzva6bh8ewep0` and `jn76ytbj7bhnsctyhs265dg5gx8ewtse` have no retained named-run binding. They are intentionally not excluded. Their rows, if present, remain in the unclassified population.

## Counter meaning

- `fixtureEventsExcluded` counts rows whose exact production session ID is in the evidence-backed inventory.
- `unclassifiedEventsRetained` counts all sampled production rows not in that inventory. It can contain genuine users, unproven QA sessions, or other traffic; it is not a verified-human count.
- `genuineEventsRetained` remains as a backward-compatible alias for `unclassifiedEventsRetained`. Its historical name does not strengthen the classification claim.
- Classification is read-only. It does not delete or rewrite retained event rows, and the production inventory is not applied to staging or test traffic.

## Receipt-first updates

For each future supervised production run:

1. Before emitting events, create a named runner receipt that records the run identity, newly generated session IDs, and bounded start time. Never reuse a prior session ID.
2. After the run, retain a read-only telemetry receipt showing each exact session ID, event count, and first/last event time inside the runner window.
3. Leave any session unclassified unless both receipts establish the same exact ID and overlapping window. Do not infer ownership from a timestamp or filename.
4. Append only fully bound IDs to `KNOWN_PRODUCTION_FIXTURE_SESSION_IDS`; add focused tests for every added ID, near matches, uncertain IDs, staging isolation, and unchanged source-row counts.
5. Require narrow review of the per-ID mapping and exact-head test evidence before using the updated exclusion in a report.
