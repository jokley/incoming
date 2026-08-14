import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Dashboard } from "./components/Dashboard";
import { Athletes } from "./components/Athletes";
import { Assignments } from "./components/Assignments";
import { DataImport } from "./components/DataImport";
import { RoomAnalytics } from "./components/RoomAnalytics";
import { RoomTypesManagement } from "./components/RoomTypesManagement";
import { HotelsManagement } from "./components/HotelsManagement";
import { EventsManagement } from "./components/EventsManagement";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { AuditLog } from "./components/AuditLog";
import { AdminRoute } from "./auth/AdminRoute";
import { AdministrationTestData } from "./components/AdministrationTestData";
import { Lists } from "./components/Lists";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      { index: true, Component: Dashboard },
      { path: "athletes", Component: Athletes },
      { path: "assignments", Component: Assignments },
      { path: "room-types", Component: RoomTypesManagement },
      { path: "hotels", Component: HotelsManagement },
      { path: "events", Component: EventsManagement },
      { path: "import", Component: DataImport },
      { path: "analytics", Component: RoomAnalytics },
      { path: "lists", Component: Lists },
      { path: "audit", Component: AuditLog },
      { path: "administration/test-data", element: <AdminRoute><AdministrationTestData /></AdminRoute> },
    ],
  },
]);
