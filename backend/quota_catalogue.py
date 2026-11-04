"""Explicit catalogue-only quota reconciliation; no operational prefix inference."""
import sqlalchemy as sa


def reconcile_quota_catalogue(connection, mapping):
    """Update only quota_discipline for exact (import_code, code) identities.

    Mapping is supplied by the caller, so migrations can freeze their own
    configuration and administrative reconciliation can use a future catalogue.
    IDs, descriptive metadata and relationships are never changed.
    """
    table = sa.table('competition', sa.column('import_code', sa.String),
                     sa.column('code', sa.String), sa.column('quota_discipline', sa.String))
    for import_code, code, group in mapping:
        connection.execute(table.update().where(
            table.c.import_code == import_code, table.c.code == code
        ).values(quota_discipline=group))
