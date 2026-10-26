"""Explicit, person-bound tariff evidence; independent of EZ approvals and amounts."""
import json


def validate_tariff_selection(details, extent, keys, effect):
    if effect not in {'NONE', 'SPECIAL_SELECTED'}:
        raise ValueError('Tarifwirkung muss NONE oder SPECIAL_SELECTED sein.')
    if effect != 'SPECIAL_SELECTED':
        return
    # Total and gender limits overlap. The minimal union covers both boundaries;
    # e.g. total=4 and men=3 means four people, at least three of them men.
    count = max(extent['total'], extent['M'] + extent['F'])
    candidates = {p['personKey']: p for p in details['candidates']}
    if not count or len(set(keys)) != len(keys) or len(keys) != count or any(k not in candidates for k in keys):
        raise ValueError(f'Für Sondertarif genau {count} unterschiedliche Zusatzathleten auswählen; Gesamt- und Geschlechtergrenzen überlappen.')
    genders = [candidates[k].get('gender') for k in keys]
    if any(g not in {'M', 'F'} for g in genders) or any(genders.count(g) < extent[g] for g in ('M', 'F')):
        raise ValueError('Personenauswahl deckt den genehmigten Männer-/Frauenumfang nicht ab.')


def bind_tariff_selection(details, keys, own_id, applicable_ids):
    if details.get('tariffEffect') != 'SPECIAL_SELECTED':
        return
    from models import db, ImportApproval
    others = db.session.scalars(db.select(ImportApproval).where(ImportApproval.id.in_(set(applicable_ids)-{own_id}))).all()
    previous = []
    for other in others:
        evidence = json.loads(other.quota_details_json or '{}')
        if evidence.get('tariffEffect') == 'SPECIAL_SELECTED':
            previous.append((evidence, set(json.loads(other.approved_person_keys_json or '[]'))))
    genders = {p['personKey']: p.get('gender') for p in details['candidates']}
    boundaries = {}
    for boundary, amount in details['approvedExtent'].items():
        used = {key for evidence, _ in previous for key in evidence.get('approvedPersonKeysByBoundary', {}).get(boundary, [])}
        available = [key for key in keys if key not in used and (boundary == 'total' or genders.get(key) == boundary)]
        if len(available) < amount:
            raise ValueError('Personenauswahl zählt dieselbe Person erneut an derselben Quotengrenze. Für diese Grenze andere Personen wählen.')
        boundaries[boundary] = available[:amount]
    # Across partial decisions, total/gender limits may cover the same selected
    # person. Charge the union once; never add overlapping boundary quantities.
    cumulative = {b: details['approvedExtent'][b] + sum(e['approvedExtent'][b] for e, _ in previous) for b in ('total', 'M', 'F')}
    union = set(keys).union(*(selected for _, selected in previous))
    if len(union) != max(cumulative['total'], cumulative['M'] + cumulative['F']):
        raise ValueError('Teilgenehmigungen müssen eine gemeinsame eindeutige Personenauswahl abdecken. Überlappende Gesamt-/Geschlechtergrenzen nicht als zusätzliche kostenpflichtige Personen addieren.')
    details['approvedPersonKeysByBoundary'] = boundaries


def project_tariffs(preview, approvals):
    """Only current-scope approvals with explicit new tariff consent are applied.

    Historical approvals without tariffEffect remain evidence-only. Existing
    persisted APPROVAL tariffs survive reimport, but are not new quota evidence.
    Manual tariffs/overrides always win. No database writes or per-person reads.
    """
    preview['warnings'] = [w for w in preview.get('warnings', []) if w.get('code') != 'ATHLETE_TARIFF_UNRESOLVED']
    preview['errors'] = [e for e in preview.get('errors', []) if e.get('code') != 'ATHLETE_TARIFF_EVIDENCE_INVALID']
    by_id = {a.id: a for a in approvals}
    legacy = set()
    affected = {}
    for row in preview.get('athleteQuotaChecks', []):
        for approval_id in row.get('approvalIds', []):
            approval = by_id[approval_id]
            details = json.loads(approval.quota_details_json or '{}')
            if 'tariffEffect' not in details:
                legacy.add(approval_id)
            if details.get('tariffEffect') != 'SPECIAL_SELECTED':
                continue
            keys = json.loads(approval.approved_person_keys_json or '[]')
            # Fail closed for malformed historical evidence; never guess people.
            try:
                validate_tariff_selection(details, details['approvedExtent'], keys, 'SPECIAL_SELECTED')
            except (ValueError, KeyError, TypeError):
                preview['errors'].append({'code':'ATHLETE_TARIFF_EVIDENCE_INVALID','message':'Personenbezogene Tarifwirkung der Athletenquoten-Genehmigung muss erneut geprüft werden.','details':{'approvalId':approval_id}})
                preview['isValid'] = False
                continue
            for key in keys:
                affected.setdefault(key, set()).add(approval_id)
    for person in preview.get('people', []):
        ids = sorted(affected.get(str(person.get('matchKey') or person.get('personId')), ()))
        if ids:
            person['accommodationRateApprovalIds'] = ids
            if person.get('accommodationRateSource') == 'MANUAL':
                person['accommodationRateExplanation'] = 'Manuell festgelegter Tarif bleibt erhalten; Athletenquoten-Genehmigung sieht Sondertarif vor. Preisliche Festlegung offen.'
            else:
                person.update(accommodationRateCategory='SPECIAL', accommodationRateSource='APPROVAL', accommodationRateApprovalId=ids[0],
                    accommodationRateExplanation='Sondertarif aus personenbezogener Athletenquoten-Genehmigung. Preisliche Festlegung offen.')
        elif person.get('accommodationRateSource') == 'APPROVAL':
            person['accommodationRateExplanation'] = 'Gespeicherter genehmigter Sondertarif bleibt erhalten. Anwendbarkeit im neuen Meldestand und preisliche Festlegung prüfen.'

    if legacy:
        preview['warnings'].append({'code':'ATHLETE_TARIFF_UNRESOLVED','message':'Bestehende Athletenquoten-Genehmigung ohne ausdrückliche personenbezogene Tarifwirkung. Für kostenpflichtige Zusatzathleten Entscheidung gezielt revidieren; kein Tarif wird rückwirkend geändert.','details':{'approvalIds':sorted(legacy)}})

    preview['isValid'] = not preview['errors']
