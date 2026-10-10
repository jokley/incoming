import type { ComponentType } from "react";
import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Dashboard } from "./components/Dashboard";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";

const lazyComponent = <T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
) => async () => ({ Component: (await loader())[exportName] as ComponentType });

const lazyAdminComponent = <T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
) => async () => {
  const [{ AdminRoute }, module] = await Promise.all([
    import("./auth/AdminRoute"),
    loader(),
  ]);
  const Page = module[exportName] as ComponentType;
  return { Component: () => <AdminRoute><Page /></AdminRoute> };
};

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      { index: true, Component: Dashboard },
      { path: "athletes", lazy: lazyComponent(() => import("./components/Athletes"), "Athletes") },
      { path: "assignments", lazy: lazyComponent(() => import("./components/Assignments"), "Assignments") },
      { path: "room-types", lazy: lazyComponent(() => import("./components/RoomTypesManagement"), "RoomTypesManagement") },
      { path: "hotels", lazy: lazyComponent(() => import("./components/HotelsManagement"), "HotelsManagement") },
      { path: "events", lazy: lazyComponent(() => import("./components/EventsManagement"), "EventsManagement") },
      { path: "import", lazy: lazyComponent(() => import("./components/DataImport"), "DataImport") },
      { path: "analytics", lazy: lazyComponent(() => import("./components/RoomAnalytics"), "RoomAnalytics") },
      { path: "lists", lazy: lazyComponent(() => import("./components/Lists"), "Lists") },
      { path: "audit", lazy: lazyComponent(() => import("./components/AuditLog"), "AuditLog") },
      { path: "administration/test-data", lazy: lazyAdminComponent(() => import("./components/AdministrationTestData"), "AdministrationTestData") },
      { path: "administration/database", lazy: lazyAdminComponent(() => import("./components/DatabaseBackups"), "DatabaseBackups") },
      { path: "administration", lazy: lazyAdminComponent(() => import("./components/Administration"), "Administration") },
    ],
  },
]);
