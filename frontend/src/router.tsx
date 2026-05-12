import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute, PublicRoute } from "./components/ProtectedRoute";
import { RouteError } from "./components/RouteError";
import { LoginPage } from "./pages/LoginPage";
import { MessengerPage } from "./pages/MessengerPage";
import { RegisterPage } from "./pages/RegisterPage";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/app" replace />, errorElement: <RouteError /> },
  {
    path: "/login",
    element: (
      <PublicRoute>
        <LoginPage />
      </PublicRoute>
    ),
    errorElement: <RouteError />
  },
  {
    path: "/register",
    element: (
      <PublicRoute>
        <RegisterPage />
      </PublicRoute>
    ),
    errorElement: <RouteError />
  },
  { path: "/chat", element: <Navigate to="/app" replace />, errorElement: <RouteError /> },
  {
    path: "/app",
    errorElement: <RouteError />,
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [{ index: true, element: <MessengerPage /> }]
  }
]);
