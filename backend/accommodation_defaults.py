"""Creation-time quota-evaluation default; never recompute saved overrides."""


def default_counts_as_single(capacity, person_count, *, single_request=False, approved_extra=False):
    if capacity == 1:
        return True
    if capacity == 2:
        return person_count == 1 and (single_request or approved_extra)
    # Preserve existing handling outside physical 1p/2p inventory (e.g. EXTERNAL).
    return approved_extra
