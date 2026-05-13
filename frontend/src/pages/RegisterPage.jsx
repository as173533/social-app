import axios from "axios";
import { MessageCircle, PhoneCall, Send, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "../api/services";
import { useAuthStore } from "../stores/authStore";
export function RegisterPage() {
    const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
    const [errors, setErrors] = useState([]);
    const [loading, setLoading] = useState(false);
    const setAuth = useAuthStore((state) => state.setAuth);
    const navigate = useNavigate();
    const validate = () => {
        const nextErrors = [];
        if (form.name.trim().length < 2)
            nextErrors.push("Name must be at least 2 characters.");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
            nextErrors.push("Enter a valid email address.");
        if (!/^\+?[0-9]{7,15}$/.test(form.phone.trim()))
            nextErrors.push("Phone number must contain 7 to 15 digits.");
        if (form.password.length < 8)
            nextErrors.push("Password must be at least 8 characters.");
        return nextErrors;
    };
    const apiErrors = (error) => {
        if (!axios.isAxiosError(error))
            return ["Could not create account. Please try again."];
        const detail = error.response?.data?.detail;
        if (typeof detail === "string") {
            if (detail.toLowerCase().includes("email or phone"))
                return ["Email or phone number is already registered."];
            return [detail];
        }
        if (Array.isArray(detail)) {
            return detail.map((item) => {
                const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : "field";
                return `${String(field)}: ${item.msg}`;
            });
        }
        return ["Could not create account. Check your details and try again."];
    };
    const submit = async (event) => {
        event.preventDefault();
        const validationErrors = validate();
        if (validationErrors.length) {
            setErrors(validationErrors);
            return;
        }
        setLoading(true);
        setErrors([]);
        try {
            const response = await authApi.register({
                name: form.name.trim(),
                email: form.email.trim().toLowerCase(),
                phone: form.phone.trim(),
                password: form.password
            });
            setAuth(response.user, response.access_token, response.refresh_token);
            navigate("/app");
        }
        catch (error) {
            setErrors(apiErrors(error));
        }
        finally {
            setLoading(false);
        }
    };
    return (<main className="min-h-screen bg-[#f4f6fb] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl shadow-slate-900/10 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="flex items-center justify-center p-5 sm:p-8">
          <form onSubmit={submit} className="w-full max-w-md space-y-4">
            <div>
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#0f766e] text-white shadow-lg shadow-[#0f766e]/20">
                <MessageCircle size={24}/>
              </div>
              <p className="mt-6 text-sm font-semibold text-[#0f766e]">Create your account</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Start chatting in minutes</h1>
              <p className="mt-2 text-sm text-slate-500">Your profile, friends, chats, calls, and media in one place.</p>
            </div>
            {errors.length > 0 && (<div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {errors.map((error) => (<p key={error}>{error}</p>))}
              </div>)}
            {[
                ["name", "Full name", "Akash Sarkar"],
                ["email", "Email", "you@example.com"],
                ["phone", "Phone", "+919876543210"],
                ["password", "Password", "Create a password"]
            ].map(([field, label, placeholder]) => (<label key={field} className="block text-sm font-medium text-slate-700">
                {label}
                <input value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 outline-none transition focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/15" placeholder={placeholder} type={field === "password" ? "password" : field === "email" ? "email" : "text"} required/>
              </label>))}
            <button className="w-full rounded-lg bg-[#0f766e] py-3 font-semibold text-white shadow-lg shadow-[#0f766e]/20 transition hover:bg-[#0b5f59] disabled:opacity-60" disabled={loading}>
              {loading ? "Creating..." : "Create account"}
            </button>
            <p className="text-center text-sm text-slate-500">
              Already registered? <Link className="font-semibold text-[#0f766e]" to="/login">Sign in</Link>
            </p>
          </form>
        </section>
        <section className="hidden bg-[#eef8f6] p-8 lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-3 rounded-xl bg-white px-3 py-2 shadow-sm">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#0f766e] text-white">
                <MessageCircle size={22}/>
              </span>
              <span>
                <span className="block text-sm font-semibold">Chat Messenger</span>
                <span className="block text-xs text-slate-500">Built for everyday conversations</span>
              </span>
            </div>
            <h2 className="mt-12 max-w-lg text-4xl font-semibold leading-tight text-slate-950">Bring messages, groups, calls, and media together.</h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-600">Create your profile and start real-time conversations with people you trust.</p>
          </div>
          <div className="grid gap-3">
            {[
                [Users, "Friends and groups", "Connect one-to-one or create shared spaces."],
                [PhoneCall, "Audio and video calls", "Move from text to live conversation quickly."],
                [Send, "Files and media", "Share photos, voice notes, videos, and documents."]
            ].map(([Icon, title, text]) => (<div key={title} className="flex items-start gap-3 rounded-xl bg-white p-4 shadow-sm">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#dff3ef] text-[#0f766e]"><Icon size={20}/></span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-slate-500">{text}</span>
                </span>
              </div>))}
          </div>
        </section>
      </div>
    </main>);
}
