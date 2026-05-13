import axios from "axios";
import { MessageCircle } from "lucide-react";
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
    return (<main className="grid min-h-screen place-items-center bg-white px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3 pb-1">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-mint text-white">
            <MessageCircle size={22}/>
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Create account</h1>
            <p className="text-sm text-slate-500">Start secure one-to-one chats.</p>
          </div>
        </div>
        {errors.length > 0 && (<div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {errors.map((error) => (<p key={error}>{error}</p>))}
          </div>)}
        {["name", "email", "phone", "password"].map((field) => (<input key={field} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-3 capitalize outline-none focus:border-mint" placeholder={field} type={field === "password" ? "password" : field === "email" ? "email" : "text"} required/>))}
        <button className="w-full rounded-lg bg-mint py-3 font-semibold text-white disabled:opacity-60" disabled={loading}>
          {loading ? "Creating..." : "Create account"}
        </button>
        <p className="text-center text-sm text-slate-500">
          Already registered? <Link className="font-medium text-mint" to="/login">Sign in</Link>
        </p>
      </form>
    </main>);
}
