import { createBrowserRouter, Navigate, useParams } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { ProtectedRoute, PublicRoute } from "./components/ProtectedRoute";
import { RouteError } from "./components/RouteError";
import { LoginPage } from "./pages/LoginPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { MessengerPage } from "./pages/MessengerPage";
import { RegisterPage } from "./pages/RegisterPage";
const CHAT_ROUTE_PREFIX = "c";
function encodeChatId(id) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId))
        return "";
    const core = numericId.toString(36);
    const checksum = ((numericId * 1103515245 + 12345) >>> 0).toString(36).slice(0, 5);
    return `${CHAT_ROUTE_PREFIX}-${core}-${checksum}`;
}
function decodeChatId(value) {
    if (!value)
        return null;
    if (/^\d+$/.test(value))
        return Number.parseInt(value, 10);
    const parts = value.split("-");
    if (parts.length !== 3 || parts[0] !== CHAT_ROUTE_PREFIX)
        return null;
    const id = Number.parseInt(parts[1], 36);
    if (!Number.isFinite(id))
        return null;
    return id;
}
function ChatRedirect() {
    const { conversationId } = useParams();
    const decodedId = decodeChatId(conversationId);
    return <Navigate to={decodedId ? `/app/chat/${encodeChatId(decodedId)}` : "/app"} replace/>;
}
export const router = createBrowserRouter([
    { path: "/", element: <Navigate to="/app" replace/>, errorElement: <RouteError /> },
    {
        path: "/login",
        element: (<PublicRoute>
        <LoginPage />
      </PublicRoute>),
        errorElement: <RouteError />
    },
    {
        path: "/register",
        element: (<PublicRoute>
        <RegisterPage />
      </PublicRoute>),
        errorElement: <RouteError />
    },
    {
        path: "/forgot-password",
        element: (<PublicRoute>
        <ForgotPasswordPage />
      </PublicRoute>),
        errorElement: <RouteError />
    },
    { path: "/chat", element: <Navigate to="/app" replace/>, errorElement: <RouteError /> },
    { path: "/chat/:conversationId", element: <ChatRedirect />, errorElement: <RouteError /> },
    {
        path: "/app",
        errorElement: <RouteError />,
        element: (<ProtectedRoute>
        <AppShell />
      </ProtectedRoute>),
        children: [
            { index: true, element: <MessengerPage /> },
            { path: "chat/:conversationId", element: <MessengerPage /> }
        ]
    }
]);
