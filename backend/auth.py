from dataclasses import dataclass
from functools import wraps
import re
import secrets

from flask import current_app, g, jsonify, request


ROLE_PERMISSIONS = {
    'incoming-viewer': {'data.read'},
    'incoming-editor': {'data.read', 'data.write', 'assignments.write', 'imports.write'},
    'incoming-admin': {'*'},
    'admin': {'*'},
}


@dataclass(frozen=True)
class AuthenticatedUser:
    username: str
    display_name: str
    email: str
    groups: tuple[str, ...]
    permissions: frozenset[str]

    def has_permission(self, permission: str) -> bool:
        return '*' in self.permissions or permission in self.permissions

    def to_dict(self):
        return {
            'username': self.username,
            'displayName': self.display_name,
            'email': self.email,
            'groups': list(self.groups),
            'permissions': sorted(self.permissions),
        }


def _split_groups(value: str) -> tuple[str, ...]:
    return tuple(sorted({group.strip().lower() for group in re.split(r'[,;|]', value or '') if group.strip()}))


def _permissions(groups: tuple[str, ...]) -> frozenset[str]:
    permissions = set()
    for group in groups:
        permissions.update(ROLE_PERMISSIONS.get(group, set()))
    return frozenset(permissions)


def load_user_from_request():
    expected_proxy_secret = current_app.config.get('AUTH_PROXY_SECRET', '')
    supplied_proxy_secret = request.headers.get('X-Auth-Proxy-Secret', '')
    dev_user = current_app.config.get('AUTH_DEV_USER', '')
    if not expected_proxy_secret and not dev_user:
        return None
    if expected_proxy_secret and not secrets.compare_digest(expected_proxy_secret, supplied_proxy_secret):
        return None
    username = request.headers.get('X-Authenticated-User', '').strip()
    groups = _split_groups(request.headers.get('X-Authenticated-Groups', ''))

    # Explicit opt-in for local development only. Never set this in production.
    if not username and dev_user:
        username = dev_user.strip()
        groups = _split_groups(current_app.config.get('AUTH_DEV_GROUPS', 'incoming-admin'))

    if not username:
        return None

    return AuthenticatedUser(
        username=username,
        display_name=request.headers.get('X-Authenticated-Name', username).strip() or username,
        email=request.headers.get('X-Authenticated-Email', '').strip(),
        groups=groups,
        permissions=_permissions(groups),
    )


def current_user():
    return getattr(g, 'current_user', None)


def require_permission(permission):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            user = current_user()
            if user is None:
                return jsonify({'error': 'UNAUTHENTICATED', 'message': 'Authentication required'}), 401
            if not user.has_permission(permission):
                return jsonify({'error': 'FORBIDDEN', 'message': 'Insufficient permissions'}), 403
            return view(*args, **kwargs)
        return wrapped
    return decorator
