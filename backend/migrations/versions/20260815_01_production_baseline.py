"""Production baseline: canonical schema for empty databases.

Revision ID: 20260815_01
Revises:
Create Date: 2026-08-15
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260815_01"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'audit_event',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('created_at', sa.DateTime, nullable=False),
        sa.Column('username', sa.String(100), nullable=False),
        sa.Column('display_name', sa.String(200)),
        sa.Column('email', sa.String(200)),
        sa.Column('groups_json', sa.Text, nullable=False),
        sa.Column('action', sa.String(20), nullable=False),
        sa.Column('entity_type', sa.String(100), nullable=False),
        sa.Column('entity_id', sa.String(100)),
        sa.Column('request_id', sa.String(36), nullable=False),
        sa.Column('method', sa.String(10), nullable=False),
        sa.Column('path', sa.String(500), nullable=False),
        sa.Column('changes_json', sa.Text),
        sa.Column('activity', sa.String(200)),
        sa.Column('category', sa.String(50)),
        sa.Column('entity_label', sa.String(300)),
        sa.Column('details_json', sa.Text),
        sa.Column('entity_refs_json', sa.Text, nullable=False),
    )
    op.create_table(
        'import_run',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('import_type', sa.String(50), nullable=False),
        sa.Column('started_at', sa.DateTime, nullable=False),
        sa.Column('finished_at', sa.DateTime),
    )
    op.create_table(
        'room_type',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('max_persons', sa.Integer, nullable=False),
        sa.Column('created_at', sa.DateTime),
        sa.UniqueConstraint('name', name='uq_room_type_name'),
    )
    op.create_table(
        'hotel',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('location', sa.String(100)),
        sa.Column('region', sa.String(100)),
        sa.Column('created_at', sa.DateTime),
    )
    op.create_table(
        'hotel_room_inventory',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('hotel_id', sa.Integer, nullable=False),
        sa.Column('room_type_id', sa.Integer, nullable=False),
        sa.Column('available_from', sa.Date, nullable=False),
        sa.Column('available_until', sa.Date, nullable=False),
        sa.Column('room_count', sa.Integer, nullable=False),
        sa.Column('has_half_board', sa.Boolean),
        sa.Column('has_sr', sa.Boolean),
        sa.Column('created_at', sa.DateTime),
        sa.ForeignKeyConstraint(['hotel_id'], ['hotel.id'], name='fk_hotel_room_inventory_hotel_id_hotel'),
        sa.ForeignKeyConstraint(['room_type_id'], ['room_type.id'], name='fk_hotel_room_inventory_room_type_id_room_type'),
    )
    op.create_table(
        'event',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('discipline', sa.String(100), nullable=False),
        sa.Column('start_date', sa.Date, nullable=False),
        sa.Column('end_date', sa.Date, nullable=False),
        sa.Column('person_demand', sa.Integer, nullable=False),
        sa.Column('single_room_percentage', sa.Integer, nullable=False),
        sa.Column('created_at', sa.DateTime),
    )
    op.create_table(
        'event_room_demand',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('event_id', sa.Integer, nullable=False),
        sa.Column('room_type_id', sa.Integer, nullable=False),
        sa.Column('room_count', sa.Integer, nullable=False),
        sa.Column('created_at', sa.DateTime),
        sa.ForeignKeyConstraint(['event_id'], ['event.id'], name='fk_event_room_demand_event_id_event'),
        sa.ForeignKeyConstraint(['room_type_id'], ['room_type.id'], name='fk_event_room_demand_room_type_id_room_type'),
    )
    op.create_table(
        'room_booking',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('hotel_id', sa.Integer, nullable=False),
        sa.Column('room_type_id', sa.Integer, nullable=False),
        sa.Column('room_number', sa.String(20)),
        sa.Column('check_in_date', sa.Date),
        sa.Column('check_out_date', sa.Date),
        sa.Column('counts_as_single', sa.Boolean),
        sa.Column('created_at', sa.DateTime),
        sa.ForeignKeyConstraint(['hotel_id'], ['hotel.id'], name='fk_room_booking_hotel_id_hotel'),
        sa.ForeignKeyConstraint(['room_type_id'], ['room_type.id'], name='fk_room_booking_room_type_id_room_type'),
    )
    op.create_table(
        'import_session',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('nation', sa.String(10), nullable=False),
        sa.Column('discipline', sa.String(100)),
        sa.Column('status', sa.String(30), nullable=False),
        sa.Column('current_version_id', sa.Integer),
        sa.Column('created_at', sa.DateTime, nullable=False),
        sa.Column('updated_at', sa.DateTime, nullable=False),
        sa.Column('approved_at', sa.DateTime),
        sa.Column('approved_by', sa.String(100)),
        sa.Column('imported_at', sa.DateTime),
        sa.Column('archived_at', sa.DateTime),
        sa.Column('replaced_by_id', sa.Integer),
        sa.Column('error_message', sa.Text),
        sa.ForeignKeyConstraint(['replaced_by_id'], ['import_session.id'], name='fk_import_session_replaced_by_id_import_session'),
        *([sa.ForeignKeyConstraint(['current_version_id'], ['import_session_version.id'], name='fk_import_session_current_version_id_import_session_version')] if op.get_bind().dialect.name == 'sqlite' else []),
    )
    op.create_table(
        'import_session_version',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('session_id', sa.Integer, nullable=False),
        sa.Column('version', sa.Integer, nullable=False),
        sa.Column('preview_token', sa.String(64)),
        sa.Column('preview_json', sa.Text),
        sa.Column('entries_filename', sa.String(255)),
        sa.Column('room_filename', sa.String(255)),
        sa.Column('uploaded_by', sa.String(100), nullable=False),
        sa.Column('created_at', sa.DateTime, nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['import_session.id'], name='fk_import_session_version_session_id_import_session'),
        sa.UniqueConstraint('session_id', 'version', name='uq_import_session_version'),
    )
    op.create_table(
        'import_approval',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('session_id', sa.Integer, nullable=False),
        sa.Column('version_id', sa.Integer),
        sa.Column('nation', sa.String(10), nullable=False),
        sa.Column('approval_type', sa.String(50), nullable=False),
        sa.Column('description', sa.Text, nullable=False),
        sa.Column('decision', sa.String(30), nullable=False),
        sa.Column('comment', sa.Text),
        sa.Column('approval_method', sa.String(20)),
        sa.Column('approval_by', sa.String(200)),
        sa.Column('approval_date', sa.DateTime),
        sa.Column('contact_subject', sa.String(300)),
        sa.Column('cost_coverage', sa.String(300)),
        sa.Column('deadline_at', sa.DateTime),
        sa.Column('approved_person_keys_json', sa.Text),
        sa.Column('quota_details_json', sa.Text),
        sa.Column('username', sa.String(100), nullable=False),
        sa.Column('created_at', sa.DateTime, nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['import_session.id'], name='fk_import_approval_session_id_import_session'),
        sa.ForeignKeyConstraint(['version_id'], ['import_session_version.id'], name='fk_import_approval_version_id_import_session_version'),
    )
    op.create_table(
        'import_session_event',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('session_id', sa.Integer, nullable=False),
        sa.Column('version_id', sa.Integer),
        sa.Column('approval_id', sa.Integer),
        sa.Column('event_type', sa.String(50), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('description', sa.Text),
        sa.Column('username', sa.String(100), nullable=False),
        sa.Column('created_at', sa.DateTime, nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['import_session.id'], name='fk_import_session_event_session_id_import_session'),
        sa.ForeignKeyConstraint(['version_id'], ['import_session_version.id'], name='fk_import_session_event_version_id_import_session_version'),
        sa.ForeignKeyConstraint(['approval_id'], ['import_approval.id'], name='fk_import_session_event_approval_id_import_approval'),
    )
    op.create_table(
        'athlete',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('function', sa.String(50)),
        sa.Column('competitor_id', sa.String(50)),
        sa.Column('accred_id', sa.String(50)),
        sa.Column('fis_code', sa.String(50)),
        sa.Column('lastname', sa.String(100), nullable=False),
        sa.Column('firstname', sa.String(100), nullable=False),
        sa.Column('nation_code', sa.String(10), nullable=False),
        sa.Column('discipline', sa.String(100)),
        sa.Column('gender', sa.String(10)),
        sa.Column('for_gender', sa.String(10)),
        sa.Column('phone', sa.String(50)),
        sa.Column('email', sa.String(100)),
        sa.Column('present', sa.Boolean),
        sa.Column('wc_sbx_w', sa.Boolean),
        sa.Column('wc_sbx_m', sa.Boolean),
        sa.Column('arrival_date', sa.Date),
        sa.Column('arrival_time', sa.String(20)),
        sa.Column('arrival_by', sa.String(50)),
        sa.Column('arrival_airport', sa.String(50)),
        sa.Column('arrival_airport_name', sa.String(100)),
        sa.Column('arrival_flight_no', sa.String(50)),
        sa.Column('arrival_need_transportation', sa.Boolean),
        sa.Column('departure_date', sa.Date),
        sa.Column('departure_time', sa.String(20)),
        sa.Column('departure_by', sa.String(50)),
        sa.Column('departure_airport', sa.String(50)),
        sa.Column('departure_airport_name', sa.String(100)),
        sa.Column('departure_flight_no', sa.String(50)),
        sa.Column('departure_need_transportation', sa.Boolean),
        sa.Column('room_type', sa.String(50)),
        sa.Column('single_room_entitlement', sa.String(30)),
        sa.Column('single_room_status', sa.String(30), nullable=False),
        sa.Column('single_room_decision_id', sa.Integer, nullable=True),
        sa.Column('shared_with_name', sa.String(200)),
        sa.Column('late_checkout', sa.Boolean),
        sa.Column('first_meal', sa.String(50)),
        sa.Column('last_meal', sa.String(50)),
        sa.Column('special_meal', sa.String(200)),
        sa.Column('additional_items', sa.String(200)),
        sa.Column('stance', sa.String(10)),
        sa.Column('tv_picture_status', sa.String(100)),
        sa.Column('tv_picture_date', sa.Date),
        sa.Column('entry_date', sa.DateTime),
        sa.Column('last_update', sa.DateTime),
        sa.Column('entries_sent_date', sa.DateTime),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.Column('athletes_last_seen_at', sa.DateTime),
        sa.Column('roomlist_last_seen_at', sa.DateTime),
        sa.Column('roomlist_changed_at', sa.DateTime),
        sa.Column('roomlist_change_summary', sa.String(500)),
        sa.Column('import_change_types_json', sa.Text),
        sa.Column('roomlist_change_acknowledged_at', sa.DateTime),
        sa.Column('roomlist_change_acknowledged_summary', sa.String(500)),
        sa.ForeignKeyConstraint(['single_room_decision_id'], ['import_approval.id'], name='fk_athlete_single_room_decision_id_import_approval'),
        sa.CheckConstraint(
            "single_room_status IN ('NONE', 'IN_QUOTA', 'APPROVED_EXTRA', 'PENDING_APPROVAL')",
            name=op.f('ck_athlete_single_room_status'),
        ),
    )
    op.create_table(
        'fis_room_assignment',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('import_run_id', sa.Integer, nullable=True),
        sa.Column('source_row_key', sa.String(200), nullable=False),
        sa.Column('room_type', sa.String(50), nullable=False),
        sa.Column('person1_id', sa.Integer, nullable=False),
        sa.Column('person2_id', sa.Integer, nullable=True),
        sa.Column('shared_with_raw_name', sa.String(200)),
        sa.Column('shared_with_nation_code', sa.String(10)),
        sa.Column('hotel_id', sa.Integer, nullable=True),
        sa.Column('room_number', sa.String(20)),
        sa.Column('check_in_date', sa.Date),
        sa.Column('check_out_date', sa.Date),
        sa.Column('nightly_snapshot', sa.Text),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.ForeignKeyConstraint(['import_run_id'], ['import_run.id'], name='fk_fis_room_assignment_import_run_id_import_run'),
        sa.UniqueConstraint('source_row_key', name='uq_fis_room_assignment_source_row_key'),
        sa.ForeignKeyConstraint(['person1_id'], ['athlete.id'], name='fk_fis_room_assignment_person1_id_athlete'),
        sa.ForeignKeyConstraint(['person2_id'], ['athlete.id'], name='fk_fis_room_assignment_person2_id_athlete'),
        sa.ForeignKeyConstraint(['hotel_id'], ['hotel.id'], name='fk_fis_room_assignment_hotel_id_hotel'),
    )
    op.create_table(
        'room_assignment',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('athlete_id', sa.Integer, nullable=False),
        sa.Column('hotel_id', sa.Integer, nullable=False),
        sa.Column('room_type_id', sa.Integer, nullable=False),
        sa.Column('room_number', sa.String(20)),
        sa.Column('check_in_date', sa.Date),
        sa.Column('check_out_date', sa.Date),
        sa.Column('shared_with_athlete_id', sa.Integer, nullable=True),
        sa.Column('created_at', sa.DateTime),
        sa.ForeignKeyConstraint(['athlete_id'], ['athlete.id'], name='fk_room_assignment_athlete_id_athlete'),
        sa.ForeignKeyConstraint(['hotel_id'], ['hotel.id'], name='fk_room_assignment_hotel_id_hotel'),
        sa.ForeignKeyConstraint(['room_type_id'], ['room_type.id'], name='fk_room_assignment_room_type_id_room_type'),
        sa.ForeignKeyConstraint(['shared_with_athlete_id'], ['athlete.id'], name='fk_room_assignment_shared_with_athlete_id_athlete'),
    )
    op.create_table(
        'room_booking_occupant',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('room_booking_id', sa.Integer, nullable=False),
        sa.Column('athlete_id', sa.Integer, nullable=False),
        sa.Column('role', sa.String(50), nullable=True),
        sa.Column('created_at', sa.DateTime),
        sa.ForeignKeyConstraint(['room_booking_id'], ['room_booking.id'], name='fk_room_booking_occupant_room_booking_id_room_booking'),
        sa.ForeignKeyConstraint(['athlete_id'], ['athlete.id'], name='fk_room_booking_occupant_athlete_id_athlete'),
        sa.UniqueConstraint('room_booking_id', 'athlete_id', name='uq_room_booking_athlete'),
    )
    op.create_index('ix_audit_event_created_at', 'audit_event', ['created_at'], unique=False)
    op.create_index('ix_audit_event_username', 'audit_event', ['username'], unique=False)
    op.create_index('ix_audit_event_action', 'audit_event', ['action'], unique=False)
    op.create_index('ix_audit_event_entity_type', 'audit_event', ['entity_type'], unique=False)
    op.create_index('ix_audit_event_entity_id', 'audit_event', ['entity_id'], unique=False)
    op.create_index('ix_audit_event_request_id', 'audit_event', ['request_id'], unique=False)
    op.create_index('ix_import_session_nation', 'import_session', ['nation'], unique=True)
    op.create_index('ix_import_session_status', 'import_session', ['status'], unique=False)
    op.create_index('ix_import_session_version_session_id', 'import_session_version', ['session_id'], unique=False)
    op.create_index('ix_import_session_event_session_id', 'import_session_event', ['session_id'], unique=False)
    op.create_index('ix_import_session_event_version_id', 'import_session_event', ['version_id'], unique=False)
    op.create_index('ix_import_session_event_approval_id', 'import_session_event', ['approval_id'], unique=False)
    op.create_index('ix_import_approval_session_id', 'import_approval', ['session_id'], unique=False)
    op.create_index('ix_import_approval_version_id', 'import_approval', ['version_id'], unique=False)
    if op.get_bind().dialect.name != 'sqlite':
        op.create_foreign_key('fk_import_session_current_version_id_import_session_version', 'import_session', 'import_session_version', ['current_version_id'], ['id'])


def downgrade() -> None:
    if op.get_bind().dialect.name != 'sqlite':
        op.drop_constraint(
            'fk_import_session_current_version_id_import_session_version',
            'import_session',
            type_='foreignkey',
        )
    op.drop_index('ix_import_approval_version_id', table_name='import_approval')
    op.drop_index('ix_import_approval_session_id', table_name='import_approval')
    op.drop_index('ix_import_session_event_approval_id', table_name='import_session_event')
    op.drop_index('ix_import_session_event_version_id', table_name='import_session_event')
    op.drop_index('ix_import_session_event_session_id', table_name='import_session_event')
    op.drop_index('ix_import_session_version_session_id', table_name='import_session_version')
    op.drop_index('ix_import_session_status', table_name='import_session')
    op.drop_index('ix_import_session_nation', table_name='import_session')
    op.drop_index('ix_audit_event_request_id', table_name='audit_event')
    op.drop_index('ix_audit_event_entity_id', table_name='audit_event')
    op.drop_index('ix_audit_event_entity_type', table_name='audit_event')
    op.drop_index('ix_audit_event_action', table_name='audit_event')
    op.drop_index('ix_audit_event_username', table_name='audit_event')
    op.drop_index('ix_audit_event_created_at', table_name='audit_event')
    op.drop_table('room_booking_occupant')
    op.drop_table('room_assignment')
    op.drop_table('fis_room_assignment')
    op.drop_table('athlete')
    op.drop_table('import_session_event')
    op.drop_table('import_approval')
    op.drop_table('import_session_version')
    op.drop_table('import_session')
    op.drop_table('room_booking')
    op.drop_table('event_room_demand')
    op.drop_table('event')
    op.drop_table('hotel_room_inventory')
    op.drop_table('hotel')
    op.drop_table('room_type')
    op.drop_table('import_run')
    op.drop_table('audit_event')
