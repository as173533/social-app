import { ArrowLeft, Camera, KeyRound, Shield, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../api/client";
import { authApi, userApi } from "../api/services";
import { useAuthStore } from "../stores/authStore";
import { exportE2EERecoveryKey, importE2EERecoveryKey, resetE2EEIdentity } from "../utils/e2ee";

export function ProfilePage() {
    const { user, accessToken, refreshToken, setAuth } = useAuthStore();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState("profile");
    const [profileForm, setProfileForm] = useState({ name: "", avatar: "", bio: "" });
    const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
    const [profileMessage, setProfileMessage] = useState("");
    const [passwordMessage, setPasswordMessage] = useState("");
    const [securityMessage, setSecurityMessage] = useState("");
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
    const changePassword = async (event) => {
        event.preventDefault();
        setPasswordMessage("");
        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            setPasswordMessage("New password and confirmation do not match.");
            return;
        }
        try {
            await authApi.changePassword({
                current_password: passwordForm.currentPassword,
                new_password: passwordForm.newPassword
            });
            setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
            setPasswordMessage("Password changed. Please sign in again on other devices.");
        }
        catch (error) {
            setPasswordMessage(error?.response?.data?.detail || "Could not change password. Check your current password.");
        }
    };
    const exportRecoveryKey = async () => {
        setSecurityMessage("");
        try {
            await exportE2EERecoveryKey(user);
            setSecurityMessage("Encryption recovery key exported. Keep it private.");
        }
        catch {
            setSecurityMessage("Could not export the recovery key.");
        }
    };
    const importRecoveryKey = async (file) => {
        if (!file)
            return;
        setSecurityMessage("");
        try {
            const updated = await importE2EERecoveryKey(user, file, userApi.updateE2EEKey);
            if (updated && accessToken && refreshToken) {
                setAuth(updated, accessToken, refreshToken);
            }
            setSecurityMessage("Recovery key imported. Older encrypted chats can be decrypted here.");
        }
        catch (error) {
            setSecurityMessage(error?.message || "Could not import this recovery key.");
        }
    };
    const resetEncryption = async () => {
        const confirmed = window.confirm("Old encrypted messages without a recovery key cannot be restored. Reset encryption for future messages?");
        if (!confirmed)
            return;
        setSecurityMessage("");
        try {
            const updated = await resetE2EEIdentity(user, userApi.updateE2EEKey);
            if (updated && accessToken && refreshToken) {
                setAuth(updated, accessToken, refreshToken);
            }
            setSecurityMessage("Encryption reset. Future messages will work on this account. Old locked messages cannot be restored.");
        }
        catch (error) {
            setSecurityMessage(error?.message || "Could not reset encryption.");
        }
    };
    const tabs = [
        { id: "profile", label: "Profile", icon: <UserRound size={17}/> },
        { id: "password", label: "Change password", icon: <KeyRound size={17}/> },
        { id: "security", label: "Encryption", icon: <Shield size={17}/> }
    ];
    return (<main className="min-h-[calc(100dvh-3.5rem)] bg-[#f5f5fb] px-4 py-5 sm:px-6">
      <section className="mx-auto max-w-5xl">
        <button type="button" onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-[#464775] hover:bg-[#ededfa]">
          <ArrowLeft size={17}/>
          Back
        </button>
        <div className="overflow-hidden rounded-lg border border-[#ddddec] bg-white shadow-sm">
          <div className="border-b border-[#e6e6f2] p-5">
            <h2 className="text-xl font-semibold text-slate-950">Account settings</h2>
            <p className="mt-1 text-sm text-slate-500">Manage your profile, password, and encrypted chat recovery.</p>
          </div>
          <div className="grid md:grid-cols-[230px_1fr]">
            <nav className="border-b border-[#e6e6f2] bg-[#fafafe] p-3 md:border-b-0 md:border-r">
              <div className="grid gap-1">
                {tabs.map((tab) => (<button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium ${activeTab === tab.id ? "bg-[#6264a7] text-white" : "text-slate-600 hover:bg-[#ededfa]"}`}>
                    {tab.icon}
                    {tab.label}
                  </button>))}
              </div>
            </nav>
            <div className="p-5">
              {activeTab === "profile" && (<form onSubmit={saveProfile} className="max-w-2xl">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-[#6264a7] text-3xl font-semibold text-white">
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
                  <label className="mt-5 block text-xs font-medium text-slate-500">Name</label>
                  <input value={profileForm.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-[#6264a7]" required/>
                  <label className="mt-4 block text-xs font-medium text-slate-500">Bio</label>
                  <textarea value={profileForm.bio} onChange={(event) => setProfileForm({ ...profileForm, bio: event.target.value })} className="mt-1 min-h-28 w-full resize-none rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-[#6264a7]" maxLength={500} placeholder="Tell people a little about you"/>
                  {profileMessage && <p className="mt-3 rounded-md bg-[#ededfa] px-3 py-2 text-sm text-[#464775]">{profileMessage}</p>}
                  <button className="mt-5 rounded-md bg-[#6264a7] px-4 py-2 text-sm font-medium text-white">
                    Save profile
                  </button>
                </form>)}
              {activeTab === "password" && (<form onSubmit={changePassword} className="max-w-xl">
                  <h3 className="font-semibold text-slate-900">Change password</h3>
                  <p className="mt-1 text-sm text-slate-500">Update your password while you are signed in.</p>
                  <label className="mt-5 block text-xs font-medium text-slate-500">Current password</label>
                  <input value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-[#6264a7]" type="password" required/>
                  <label className="mt-4 block text-xs font-medium text-slate-500">New password</label>
                  <input value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-[#6264a7]" type="password" minLength={8} required/>
                  <label className="mt-4 block text-xs font-medium text-slate-500">Confirm new password</label>
                  <input value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-[#6264a7]" type="password" minLength={8} required/>
                  {passwordMessage && <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{passwordMessage}</p>}
                  <button className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                    Change password
                  </button>
                </form>)}
              {activeTab === "security" && (<section className="max-w-xl">
                  <h3 className="font-semibold text-slate-900">Encrypted chat recovery</h3>
                  <p className="mt-1 text-sm text-slate-500">This browser holds your private encryption key. Export it before using a new phone or desktop.</p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button type="button" onClick={exportRecoveryKey} className="rounded-md border border-[#6264a7] px-4 py-2 text-sm font-medium text-[#464775]">
                      Export recovery key
                    </button>
                    <label className="cursor-pointer rounded-md bg-[#6264a7] px-4 py-2 text-sm font-medium text-white">
                      Import recovery key
                      <input type="file" accept="application/json,.json" className="hidden" onChange={(event) => importRecoveryKey(event.target.files?.[0])}/>
                    </label>
                    <button type="button" onClick={resetEncryption} className="rounded-md border border-[#c4314b] px-4 py-2 text-sm font-medium text-[#c4314b]">
                      Reset encryption
                    </button>
                  </div>
                  {securityMessage && <p className="mt-3 rounded-md bg-[#eef7f0] px-3 py-2 text-sm text-[#14532d]">{securityMessage}</p>}
                </section>)}
            </div>
          </div>
        </div>
      </section>
    </main>);
}
