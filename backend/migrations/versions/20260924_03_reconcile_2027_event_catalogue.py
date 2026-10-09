"""reconcile Montafon mappings with current 2027 catalogue

Revision ID: 20260924_03
Revises: 20260924_02
"""
from alembic import context, op
import sqlalchemy as sa

revision = '20260924_03'
down_revision = '20260924_02'
branch_labels = None
depends_on = None

CURRENT_2027 = (
    ('WSC_PGS_M_6170', '6170', "Men's Parallel Giant Slalom", 'Snowboard', 'M', False, 'Parallel Giant Slalom', 'Parallel'),
    ('WSC_PGS_W_6172', '6172', "Women's Parallel Giant Slalom", 'Snowboard', 'W', False, 'Parallel Giant Slalom', 'Parallel'),
    ('WSC_HP_M_6174', '6174', "Men's Halfpipe", 'Snowboard', 'M', False, 'Snowboard Halfpipe', 'Snowboard Halfpipe'),
    ('WSC_HP_W_6175', '6175', "Women's Halfpipe", 'Snowboard', 'W', False, 'Snowboard Halfpipe', 'Snowboard Halfpipe'),
    ('WSC_PSL_M_6177', '6177', "Men's Parallel Slalom", 'Snowboard', 'M', False, 'Parallel Slalom', 'Parallel'),
    ('WSC_PSL_W_6178', '6178', "Women's Parallel Slalom", 'Snowboard', 'W', False, 'Parallel Slalom', 'Parallel'),
    ('WSC_PRT_A_6180', '6180', 'Mixed Parallel Team', 'Snowboard', 'A', True, 'Parallel Team', 'Parallel'),
    ('WSC_BA_M_6182', '6182', "Men's Big Air", 'Snowboard', 'M', False, 'Snowboard Big Air', 'Snowboard Big Air'),
    ('WSC_BA_W_6183', '6183', "Women's Big Air", 'Snowboard', 'W', False, 'Snowboard Big Air', 'Snowboard Big Air'),
    ('WSC_SS_M_6188', '6188', "Men's Slopestyle", 'Snowboard', 'M', False, 'Snowboard Slopestyle', 'Snowboard Slopestyle'),
    ('WSC_SS_W_6190', '6190', "Women's Slopestyle", 'Snowboard', 'W', False, 'Snowboard Slopestyle', 'Snowboard Slopestyle'),
    ('WSC_SBX_M_6191', '6191', "Men's Snowboard Cross", 'Snowboard', 'M', False, 'Snowboard Cross', 'Snowboard Cross'),
    ('WSC_SBX_W_6192', '6192', "Women's Snowboard Cross", 'Snowboard', 'W', False, 'Snowboard Cross', 'Snowboard Cross'),
    ('WSC_BXT_A_6193', '6193', 'Mixed Snowboard Cross Team', 'Snowboard', 'A', True, 'Snowboard Cross Team', 'Snowboard Cross'),
    ('WSC_HP_M_8171', '8171', "Men's Freeski Halfpipe", 'Freeski', 'M', False, 'Freeski Halfpipe', 'Freeski Halfpipe'),
    ('WSC_HP_W_8172', '8172', "Women's Freeski Halfpipe", 'Freeski', 'W', False, 'Freeski Halfpipe', 'Freeski Halfpipe'),
    ('WSC_BA_M_8178', '8178', "Men's Freeski Big Air", 'Freeski', 'M', False, 'Freeski Big Air', 'Freeski Big Air'),
    ('WSC_MO_M_8179', '8179', "Men's Moguls", 'Freestyle Ski', 'M', False, 'Moguls', 'Moguls'),
    ('WSC_SX_M_8180', '8180', "Men's Ski Cross", 'Freestyle Ski', 'M', False, 'Ski Cross', 'Ski Cross'),
    ('WSC_BA_W_8181', '8181', "Women's Freeski Big Air", 'Freeski', 'W', False, 'Freeski Big Air', 'Freeski Big Air'),
    ('WSC_MO_W_8183', '8183', "Women's Moguls", 'Freestyle Ski', 'W', False, 'Moguls', 'Moguls'),
    ('WSC_SX_W_8184', '8184', "Women's Ski Cross", 'Freestyle Ski', 'W', False, 'Ski Cross', 'Ski Cross'),
    ('WSC_SXT_A_8185', '8185', 'Ski Cross Team', 'Freestyle Ski', 'A', True, 'Ski Cross Team', 'Ski Cross'),
    ('WSC_DM_M_8186', '8186', "Men's Dual Moguls", 'Freestyle Ski', 'M', False, 'Dual Moguls', 'Moguls'),
    ('WSC_DM_W_8187', '8187', "Women's Dual Moguls", 'Freestyle Ski', 'W', False, 'Dual Moguls', 'Moguls'),
    ('WSC_DMT_A_8188', '8188', 'Dual Moguls Team', 'Freestyle Ski', 'A', True, 'Dual Moguls Team', 'Moguls'),
    ('WSC_AE_M_8193', '8193', "Men's Aerials", 'Freestyle Ski', 'M', False, 'Aerials', 'Aerials'),
    ('WSC_AE_W_8194', '8194', "Women's Aerials", 'Freestyle Ski', 'W', False, 'Aerials', 'Aerials'),
    ('WSC_AET_A_8195', '8195', 'Aerials Team', 'Freestyle Ski', 'A', True, 'Aerials Team', 'Aerials'),
    ('WSC_SS_M_8196', '8196', "Men's Freeski Slopestyle", 'Freeski', 'M', False, 'Freeski Slopestyle', 'Freeski Slopestyle'),
    ('WSC_SS_W_8197', '8197', "Women's Freeski Slopestyle", 'Freeski', 'W', False, 'Freeski Slopestyle', 'Freeski Slopestyle'),
)

