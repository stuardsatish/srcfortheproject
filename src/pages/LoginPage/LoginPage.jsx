import React, { useState, useRef } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { supabase } from "../../context/SupabaseConfig";
import { useDispatch, useSelector } from "react-redux";
import { startLoading, stopLoading } from "../../context/LoadingSlice";
import { setUser } from "../../context/UserSlice";
import { queryActiveTabs, broadcastAuth } from "../../utils/sessionUtils";
import { registerNewSession } from "../../utils/sessionManager";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Eye, EyeOff, AlertTriangle, Info } from "lucide-react";

const labelStyle = {
  fontSize: "12px",
  fontWeight: 500,
  color: "var(--color-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.6px",
};

const LoginPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const containerRef = useRef(null);
  const loading = useSelector((state) => state.loading.loading);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [mode, setMode] = useState("login"); // "login" | "forgot"
  const [guestBusy, setGuestBusy] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSending, setResetSending] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Why-were-you-logged-out banner (set by sessionManager.forceLogout).
  const [searchParams] = useSearchParams();
  const reason = searchParams.get("reason");
  const sessionMsg =
    reason === "session_conflict"
      ? {
          show: true,
          type: "warning",
          title: "You were logged out",
          message:
            "Your account was accessed from another device. For your security, this session was ended. Please log in again.",
        }
      : reason === "no_session"
        ? {
            show: true,
            type: "info",
            title: "Session expired",
            message: "Your session has expired. Please log in again.",
          }
        : { show: false };

  useGSAP(
    () => {
      const tl = gsap.timeline({
        defaults: { ease: "power3.out", duration: 0.7 },
      });
      tl.from(".auth-card", { y: 30, opacity: 0 })
        .from(".auth-head > *", { y: 16, opacity: 0, stagger: 0.08 }, "-=0.4")
        .from(".auth-form > *", { y: 14, opacity: 0, stagger: 0.06 }, "-=0.4");
    },
    { scope: containerRef },
  );

  const getAuthErrorMessage = (error) => {
    const msg = String(error?.message || "");
    if (msg.includes("Invalid login credentials")) return "Incorrect email or password";
    if (msg.includes("Email not confirmed")) return "Please verify your email before logging in";
    if (msg.includes("Unable to validate email")) return "Invalid email format";
    return msg || "Login failed. Please try again.";
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please enter your email and password");
      return;
    }

    // Automatically logout if another tab is authenticated
    const otherTab = await queryActiveTabs();
    if (otherTab?.role) {
      try {
        await supabase.auth.signOut();
        broadcastAuth("logout");
        // A small delay to ensure the other tab processes it and doesn't conflict
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error("Auto-logout error:", err);
      }
    }

    try {
      dispatch(startLoading());
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .single();

      if (profileError || !profile) {
        toast.error("User profile not found");
        return;
      }

      dispatch(
        setUser({
          ...profile,
          uid: data.user.id,
        }),
      ); // Single-session: overwrite any active session on other devices.

      await registerNewSession(data.user.id);

      broadcastAuth("login", { role: profile.role, userId: data.user.id });
      toast.success("Welcome back ");
      if (profile.role === "admin") navigate("/admin/dashboard");
      else navigate("/");
    } catch (error) {
      toast.error(getAuthErrorMessage(error));
    } finally {
      dispatch(stopLoading());
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!resetEmail) {
      toast.error("Please enter your email");
      return;
    }
    try {
      setResetSending(true);
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setResetSent(true);
    } catch (error) {
      toast.error(getAuthErrorMessage(error));
    } finally {
      setResetSending(false);
    }
  };

  const backToLogin = () => {
    setMode("login");
    setResetSent(false);
    setResetEmail("");
  };

  // Phase 8.2: anonymous guest sign-in
  const handleGuestCheckout = async () => {
    setGuestBusy(true);
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      dispatch(setUser({
        uid: data.user.id,
        name: "Guest",
        email: null,
        role: "customer",
        is_anonymous: true,
      }));
      const returnTo = searchParams.get("returnTo") || "/cart";
      navigate(returnTo);
    } catch (err) {
      toast.error(err.message || "Guest sign-in failed. Please try again.");
    } finally {
      setGuestBusy(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="min-h-screen flex items-center justify-center"
      style={{
        background: "var(--color-background)",
        fontFamily: "Inter, sans-serif",
        padding: "24px",
      }}
    >
      <style>{`
        .auth-input{width:100%;background:var(--color-surface-muted);border:1px solid transparent;border-radius:12px;padding:12px 14px;font-size:14px;color:var(--color-ink);font-family:'Inter',sans-serif;outline:none;transition:border-color .15s,background .15s;}
        .auth-input:focus{border-color:var(--color-ink);background:var(--color-surface);}
        .auth-input::placeholder{color:var(--color-muted);}
        @keyframes authSpin{to{transform:rotate(360deg);}}
        .auth-spinner{width:16px;height:16px;border:2px solid color-mix(in srgb, var(--color-inverse) 40%, transparent);border-top-color:var(--color-inverse);border-radius:9999px;animation:authSpin .7s linear infinite;}
      `}</style>
      <div
        className="auth-card w-full"
        style={{
          maxWidth: "440px",
          background: "var(--color-surface)",
          borderRadius: "16px",
          padding: "32px",
          boxShadow: "0px 4px 20px rgba(26,43,60,0.05)",
          border:
            "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)",
        }}
      >
        {sessionMsg.show && (
          <div
            className="flex items-start gap-3"
            style={{
              padding: "16px",
              borderRadius: "12px",
              marginBottom: "24px",
              border: `1px solid ${sessionMsg.type === "warning" ? "var(--color-accent-subtle)" : "var(--color-info-border)"}`,
              background:
                sessionMsg.type === "warning"
                  ? "var(--color-accent-subtle)"
                  : "var(--color-info-subtle)",
              color:
                sessionMsg.type === "warning"
                  ? "var(--color-accent-strong)"
                  : "var(--color-info)",
            }}
          >
            <span style={{ marginTop: "2px", flexShrink: 0 }}>
              {sessionMsg.type === "warning" ? (
                <AlertTriangle
                  size={18}
                  style={{ color: "var(--color-accent)" }}
                />
              ) : (
                <Info size={18} style={{ color: "var(--color-info)" }} />
              )}
            </span>
            <span>
              <p style={{ fontWeight: 600, fontSize: "14px" }}>
                {sessionMsg.title}
              </p>
              <p style={{ fontSize: "14px", marginTop: "2px", opacity: 0.85 }}>
                {sessionMsg.message}
              </p>
            </span>
          </div>
        )}

        {mode === "login" ? (
          <>
            <div className="auth-head" style={{ marginBottom: "24px" }}>
              <h1
                style={{
                  fontSize: "26px",
                  fontWeight: 700,
                  color: "var(--color-ink)",
                  letterSpacing: "-0.4px",
                }}
              >
                Welcome back
              </h1>
              <p
                style={{
                  fontSize: "14px",
                  color: "var(--color-muted)",
                  marginTop: "6px",
                }}
              >
                Sign in to continue to your account
              </p>
            </div>
            <form
              onSubmit={handleLogin}
              className="auth-form flex flex-col"
              style={{ gap: "16px" }}
            >
              <label className="flex flex-col" style={{ gap: "6px" }}>
                <span style={labelStyle}>Email</span>
                <input
                  className="auth-input"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="flex flex-col" style={{ gap: "6px" }}>
                <span style={labelStyle}>Password</span>
                <div className="relative">
                  <input
                    className="auth-input"
                    style={{ paddingRight: "44px" }}
                    type={showPw ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    aria-label="Toggle password visibility"
                    className="absolute flex items-center justify-center"
                    style={{
                      right: "12px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: "var(--color-muted)",
                    }}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  style={{
                    alignSelf: "flex-end",
                    fontSize: "13px",
                    color: "var(--color-primary)",
                    fontWeight: 600,
                    marginTop: "2px",
                  }}
                >
                  Forgot password?
                </button>
              </label>
              <button
                type="submit"
                disabled={loading}
                className="flex items-center justify-center"
                style={{
                  width: "100%",
                  background: "var(--color-primary)",
                  color: "var(--color-inverse)",
                  fontWeight: 700,
                  fontSize: "15px",
                  padding: "13px",
                  borderRadius: "9999px",
                  boxShadow:
                    "0px 4px 6px -4px color-mix(in srgb, var(--color-primary) 20%, transparent)",
                  marginTop: "4px",
                  gap: "8px",
                  opacity: loading ? 0.85 : 1,
                }}
              >
                {loading ? <span className="auth-spinner" /> : "Sign In"}
              </button>
            </form>
            <p
              style={{
                fontSize: "14px",
                color: "var(--color-muted)",
                textAlign: "center",
                marginTop: "24px",
              }}
            >
              New here?{" "}
              <Link
                to="/signup"
                style={{ color: "var(--color-primary)", fontWeight: 700 }}
              >
                Create an account
              </Link>
            </p>
            {/* Phase 8.2: Guest checkout */}
            <div className="flex items-center gap-3" style={{ marginTop: "20px" }}>
              <div style={{ flex: 1, height: "1px", background: "var(--color-border)" }} />
              <span style={{ fontSize: "12px", color: "var(--color-muted)", whiteSpace: "nowrap" }}>or</span>
              <div style={{ flex: 1, height: "1px", background: "var(--color-border)" }} />
            </div>
            <button
              type="button"
              onClick={handleGuestCheckout}
              disabled={guestBusy || loading}
              className="flex items-center justify-center gap-2 w-full"
              style={{ marginTop: "12px", padding: "12px", borderRadius: "9999px", border: "1px solid var(--color-border-strong)", fontSize: "15px", fontWeight: 600, color: "var(--color-body)", background: "transparent", cursor: (guestBusy || loading) ? "not-allowed" : "pointer", opacity: (guestBusy || loading) ? 0.6 : 1, transition: "all 0.2s" }}
            >
              {guestBusy ? <span className="auth-spinner" /> : null}
              Continue as Guest
            </button>
          </>
        ) : (
          <>
            <div className="auth-head" style={{ marginBottom: "24px" }}>
              <h1
                style={{
                  fontSize: "26px",
                  fontWeight: 700,
                  color: "var(--color-ink)",
                  letterSpacing: "-0.4px",
                }}
              >
                Reset your password
              </h1>
              <p
                style={{
                  fontSize: "14px",
                  color: "var(--color-muted)",
                  marginTop: "6px",
                }}
              >
                {resetSent
                  ? "Check your inbox for the reset link."
                  : "Enter your email and we'll send you a link to reset it."}
              </p>
            </div>
            {resetSent ? (
              <p
                style={{
                  fontSize: "14px",
                  color: "var(--color-muted)",
                  textAlign: "center",
                }}
              >
                Sent a password reset link to <strong>{resetEmail}</strong> if
                an account exists for that email.
              </p>
            ) : (
              <form
                onSubmit={handleForgotPassword}
                className="auth-form flex flex-col"
                style={{ gap: "16px" }}
              >
                <label className="flex flex-col" style={{ gap: "6px" }}>
                  <span style={labelStyle}>Email</span>
                  <input
                    className="auth-input"
                    type="email"
                    placeholder="you@example.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={resetSending}
                  className="flex items-center justify-center"
                  style={{
                    width: "100%",
                    background: "var(--color-primary)",
                    color: "var(--color-inverse)",
                    fontWeight: 700,
                    fontSize: "15px",
                    padding: "13px",
                    borderRadius: "9999px",
                    boxShadow:
                      "0px 4px 6px -4px color-mix(in srgb, var(--color-primary) 20%, transparent)",
                    marginTop: "4px",
                    gap: "8px",
                    opacity: resetSending ? 0.85 : 1,
                  }}
                >
                  {resetSending ? (
                    <span className="auth-spinner" />
                  ) : (
                    "Send reset link"
                  )}
                </button>
              </form>
            )}
            <p
              style={{
                fontSize: "14px",
                color: "var(--color-muted)",
                textAlign: "center",
                marginTop: "24px",
              }}
            >
              <button
                type="button"
                onClick={backToLogin}
                style={{ color: "var(--color-primary)", fontWeight: 700 }}
              >
                Back to sign in
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default LoginPage;