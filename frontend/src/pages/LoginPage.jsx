import { MessageCircle, ShieldCheck, Sparkles, Video } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "../api/services";
import { useAuthStore } from "../stores/authStore";
export function LoginPage() {
    const [identifier, setIdentifier] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const setAuth = useAuthStore((state) => state.setAuth);
    const navigate = useNavigate();
    const submit = async (event) => {
        event.preventDefault();
        setLoading(true);
        setError("");
        try {
            const response = await authApi.login({ identifier, password });
            setAuth(response.user, response.access_token, response.refresh_token);
            navigate("/app");
        }
        catch {
            setError("Invalid email, phone, or password.");
        }
        finally {
            setLoading(false);
        }
    };
    return (<main className="min-h-screen bg-[#f4f6fb] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl shadow-slate-900/10 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden bg-[#34355f] p-8 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-[#464775]">
                <MessageCircle size={22}/>
              </span>
              <span>
                <span className="block text-sm font-semibold">Chat Messenger</span>
                <span className="block text-xs text-white/70">Real-time chat, calls, and media</span>
              </span>
            </div>
            <h1 className="mt-12 max-w-lg text-4xl font-semibold leading-tight">Stay close to every conversation that matters.</h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-white/75">Send messages, share files, and jump into voice or video calls from one calm workspace.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4 shadow-xl shadow-slate-950/20">
            <div className="rounded-xl bg-white p-4 text-slate-900">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-[#c7d5e8] font-semibold text-[#123a63]">A</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Akash</span>
                  <span className="block text-xs text-emerald-600">Online</span>
                </span>
                <Video size={18} className="text-[#6264a7]"/>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <p className="w-2/3 rounded-xl bg-slate-100 px-3 py-2">Are you free for a quick call?</p>
                <p className="ml-auto w-2/3 rounded-xl bg-[#6264a7] px-3 py-2 text-white">Yes, joining now.</p>
              </div>
            </div>
          </div>
        </section>
        <section className="flex items-center justify-center p-5 sm:p-8">
          <form onSubmit={submit} className="w-full max-w-md space-y-5">
            <div className="lg:hidden">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#6264a7] text-white shadow-lg shadow-[#6264a7]/25">
                <MessageCircle size={24}/>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#6264a7]">Welcome back</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Sign in to Chat Messenger</h1>
              <p className="mt-2 text-sm text-slate-500">Use your email or phone to continue.</p>
            </div>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <label className="block text-sm font-medium text-slate-700">
              Email or phone
              <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 outline-none transition focus:border-[#6264a7] focus:ring-2 focus:ring-[#6264a7]/15" placeholder="you@example.com" required/>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Password
              <input value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 outline-none transition focus:border-[#6264a7] focus:ring-2 focus:ring-[#6264a7]/15" placeholder="Enter your password" type="password" required/>
            </label>
            <div className="text-right">
              <Link className="text-sm font-semibold text-[#6264a7]" to="/forgot-password">Forgot password?</Link>
            </div>
            <button className="w-full rounded-lg bg-[#6264a7] py-3 font-semibold text-white shadow-lg shadow-[#6264a7]/20 transition hover:bg-[#5557a0] disabled:opacity-60" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
            <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2">
              <span className="flex items-center gap-2"><ShieldCheck size={15} className="text-emerald-600"/> Secure sessions</span>
              <span className="flex items-center gap-2"><Sparkles size={15} className="text-[#6264a7]"/> Calls and media</span>
            </div>
            <p className="text-center text-sm text-slate-500">
              New here? <Link className="font-semibold text-[#6264a7]" to="/register">Create an account</Link>
            </p>
          </form>
        </section>
      </div>
    </main>);
}
