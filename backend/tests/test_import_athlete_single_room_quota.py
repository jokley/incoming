from flask import Flask
import pytest

from excel_import import build_quota_warnings
from models import db
from quota_service import evaluate_quota_usage


@pytest.fixture()
def database():
    app = Flask(__name__)
    app.config.update(
        SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
    )
    db.init_app(app)
    with app.app_context():
        db.create_all()
        yield
        db.session.remove()
        db.drop_all()


def person(key, disciplines, *, function='Athlete', single=True):
    return {
        'matchKey': key,
        'fisCode': key,
        'firstname': key,
        'lastname': 'Person',
        'nationCode': 'BRA',
        'industryName': disciplines[0],
        'discipline': disciplines[0],
        'quotaDisciplines': disciplines,
        'gender': 'M',
        'function': function,
        'countsAsSingle': single,
    }


def room(key):
    return {'person1Key': key, 'person2Key': None, 'roomType': 'Single'}


def rows_by_discipline(people):
    return {row['discipline']: row for row in evaluate_quota_usage(people, people)}


def test_single_competition_athlete_single_request_counts_once():
    rows = rows_by_discipline([person('NOAH', ['Snowboard Cross'])])

    assert rows['Snowboard Cross']['singleRoomsUsed'] == 1


def test_multi_competition_athlete_single_request_counts_in_each_distinct_group():
    rows = rows_by_discipline([
        person('LUCA', ['Snowboard Big Air', 'Snowboard Slopestyle']),
    ])

    assert rows['Snowboard Big Air']['singleRoomsUsed'] == 1
    assert rows['Snowboard Slopestyle']['singleRoomsUsed'] == 1


def test_competitions_with_same_quota_discipline_count_athlete_single_once():
    rows = rows_by_discipline([person('MOGUL', ['Moguls', 'Moguls'])])

    assert rows['Moguls']['singleRoomsUsed'] == 1


def test_real_brazil_groups_are_within_single_room_quota():
    people = [
        person('LUCA', ['Snowboard Big Air', 'Snowboard Slopestyle']),
        person('NOAH', ['Snowboard Cross']),
        person('PATRICK', ['Snowboard Halfpipe']),
        person('AUGUSTINHO', ['Snowboard Halfpipe']),
    ]
    rows = rows_by_discipline(people)

    assert {
        discipline: (row['singleRoomsUsed'], row['singleRoomsAllowed'])
        for discipline, row in rows.items()
    } == {
        'Snowboard Big Air': (1, 1),
        'Snowboard Slopestyle': (1, 1),
        'Snowboard Cross': (1, 1),
        'Snowboard Halfpipe': (2, 2),
    }


def test_three_halfpipe_athletes_create_one_person_single_room_excess(database):
    people = [
        person('PATRICK', ['Snowboard Halfpipe']),
        person('AUGUSTINHO', ['Snowboard Halfpipe']),
        person('THIRD', ['Snowboard Halfpipe']),
    ]

    warnings = build_quota_warnings(people, [room(item['matchKey']) for item in people])
    warning = next(item for item in warnings
                   if item['code'] == 'QUOTA_SINGLE_ROOMS_EXCEEDED')

    assert warning['details']['importedSingleRooms'] == 3
    assert warning['details']['singleRoomsAllowed'] == 2
    assert warning['details']['excessCount'] == 1
    assert {candidate['personKey'] for candidate in warning['details']['singleRoomCandidates']} == {
        'PATRICK', 'AUGUSTINHO', 'THIRD',
    }


def test_existing_official_single_discipline_behavior_is_unchanged():
    official = person(
        'COACH', ['Snowboard Big Air', 'Snowboard Slopestyle'], function='NSA Coach')
    rows = rows_by_discipline([official])

    assert rows['Snowboard Big Air']['assignedOfficials'] == 1
    assert rows['Snowboard Big Air']['singleRoomsUsed'] == 1
    assert rows['Snowboard Slopestyle']['assignedOfficials'] == 0
    assert rows['Snowboard Slopestyle']['singleRoomsUsed'] == 0