# Import identifiers used before the authoritative 2027 catalogue update.
LEGACY_BY_IDENTITY = {
    ("Women's Aerials", 'Freestyle Ski', 'W'): 'WSC_AE_W_8234',
    ("Men's Aerials", 'Freestyle Ski', 'M'): 'WSC_AE_M_8233',
    ('Aerials Team', 'Freestyle Ski', 'A'): 'WSC_AET_A_8226',
    ("Women's Moguls", 'Freestyle Ski', 'W'): 'WSC_MO_W_8213',
    ("Men's Moguls", 'Freestyle Ski', 'M'): 'WSC_MO_M_8212',
    ("Women's Dual Moguls", 'Freestyle Ski', 'W'): 'WSC_DM_W_8218',
    ("Men's Dual Moguls", 'Freestyle Ski', 'M'): 'WSC_DM_M_8217',
}


def upgrade():
    if context.is_offline_mode():
        _upgrade_offline()
        return
    bind = op.get_bind()
    event_id = bind.execute(sa.text(
        "SELECT id FROM championship_event WHERE name = 'WSC Montafon 2027'"
    )).scalar_one()
    retained = []
    for import_code, codex, official_name, sport, gender, team, display_name, quota in CURRENT_2027:
        legacy_code = LEGACY_BY_IDENTITY.get((official_name, sport, gender))
        if official_name == 'Aerials Team':
            # The former label was "Mixed Aerials Team".
            legacy_code = 'WSC_AET_A_8226'
        row = bind.execute(sa.text("""
            SELECT id FROM competition
             WHERE import_code = :current
                OR import_code = :legacy
                OR (name IN (:name, :legacy_name) AND sport = :sport AND gender = :gender)
             ORDER BY CASE WHEN import_code = :legacy THEN 0
                           WHEN name IN (:name, :legacy_name) THEN 1 ELSE 2 END
             LIMIT 1
        """), {'current': import_code, 'legacy': legacy_code or import_code,
                'name': official_name, 'legacy_name': 'Mixed Aerials Team' if official_name == 'Aerials Team' else official_name,
                'sport': sport, 'gender': gender}).first()
        if row:
            competition_id = row[0]
            conflict = bind.execute(sa.text(
                "SELECT id FROM competition WHERE import_code=:current AND id<>:id"
            ), {'current': import_code, 'id': competition_id}).first()
            if conflict:
                conflict_id = conflict[0]
                bind.execute(sa.text("""
                    INSERT INTO athlete_competition (athlete_id, competition_id, created_at)
                    SELECT athlete_id, :kept, created_at FROM athlete_competition
                    WHERE competition_id=:removed ON CONFLICT DO NOTHING
                """), {'kept': competition_id, 'removed': conflict_id})
                bind.execute(sa.text(
                    "DELETE FROM event_competition WHERE competition_id=:removed"
                ), {'removed': conflict_id})
                bind.execute(sa.text(
                    "DELETE FROM competition WHERE id=:removed"
                ), {'removed': conflict_id})
            bind.execute(sa.text("""
                UPDATE competition SET import_code=:import_code, code=:codex, name=:name,
                    display_name=:display_name, sport=:sport, gender=:gender,
                    team_competition=:team, quota_discipline=:quota, active=true
                WHERE id=:id
            """), {'id': competition_id, 'import_code': import_code, 'codex': codex,
                    'name': official_name, 'display_name': display_name, 'sport': sport,
                    'gender': gender, 'team': team, 'quota': quota})
        else:
            competition_id = bind.execute(sa.text("""
                INSERT INTO competition (import_code, code, name, display_name, sport, gender,
                    team_competition, quota_discipline, active)
                VALUES (:import_code, :codex, :name, :display_name, :sport, :gender, :team, :quota, true)
                RETURNING id
            """), {'import_code': import_code, 'codex': codex, 'name': official_name,
                    'display_name': display_name, 'sport': sport, 'gender': gender,
                    'team': team, 'quota': quota}).scalar_one()
        retained.append(competition_id)
        mapping = bind.execute(sa.text("""
            SELECT id FROM event_competition WHERE event_id=:event_id AND competition_id=:competition_id
        """), {'event_id': event_id, 'competition_id': competition_id}).first()
        values = {'event_id': event_id, 'competition_id': competition_id, 'codex': codex,
                  'import_code': import_code, 'official_name': official_name}
        if mapping:
            values['id'] = mapping[0]
            bind.execute(sa.text("""
                UPDATE event_competition SET fis_codex=:codex, import_code=:import_code,
                    official_name=:official_name, active=true WHERE id=:id
            """), values)
        else:
            bind.execute(sa.text("""
                INSERT INTO event_competition
                    (event_id, competition_id, fis_codex, import_code, official_name, active)
                VALUES (:event_id, :competition_id, :codex, :import_code, :official_name, true)
            """), values)
    bind.execute(sa.text("""
        UPDATE event_competition SET active=false
        WHERE event_id=:event_id AND competition_id NOT IN :retained
    """).bindparams(sa.bindparam('retained', expanding=True)),
        {'event_id': event_id, 'retained': retained})


