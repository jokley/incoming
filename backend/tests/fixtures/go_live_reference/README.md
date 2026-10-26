# Seven-pair structural reference fixtures

These local fixtures were derived for analysis from the seven user-supplied
Entries/Room List pairs dated October 2026. They are not original workbook dumps.

- Original names, FIS codes, staff IDs, accreditation IDs, contact data, transport
  details and free-text fields are removed/replaced.
- Synthetic nations X01–X07, generated identifiers and neutral person names are
  used consistently across Entries and Room List, including room partners.
- Person labels/identifiers and row order are detached from original source
  order. No original-to-generated identity mapping is exported.
- Retained: roles, genders, competition flags, accommodation request categories,
  room-partner graph, relevant dates and daily room counts required to reproduce
  parsing/matching and quota behavior. These are structural test data, not real
  approvals or price agreements.
- Original XLSX files, private browser artifacts and extraction data stay outside
  Git. Do not add them to commits, PR attachments or public test reports.

The expected aggregate counts were first measured by real HTTP uploads of the
original files into a newly created isolated database. The tests reconstruct
workbooks from these structural fixtures and exercise the real endpoint,
review/decision/confirm, person-specific memberships and identical reimport.
Approval choices are explicitly synthetic. Fixture order does not claim which
real person ought to receive an exception.

`test_admin_cleanup_reference_pairs.py` reconstructs each workbook pair, imports
it with synthetic decisions, removes that nation through the administrative API
and imports the same files freshly. The older analysis-only defect
characterizations were replaced by the desired cleanup assertions.
