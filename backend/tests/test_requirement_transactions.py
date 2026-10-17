"""Real PostgreSQL race: NO_ROOM and booking creation cannot both commit."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from test_segment_transactions import state, app, headers, payload, url
from models import Athlete, RoomBookingOccupant, db


def test_concurrent_no_room_and_assignment_serialize(state):
    person=state[0][0];barrier=Barrier(2)
    def update_requirement():
        barrier.wait()
        return app.test_client().patch(f'/api/athletes/{person}',json={'accommodationRequirement':'NO_ROOM'},headers=headers).status_code
    def assign():
        barrier.wait()
        return app.test_client().post(url(person),json=payload(state,14,27),headers=headers).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        first=pool.submit(update_requirement);second=pool.submit(assign)
        codes=first.result(),second.result()
    assert codes in {(200,400),(409,201)},codes
    with app.app_context():
        person=db.session.get(Athlete,person)
        booked=RoomBookingOccupant.query.filter_by(athlete_id=person.id).count()
        assert (person.accommodation_requirement,booked) in {('NO_ROOM',0),('REQUIRED',1)}
