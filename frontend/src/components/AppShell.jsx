import { Camera, LogOut, MessageCircle, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { API_URL } from "../api/client";
import { authApi, userApi } from "../api/services";
import { useAuthStore } from "../stores/authStore";
export function AppShell() {
    const { user, accessToken, refreshToken, setAuth, clearAuth } = useAuthStore();
    const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
    const [showProfile, setShowProfile] = useState(false);
    const [profileForm, setProfileForm] = useState({ name: "", avatar: "", bio: "" });
    const [profileMessage, setProfileMessage] = useState("");
    const navigate = useNavigate();
    const imageSrc = (value) => {
        if (!value)
            return "";
        return value.startsWith("/") ? `${API_URL}${value}` : value;
    };
    useEffect(() => {
        if (user) {
            setProfileForm({ name: user.name ?? "", avatar: user.avatar ?? "", bio: user.bio ?? "" });
        }
    }, [user]);
    const logout = async () => {
        if (refreshToken) {
            await authApi.logout(refreshToken).catch(() => undefined);
        }
        clearAuth();
        navigate("/login");
    };
    const saveProfile = async (event) => {
        event.preventDefault();
        setProfileMessage("");
        try {
            const updated = await userApi.updateMe({
                name: profileForm.name.trim(),
                avatar: profileForm.avatar.trim() || null,
                bio: profileForm.bio.trim() || null
            });
            if (accessToken && refreshToken) {
                setAuth(updated, accessToken, refreshToken);
            }
            setProfileMessage("Profile updated.");
        }
        catch {
            setProfileMessage("Could not update profile. Check your details and try again.");
        }
    };
    const uploadProfileImage = async (file) => {
        if (!file)
            return;
        setProfileMessage("");
        try {
            const updated = await userApi.uploadAvatar(file);
            if (accessToken && refreshToken) {
                setAuth(updated, accessToken, refreshToken);
            }
            setProfileForm({ name: updated.name, avatar: updated.avatar ?? "", bio: updated.bio ?? "" });
            setProfileMessage("Profile photo updated.");
        }
        catch {
            setProfileMessage("Could not upload image. Use JPG, PNG, WEBP, or GIF up to 5MB.");
        }
    };
    return (<div className="min-h-screen bg-[#f5f5fb]">
      <header className="flex h-14 items-center justify-between border-b border-[#34355f] bg-[#3f4074] px-4 text-white shadow-lg shadow-slate-900/10 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 text-white ring-1 ring-white/15">
            <MessageCircle size={21}/>
          </div>
          <div>
            <h1 className="text-base font-semibold">Chat Messenger</h1>
            <p className="text-xs text-[#dadaf2]">{user?.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowProfile(true)} className="flex h-9 items-center gap-2 rounded-lg bg-white/10 px-2 text-white ring-1 ring-white/10 hover:bg-white/20" title="Profile">
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
      {showProfile && (<div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/45 px-4">
          <form onSubmit={saveProfile} className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Profile</h2>
              <button type="button" onClick={() => setShowProfile(false)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-slate-100">
                <X size={18}/>
              </button>
            </div>
            <div className="mt-5 flex items-center gap-4">
              <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-[#6264a7] text-2xl font-semibold text-white">
                {profileForm.avatar ? (<img src={imageSrc(profileForm.avatar)} alt="Profile preview" className="h-full w-full object-cover"/>) : (user?.name?.slice(0, 1).toUpperCase())}
              </div>
              <div className="min-w-0 flex-1">
                <label className="text-xs font-medium text-slate-500">Photo</label>
                <div className="mt-1 flex items-center gap-2">
                  <Camera size={17} className="text-slate-500"/>
                  <input value={profileForm.avatar} onChange={(event) => setProfileForm({ ...profileForm, avatar: event.target.value })} className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#6264a7]" placeholder="https://example.com/photo.jpg"/>
                </div>
                <label className="mt-2 inline-flex cursor-pointer items-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Choose from device
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => uploadProfileImage(event.target.files?.[0])}/>
                </label>
              </div>
            </div>
            <label className="mt-4 block text-xs font-medium text-slate-500">Name</label>
            <input value={profileForm.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-[#6264a7]" required/>
            <label className="mt-4 block text-xs font-medium text-slate-500">Bio</label>
            <textarea value={profileForm.bio} onChange={(event) => setProfileForm({ ...profileForm, bio: event.target.value })} className="mt-1 min-h-24 w-full resize-none rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-[#6264a7]" maxLength={500} placeholder="Tell people a little about you"/>
            {profileMessage && <p className="mt-3 rounded-md bg-[#ededfa] px-3 py-2 text-sm text-[#464775]">{profileMessage}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowProfile(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium">
                Close
              </button>
              <button className="rounded-md bg-[#6264a7] px-4 py-2 text-sm font-medium text-white">
                Save profile
              </button>
            </div>
          </form>
        </div>)}
    </div>);
}
