from __future__ import annotations


def normalize_discipline(discipline: str | None) -> str:
    value = (discipline or "").strip().lower()
    aliases = {
        "sbx": "snowboard",
        "snowboard cross": "snowboard",
        "snowboard": "snowboard",
        "freestyle": "freestyle",
        "freeski": "freeski",
        "ski": "freeski",
    }
    return aliases.get(value, value)


def is_supported_discipline(discipline: str | None) -> bool:
    return normalize_discipline(discipline) in {"snowboard", "freestyle", "freeski"}


def compute_official_quota(athletes_entered: int, allowance: int = 2) -> int:
    """Supported model: officials = athletes + the validated event allowance.

    See FIS Snowboard/Freestyle/Freeski Championships rule excerpt:
    total number of officials equals number of entered athletes plus 2 team officials.
    """
    if athletes_entered <= 0:
        return 0
    return athletes_entered + allowance


def compute_single_room_entitlement(officials: int, tiers=None) -> int:
    if officials <= 0:
        return 0
    if tiers is None:
        from quota_rules import standard_rules
        tiers = standard_rules()['singleRooms']
    return next(tier['rooms'] for tier in tiers if tier['upTo'] is None or officials <= tier['upTo'])
