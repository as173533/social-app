import axios from "axios";
import { KeyRound, MailCheck, MessageCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "../api/services";

export function ForgotPasswordPage() {
    const [identifier, setIdentifier] = useState("");
    const [otp, setOtp] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [step, setStep] = useState("request");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const errorText = (error) => {
        if (!axios.isAxiosError(error))
            return "Could not complete the request. Please try again.";
        return error.response?.data?.detail || "Could not complete the request. Please try again.";
    };
    const requestOtp = async (event) => {
        event.preventDefault();
        setLoading(true);
        setError("");
        setMessage("");
        try {
            const response = await authApi.forgotPassword(identifier.trim());
            setMessage(response.message || "If this account exists, an OTP has been sent.");
            setStep("reset");
        }
        catch (error) {
            setError(errorText(error));
        }
        finally {
            setLoading(false);
        }
    };
    const resetPassword = async (event) => {
        event.preventDefault();
        setLoading(true);
        setError("");
        setMessage("");
        try {
            await authApi.resetPassword({ identifier: identifier.trim(), otp: otp.trim(), new_password: newPassword });
            setMessage("Password reset successfully. You can sign in now.");
            window.setTimeout(() => navigate("/login"), 900);
        }
        catch (error) {
            setError(errorText(error));
        }
        finally {
            setLoading(false);
        }
    };
    return (<main className="min-h-screen bg-[#f4f6fb] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-5xl overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl shadow-slate-900/10 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="hidden bg-[#34355f] p-8 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-white text-[#464775]">
                <MessageCircle size={22}/>
              </span>
              <span>
                <span className="block text-sm font-semibold">Chat Messenger</span>
                <span className="block text-xs text-white/70">Account recovery</span>
              </span>
            </div>
            <h1 className="mt-12 max-w-md text-4xl font-semibold leading-tight">Reset your password securely.</h1>
            <p className="mt-4 max-w-sm text-sm leading-6 text-white/75">We will send a one-time code to the email on your account.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
            <div className="flex items-center gap-3 rounded-xl bg-white p-4 text-slate-900">
              <MailCheck className="text-[#6264a7]" size={28}/>
              <span>
                <span className="block font-semibold">OTP expires quickly</span>
                <span className="block text-sm text-slate-500">Use the newest code from your email.</span>
              </span>
            </div>
          </div>
        </section>
        <section className="flex items-center justify-center p-5 sm:p-8">
          <form onSubmit={step === "request" ? requestOtp : resetPassword} className="w-full max-w-md space-y-5">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#6264a7] text-white shadow-lg shadow-[#6264a7]/20">
              <KeyRound size={24}/>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#6264a7]">Password help</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{step === "request" ? "Forgot password?" : "Enter your OTP"}</h1>
              <p className="mt-2 text-sm text-slate-500">{step === "request" ? "Enter your email or phone to request a reset code." : "Use the OTP we sent and choose a new password."}</p>
            </div>
            {message && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <label className="block text-sm font-medium text-slate-700">
              Email or phone
              <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} disabled={step === "reset"} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 outline-none transition focus:border-[#6264a7] focus:ring-2 focus:ring-[#6264a7]/15 disabled:bg-slate-50" placeholder="you@example.com" required/>
            </label>
            {step === "reset" && (<>
                <label className="block text-sm font-medium text-slate-700">
                  OTP
                  <input value={otp} onChange={(event) => setOtp(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 outline-none transition focus:border-[#6264a7] focus:ring-2 focus:ring-[#6264a7]/15" placeholder="6 digit code" required/>
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  New password
                  <input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 outline-none transition focus:border-[#6264a7] focus:ring-2 focus:ring-[#6264a7]/15" placeholder="Create a new password" type="password" required/>
                </label>
              </>)}
            <button className="w-full rounded-lg bg-[#6264a7] py-3 font-semibold text-white shadow-lg shadow-[#6264a7]/20 transition hover:bg-[#5557a0] disabled:opacity-60" disabled={loading}>
              {loading ? "Please wait..." : step === "request" ? "Send OTP" : "Reset password"}
            </button>
            {step === "reset" && <button type="button" onClick={() => setStep("request")} className="w-full rounded-lg border border-slate-300 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Use a different account</button>}
            <p className="text-center text-sm text-slate-500">
              Remembered it? <Link className="font-semibold text-[#6264a7]" to="/login">Sign in</Link>
            </p>
          </form>
        </section>
      </div>
    </main>);
}
