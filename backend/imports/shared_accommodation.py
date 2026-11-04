"""Person-owned accommodation evidence; absence never means an explicit No room."""
from copy import deepcopy
from accommodation_requirements import source_requirement

FIELDS=('accommodationRequirement','accommodationRequirementSource','importAccommodationRequirement','accommodationRequirementReviewRequired','roomType','sharedWithName','arrivalDate','departureDate','lateCheckout','firstMeal','lastMeal','specialMeal')


def evidence(person, source):
    if 'sourceAccommodationEvidence' in person:return person['sourceAccommodationEvidence'].get('requirement')
    values=[person.get('roomType')]+[r.get('roomType') for r in source.get('rooms',[]) if person['matchKey'] in {r.get('person1Key'),r.get('person2Key')}]
    proposed=source_requirement(values)[0]
    return proposed or ('UNRESOLVED' if any(str(v or '').strip() for v in values) else None)


def periods_for(target,incoming):
    return [dict(arrivalDate=p.get('sourceAccommodationEvidence',p).get('arrivalDate'),departureDate=p.get('sourceAccommodationEvidence',p).get('departureDate')) for p in (target,incoming)]


def disjoint_periods(periods):
    return all(p['arrivalDate'] and p['departureDate'] for p in periods) and (str(periods[0]['departureDate'])<str(periods[1]['arrivalDate']) or str(periods[1]['departureDate'])<str(periods[0]['arrivalDate']))


def harmonize_missing(target, incoming, prior, source):
    fields=[f for f in FIELDS if f not in {'arrivalDate','departureDate'}] if disjoint_periods(periods_for(target,incoming)) else FIELDS
    left,right=evidence(target,prior),evidence(incoming,source)
    if left is None and right is not None:
        for field in fields:target[field]=deepcopy(incoming.get(field))
    elif right is None and left is not None:
        for field in fields:incoming[field]=deepcopy(target.get(field))
    return left,right


def issue(target,incoming,fields,left,right):
    periods=periods_for(target,incoming)
    disjoint=disjoint_periods(periods) and 'REQUIRED' in {left,right}
    return dict(code='IMPORT_SHARED_STAY_SECTIONS' if disjoint else 'IMPORT_SHARED_ACCOMMODATION_CONFLICT',
        message='Getrennte Aufenthaltsabschnitte: personenbezogene Bedarfsdaten enthalten nur ein Zeitfenster. Abschnitte gesondert klären; kein künstlicher durchgehender Aufenthalt.' if disjoint else 'Widersprüchliche explizite Unterkunftsangaben für dieselbe Person; mit Nation klären.',
        details=dict(personKey=target['matchKey'],fields=fields,requirements=[left,right],periods=periods,
            sourceRows=target.get('sourceRows',[])+incoming.get('sourceRows',[])))
