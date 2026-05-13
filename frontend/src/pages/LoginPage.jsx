import { MessageCircle } from "lucide-react";
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
    return (<main className="grid min-h-screen place-items-center bg-white px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-brand text-white">
            <MessageCircle size={22}/>
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Welcome back</h1>
            <p className="text-sm text-slate-500">Sign in with email or phone.</p>
          </div>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-3 outline-none focus:border-brand" placeholder="Email or phone" required/>
        <input value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-3 outline-none focus:border-brand" placeholder="Password" type="password" required/>
        <button className="w-full rounded-lg bg-brand py-3 font-semibold text-white disabled:opacity-60" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
        <p className="text-center text-sm text-slate-500">
          New here? <Link className="font-medium text-brand" to="/register">Create an account</Link>
        </p>
      </form>
    </main>);
}
