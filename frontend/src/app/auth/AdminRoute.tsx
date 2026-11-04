import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from './AuthProvider';

export function AdminRoute({ children }: { children: ReactNode }) {
  const { permissions } = useAuth();
  return permissions.isAdmin ? children : <Navigate to="/" replace />;
}
