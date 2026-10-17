# Empty FIS Room Lists and compact accommodation controls

The uploaded GER (21 people) and FIN (8 people) Room Lists contain exactly one cell, `no data available`, on the first sheet `Data`. Uploads are saved under temporary filenames; the existing fallback detector looked for normal Entries/Room List headers. The placeholder therefore produced `unknown`, and forcing the file role would still fail required-column validation.

## Recognition and semantics

`load_first_sheet` retains the sheet name as DataFrame metadata. The shared predicate accepts the exact FIS structure: first sheet named `Data`, one normalized column `no data available`, and no data rows. It is used by file identification and the Room List parser, independently of the upload filename. Corrupt Excel files, unrelated sheets and mixed content retain normal validation failures. The check reuses the existing workbook reads and adds no workbook parsing pass.

This is valid missing Room List evidence: zero rooms, zero day columns and one informational issue, `ROOM_LIST_NO_DATA`, with `Room List enthält keine Unterkunftsdaten.` It is never a No room request. Actual explicit Entries values still follow the existing resolver. Both uploaded Entries workbooks themselves contain explicit No room values; their NO_ROOM results come from those Entries values, not from the placeholder. No room, roommate, hotel or booking is synthesized.

The server-owned preview/version retains optional `roomListHasNoData` metadata so recalculation and confirmation retain this distinction. Existing MANUAL decisions and tariff state remain untouched. Missing Entries request/partner values do not clear existing fields in this empty-Room-List case. An existing person's EZ entitlement/status/decision link is not cleared merely because no request rows are available; independent existing exemption rules still apply. Booking guards, quota formulas and coverage are unchanged. A missing Room List is not compared as an explicit removal of all existing rooms/partners.

## Review and UI

The preview shows one informational Alert, not a blocking error or a new warning per person. The current review/approve/import endpoints continue normally.

Import review uses 32px controls, smaller labels, a narrower requirement column and one secondary source/provenance line. Manual/release actions remain explicit text buttons, with full source text available in the tooltip and accessibility tree. Repeated NO_ROOM explanatory text is a tooltip in compact mode; the selected value remains explicit. Person detail uses the same compact treatment and retains No room, neutral Mehrpreis and assignment status. The tariff helper remains available as its existing tooltip. The new dense tariff style is enabled only for Import Review and Athlete detail, leaving the assignment panel's existing compact-helper behavior unchanged.

## Validation

- Actual uploaded GER and FIN files accepted and confirmed in disposable SQLite fixtures.
- Contact-free extracted GER/FIN fixtures follow the existing real_entries fixture policy; original XLSX files are not added to the repository.
- 131 relevant backend tests passed. Final empty-list plus World Champion check: 30 passed. Coverage includes deterministic multipart identification in either order with opaque filenames, review/approval/confirmation, zero request rows, ordinary Entries requests, manual REQUIRED/NO_ROOM, imported requirement preservation without new evidence, SPECIAL, historical EZ approval linkage, unchanged shared booking, and malformed/unrelated files. Existing normal-room imports and structural performance tests also passed.
- 117 frontend tests passed; TypeScript and production build passed.
- Chromium checked desktop 1440px, narrow desktop 1024px and narrow modal 600px, long name/Function/source values, NO_ROOM and SPECIAL, keyboard access and one info notice. Existing table scrolling stays inside its dialog; no document overflow or JavaScript errors. Person detail retains No room/Sondertarif with compact editable fields.

## Performance guard

Same benchmark script, same AUS fixture and isolated SQLite setup, three runs per version. Times are profiled local medians, not production latency:

| Flow | Before ms | After ms | SQL before / after |
|---|---:|---:|---:|
| Preview | 275.66 | 290.05 | 34 / 34 |
| Session detail | 103.27 | 110.10 | 39 / 39 |
| Session list | 182.84 | 197.01 | 39 / 39 |
| Confirmation | 252.01 | 241.53 | 118 / 118 |

No query or flush-count growth. Time variation is mixed (confirmation faster; other medians 5–8% higher), with overlapping run ranges/GC variation, not evidence of a new structural regression. No N+1 access or per-person detection/refetch was added. All normal AUS business payload projections and persisted snapshots still match the before measurements. Raw results are scratch artifacts under `work/performance/empty-before*` and `empty-after*`.

No schema, quota/business rules, role classification, NO_ROOM semantics, import precedence, EXTERNAL behavior, Dashboard or Analytics changes.
