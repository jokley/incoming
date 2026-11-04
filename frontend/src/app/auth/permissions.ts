import type { AuthenticatedUser } from '../types';

export const AUTH_GROUPS = {
  admin: 'admin',
  editor: 'incoming-editor',
  viewer: 'incoming-viewer',
} as const;

export type AuthGroup = (typeof AUTH_GROUPS)[keyof typeof AUTH_GROUPS];

export interface Permissions {
  groups: string[];
  isAdmin: boolean;
  canManageUsers: boolean;
  isEditor: boolean;
  isViewer: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
  canManageHotels: boolean;
  canManageRoomTypes: boolean;
  canManageAssignments: boolean;
  canManageImports: boolean;
  canReadAudit: boolean;
  roleLabel: 'Admin' | 'Editor' | 'Viewer';
  isReadOnly: boolean;
}

export function normalizeGroups(groups: AuthenticatedUser['groups'] | string | null | undefined): string[] {
  if (!groups) return [];
  const source = Array.isArray(groups) ? groups : groups.split(',');
  return Array.from(new Set(source.map((group) => String(group).trim().toLowerCase()).filter(Boolean)));
}

export function buildPermissions(user: AuthenticatedUser | null): Permissions {
  const groups = normalizeGroups(user?.groups);
  const permissions = user?.permissions ?? [];
  const hasWildcard = permissions.includes('*');
  const isAdmin = groups.includes(AUTH_GROUPS.admin) || hasWildcard || user?.isSuperadmin === true;
  const isEditor = groups.includes(AUTH_GROUPS.editor) || permissions.includes('data.write');
  const isViewer = groups.includes(AUTH_GROUPS.viewer) || (!isAdmin && !isEditor);
  // Functional capabilities come from the server; group labels do not grant actions.
  const has = (permission: string) => hasWildcard || permissions.includes(permission);
  const canWrite = has('data.write');

  return {
    groups,
    isAdmin,
    canManageUsers: user?.isSuperadmin === true,
    isEditor,
    isViewer,
    canEdit: canWrite,
    canDelete: canWrite,
    canCreate: canWrite,
    canManageHotels: canWrite,
    canManageRoomTypes: canWrite,
    canManageAssignments: has('assignments.write'),
    canManageImports: has('imports.write'),
    canReadAudit: has('audit.read'),
    roleLabel: isAdmin ? 'Admin' : isEditor ? 'Editor' : 'Viewer',
    isReadOnly: !canWrite,
  };
}

export function withEventWriteAccess(permissions: Permissions, canWrite: boolean): Permissions {
  if (canWrite) return permissions;
  return { ...permissions, canEdit: false, canDelete: false, canCreate: false,
    canManageHotels: false, canManageRoomTypes: false, canManageAssignments: false,
    canManageImports: false, isReadOnly: true };
}
