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
  isEditor: boolean;
  isViewer: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canCreate: boolean;
  canManageHotels: boolean;
  canManageRoomTypes: boolean;
  canManageAssignments: boolean;
  canManageImports: boolean;
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
  const isAdmin = groups.includes(AUTH_GROUPS.admin) || hasWildcard;
  const isEditor = groups.includes(AUTH_GROUPS.editor) || permissions.includes('data.write');
  const isViewer = groups.includes(AUTH_GROUPS.viewer) || (!isAdmin && !isEditor);
  const canWrite = isAdmin || isEditor;

  return {
    groups,
    isAdmin,
    isEditor,
    isViewer,
    canEdit: canWrite,
    canDelete: canWrite,
    canCreate: canWrite,
    canManageHotels: canWrite,
    canManageRoomTypes: canWrite,
    canManageAssignments: canWrite,
    canManageImports: isAdmin || isEditor || permissions.includes('imports.write'),
    roleLabel: isAdmin ? 'Admin' : isEditor ? 'Editor' : 'Viewer',
    isReadOnly: !canWrite,
  };
}