def _upgrade_offline():
    # Keep the online path above intact. These same decisions run on PostgreSQL
    # when the rendered script is applied, where query results are available.
    catalogue = []
    for position, values in enumerate(CURRENT_2027):
        import_code, _, name, sport, gender, *_ = values
        legacy = LEGACY_BY_IDENTITY.get((name, sport, gender)) or import_code
        legacy_name = 'Mixed Aerials Team' if name == 'Aerials Team' else name
        row = (position, *values, legacy, legacy_name)
        catalogue.append('(' + ', '.join(str(sa.literal(value).compile(
            dialect=op.get_bind().dialect, compile_kwargs={'literal_binds': True}
        )) for value in row) + ')')
    op.execute("""
        DO $catalogue$
        DECLARE
            item record;
            selected_event integer;
            selected_competition integer;
            conflicting_competition integer;
            selected_mapping integer;
            retained integer[] := ARRAY[]::integer[];
        BEGIN
            SELECT id INTO STRICT selected_event FROM championship_event
            WHERE name = 'WSC Montafon 2027';
            FOR item IN SELECT * FROM (VALUES
        """ + ',\n'.join(catalogue) + """
            ) AS catalogue(position, import_code, codex, official_name, sport, gender,
                           team, display_name, quota, legacy_code, legacy_name)
            ORDER BY position LOOP
                SELECT c.id INTO selected_competition FROM competition c
                WHERE c.import_code = item.import_code OR c.import_code = item.legacy_code
                   OR (c.name IN (item.official_name, item.legacy_name)
                       AND c.sport = item.sport AND c.gender = item.gender)
                ORDER BY CASE WHEN c.import_code = item.legacy_code THEN 0
                              WHEN c.name IN (item.official_name, item.legacy_name) THEN 1 ELSE 2 END
                LIMIT 1;
                IF FOUND THEN
                    SELECT c.id INTO conflicting_competition FROM competition c
                    WHERE c.import_code = item.import_code AND c.id <> selected_competition;
                    IF FOUND THEN
                        INSERT INTO athlete_competition (athlete_id, competition_id, created_at)
                        SELECT athlete_id, selected_competition, created_at FROM athlete_competition
                        WHERE competition_id = conflicting_competition ON CONFLICT DO NOTHING;
                        DELETE FROM event_competition WHERE competition_id = conflicting_competition;
                        DELETE FROM competition WHERE id = conflicting_competition;
                    END IF;
                    UPDATE competition SET import_code = item.import_code, code = item.codex,
                        name = item.official_name, display_name = item.display_name,
                        sport = item.sport, gender = item.gender, team_competition = item.team,
                        quota_discipline = item.quota, active = true
                    WHERE id = selected_competition;
                ELSE
                    INSERT INTO competition (import_code, code, name, display_name, sport, gender,
                                             team_competition, quota_discipline, active)
                    VALUES (item.import_code, item.codex, item.official_name, item.display_name,
                            item.sport, item.gender, item.team, item.quota, true)
                    RETURNING id INTO selected_competition;
                END IF;
                retained := array_append(retained, selected_competition);
                SELECT id INTO selected_mapping FROM event_competition
                WHERE event_id = selected_event AND competition_id = selected_competition;
                IF FOUND THEN
                    UPDATE event_competition SET fis_codex = item.codex,
                        import_code = item.import_code, official_name = item.official_name, active = true
                    WHERE id = selected_mapping;
                ELSE
                    INSERT INTO event_competition
                        (event_id, competition_id, fis_codex, import_code, official_name, active)
                    VALUES (selected_event, selected_competition, item.codex, item.import_code,
                            item.official_name, true);
                END IF;
            END LOOP;
            UPDATE event_competition SET active = false
            WHERE event_id = selected_event AND competition_id <> ALL(retained);
        END
        $catalogue$;
    """)


def downgrade():
    # This is a corrective data migration. Restoring obsolete FIS identifiers
    # would be unsafe, so downgrade intentionally keeps the reconciled data.
    pass
