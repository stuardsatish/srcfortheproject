import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { supabase } from "../../context/SupabaseConfig";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Eye, EyeOff } from "lucide-react";

const labelStyle = {
    fontSize: "12px",
    fontWeight: 500,
    color: "var(--color-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.6px",
};

// Landed on via the link from supabase.auth.resetPasswordForEmail — Supabase
// establishes a temporary "recovery" session from the URL, which is enough
// to call updateUser({ password }) without knowing the old password.
const ResetPasswordPage = () => {
    const navigate = useNavigate();
    const containerRef = useRef(null);

    const [ready, setReady] = useState(false);
    const [hasSession, setHasSession] = useState(false);
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [saving, setSaving] = useState(false);

    useGSAP(
        () => {
            gsap.from(".auth-card", {
                y: 30,
                opacity: 0,
                duration: 0.7,
                ease: "power3.out",
            });
        },
        { scope: containerRef },
    );

    useEffect(() => {
        // detectSessionInUrl (default true) parses the recovery tokens from the
        // URL fragment on load; give it a tick before checking for a session.
        supabase.auth.getSession().then(({ data: { session } }) => {
            setHasSession(!!session);
            setReady(true);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === "PASSWORD_RECOVERY") setHasSession(!!session);
        });

        return () => subscription.unsubscribe();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (password.length < 8) {
            toast.error("Password must be at least 8 characters");
            return;
        }
        if (password !== confirm) {
            toast.error("Passwords do not match");
            return;
        }

        try {
            setSaving(true);
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            // Sign out of the temporary recovery session so the user logs back in
            // with their new password through the normal flow.
            await supabase.auth.signOut();
            toast.success("Password updated. Please log in.");
            navigate("/login");
        } catch (error) {
            toast.error(error?.message || "Could not update password. Please try again.");
        } finally {
            setSaving(false);
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
                    border: "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)",
                }}
            >
                <div style={{ marginBottom: "24px" }}>
                    <h1
                        style={{
                            fontSize: "26px",
                            fontWeight: 700,
                            color: "var(--color-ink)",
                            letterSpacing: "-0.4px",
                        }}
                    >
                        Set a new password
                    </h1>
                    <p style={{ fontSize: "14px", color: "var(--color-muted)", marginTop: "6px" }}>
                        Choose a new password for your account.
                    </p>
                </div>

                {!ready ? (
                    <p style={{ fontSize: "14px", color: "var(--color-muted)", textAlign: "center" }}>
                        Verifying reset link…
                    </p>
                ) : !hasSession ? (
                    <p style={{ fontSize: "14px", color: "var(--color-muted)", textAlign: "center" }}>
                        This reset link is invalid or has expired. Please request a new one from the
                        login page.
                    </p>
                ) : (
                    <form onSubmit={handleSubmit} className="flex flex-col" style={{ gap: "16px" }}>
                        <label className="flex flex-col" style={{ gap: "6px" }}>
                            <span style={labelStyle}>New password</span>
                            <div className="relative">
                                <input
                                    className="auth-input"
                                    style={{ paddingRight: "44px" }}
                                    type={showPw ? "text" : "password"}
                                    placeholder="At least 8 characters"
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
                        </label>
                        <label className="flex flex-col" style={{ gap: "6px" }}>
                            <span style={labelStyle}>Confirm password</span>
                            <input
                                className="auth-input"
                                type={showPw ? "text" : "password"}
                                placeholder="Re-enter password"
                                value={confirm}
                                onChange={(e) => setConfirm(e.target.value)}
                            />
                        </label>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex items-center justify-center"
                            style={{
                                width: "100%",
                                background: "var(--color-primary)",
                                color: "var(--color-inverse)",
                                fontWeight: 700,
                                fontSize: "15px",
                                padding: "13px",
                                borderRadius: "9999px",
                                boxShadow: "0px 4px 6px -4px color-mix(in srgb, var(--color-primary) 20%, transparent)",
                                marginTop: "4px",
                                gap: "8px",
                                opacity: saving ? 0.85 : 1,
                            }}
                        >
                            {saving ? <span className="auth-spinner" /> : "Update password"}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};

export default ResetPasswordPage;