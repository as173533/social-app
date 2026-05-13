import { LogOut, MessageCircle, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { API_URL } from "../api/client";
import { authApi, userApi } from "../api/services";
import { useAuthStore } from "../stores/authStore";
import { ensureE2EEIdentity } from "../utils/e2ee";

export function AppShell() {
    const { user, accessToken, refreshToken, setAuth, clearAuth } = useAuthStore();
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const navigate = useNavigate();
    const imageSrc = (value) => {
        if (!value)
            return "";
        return value.startsWith("/") ? `${API_URL}${value}` : value;
    };
    useEffect(() => {
        if (!user || !accessToken || !refreshToken)
            return;
        ensureE2EEIdentity(user, userApi.updateE2EEKey)
            .then((updated) => {
            if (updated && updated.e2ee_public_key !== user.e2ee_public_key) {
                setAuth(updated, accessToken, refreshToken);
            }
        })
            .catch(() => undefined);
    }, [accessToken, refreshToken, setAuth, user?.id, user?.e2ee_public_key]);
    const logout = async () => {
        if (refreshToken) {
            await authApi.logout(refreshToken).catch(() => undefined);
        }
        clearAuth();
        navigate("/login");
    };
    return (<div className="min-h-screen bg-[#f5f5fb]">
      <header className="flex h-14 items-center justify-between border-b border-[#34355f] bg-[#3f4074] px-4 text-white shadow-lg shadow-slate-900/10 sm:px-5">
        <button type="button" onClick={() => navigate("/app")} className="flex items-center gap-3 text-left">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 text-white ring-1 ring-white/15">
            <MessageCircle size={21}/>
          </div>
          <div>
            <h1 className="text-base font-semibold">Chat Messenger</h1>
            <p className="text-xs text-[#dadaf2]">{user?.name}</p>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate("/app/profile")} className="flex h-9 items-center gap-2 rounded-lg bg-white/10 px-2 text-white ring-1 ring-white/10 hover:bg-white/20" title="Profile">
            {user?.avatar ? (<img src={imageSrc(user.avatar)} alt={user.name} className="h-6 w-6 rounded-full object-cover"/>) : (<UserRound size={18}/>)}
            <span className="hidden text-sm sm:inline">Profile</span>
          </button>
          <button onClick={() => setShowLogoutConfirm(true)} className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-white ring-1 ring-white/10 hover:bg-white/20" title="Log out">
            <LogOut size={18}/>
          </button>
        </div>
      </header>
      <Outlet />
      {showLogoutConfirm && (<div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/45 px-4">
          <section className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-semibold text-slate-900">Sign out?</h2>
            <p className="mt-2 text-sm text-slate-600">You will need to sign in again to continue chatting.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowLogoutConfirm(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium">
                Cancel
              </button>
              <button onClick={logout} className="rounded-md bg-[#c4314b] px-4 py-2 text-sm font-medium text-white">
                Sign out
              </button>
            </div>
          </section>
        </div>)}
    </div>);
}
