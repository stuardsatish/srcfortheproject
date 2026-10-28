import React, { useState, useRef } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { supabase } from "../../context/SupabaseConfig";
import { startLoading, stopLoading } from "../../context/LoadingSlice";
import { setUser } from "../../context/UserSlice";
import { useDispatch, useSelector } from "react-redux";
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

const sectionLabelStyle = {
    fontSize: "11px",
    fontWeight: 700,
    color: "var(--color-ink)",
    textTransform: "uppercase",
    letterSpacing: "0.8px",
};

const SignupPage = () => {
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const containerRef = useRef(null);
    const loading = useSelector((state) => state.loading.loading);

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        password: "",
        confirmPassword: "",
        // Profile details (match the fields shown/edited in MyProfile)
        phone: "",
        gender: "",
        dateOfBirth: "",
        street: "",
        city: "",
        state: "",
        pincode: "",
    });
    const [errors, setErrors] = useState({});

    const [searchParams] = useSearchParams();
    const [guestBusy, setGuestBusy] = useState(false);

    // Phase 8.2: anonymous guest sign-in
    const handleGuestCheckout = async () => {
        setGuestBusy(true);
        try {
            const { data, error } = await supabase.auth.signInAnonymously();
            if (error) throw error;
            dispatch(setUser({ uid: data.user.id, name: "Guest", email: null, role: "customer", is_anonymous: true }));
            const returnTo = searchParams.get("returnTo") || "/cart";
            navigate(returnTo);
        } catch (err) {
            toast.error(err.message || "Guest sign-in failed.");
        } finally {
            setGuestBusy(false);
        }
    };
    useGSAP(() => {
        const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.7 } });
        tl.from(".auth-card", { y: 30, opacity: 0 })
            .from(".auth-head > *", { y: 16, opacity: 0, stagger: 0.08 }, "-=0.4")
            .from(".auth-form > *", { y: 12, opacity: 0, stagger: 0.04 }, "-=0.4");
    }, { scope: containerRef });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // Min 8 chars, at least one letter and one number.
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
        if (errors[name]) {
            setErrors({ ...errors, [name]: "" });
        }
    };

    const validateForm = () => {
        let newErrors = {};
        if (!formData.name.trim()) newErrors.name = "Full name is required";
        if (!formData.email) newErrors.email = "Email is required";
        else if (!emailRegex.test(formData.email)) newErrors.email = "Invalid email format";
        if (!formData.password) newErrors.password = "Password is required";
        else if (!passwordRegex.test(formData.password)) newErrors.password = "Min 8 characters, with at least one letter and one number";
        if (!formData.confirmPassword) newErrors.confirmPassword = "Please confirm your password";
        else if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = "Passwords do not match";

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSignup = async (e) => {
        e.preventDefault();
        if (!validateForm()) {
            toast.error("Please fix the highlighted fields");
            return;
        }

        try {
            dispatch(startLoading());

            // Supabase auto-sends the confirmation ("verify your email") email on
            // signup — no separate sendEmailVerification call needed. The
            // on_auth_user_created trigger (01-schema.sql) creates the full
            // `profiles` row from this metadata automatically — passing everything
            // here (rather than a follow-up `.update()`) means it's saved even
            // before email confirmation, when the client has no session yet to
            // satisfy the profiles RLS policy for a direct update.
            const { error } = await supabase.auth.signUp({
                email: formData.email,
                password: formData.password,
                options: {
                    data: {
                        name: formData.name.trim(),
                        phone: formData.phone.trim(),
                        gender: formData.gender || null,
                        date_of_birth: formData.dateOfBirth || null,
                        address: {
                            street: formData.street.trim(),
                            city: formData.city.trim(),
                            state: formData.state.trim(),
                            pincode: formData.pincode.trim(),
                        },
                    },
                },
            });
            if (error) throw error;

            toast.success("Account created Check your inbox to verify your email before checking out.");
            navigate("/login");
        } catch (error) {
            console.error("Signup Error:", error);
            toast.error(error.message || "Signup failed");
        } finally {
            dispatch(stopLoading());
        }
    };

    const fieldError = (key) =>
        errors[key] ? <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-error)" }}>{errors[key]}</span> : null;

    return (
        <div
            ref={containerRef}
            className="min-h-screen flex items-start justify-center pt-24 md:pt-10 px-6 pb-10"
            style={{ background: "var(--color-background)", fontFamily: "Inter, sans-serif" }}
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
                style={{ maxWidth: "520px", background: "var(--color-surface)", borderRadius: "16px", padding: "32px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)", border: "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)" }}
            >
                <div className="auth-head" style={{ marginBottom: "24px" }}>
                    <h1 style={{ fontSize: "26px", fontWeight: 700, color: "var(--color-ink)", letterSpacing: "-0.4px" }}>Create account</h1>
                    <p style={{ fontSize: "14px", color: "var(--color-muted)", marginTop: "6px" }}>Set up your profile to get started</p>
                </div>

                <form onSubmit={handleSignup} className="auth-form flex flex-col" style={{ gap: "16px" }}>
                    {/* ── Account ── */}
                    <span style={sectionLabelStyle}>Account</span>

                    <label className="flex flex-col" style={{ gap: "6px" }}>
                        <span style={labelStyle}>Full Name</span>
                        <input className="auth-input" type="text" name="name" placeholder="Your full name" value={formData.name} onChange={handleChange} />
                        {fieldError("name")}
                    </label>

                    <label className="flex flex-col" style={{ gap: "6px" }}>
                        <span style={labelStyle}>Email</span>
                        <input className="auth-input" type="email" name="email" placeholder="you@example.com" value={formData.email} onChange={handleChange} />
                        {fieldError("email")}
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: "12px" }}>
                        <label className="flex flex-col" style={{ gap: "6px" }}>
                            <span style={labelStyle}>Password</span>
                            <div className="relative">
                                <input className="auth-input" style={{ paddingRight: "44px" }} type={showPassword ? "text" : "password"} name="password" placeholder="Min 6 characters" value={formData.password} onChange={handleChange} />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label="Toggle password" className="absolute flex items-center justify-center" style={{ right: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-muted)" }}>
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                            {fieldError("password")}
                        </label>

                        <label className="flex flex-col" style={{ gap: "6px" }}>
                            <span style={labelStyle}>Confirm Password</span>
                            <div className="relative">
                                <input className="auth-input" style={{ paddingRight: "44px" }} type={showConfirmPassword ? "text" : "password"} name="confirmPassword" placeholder="Re-enter password" value={formData.confirmPassword} onChange={handleChange} />
                                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label="Toggle confirm password" className="absolute flex items-center justify-center" style={{ right: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-muted)" }}>
                                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                            {fieldError("confirmPassword")}
                        </label>
                    </div>

                    {/* ── Personal details ── */}
                    <span style={{ ...sectionLabelStyle, marginTop: "8px" }}>Personal Details <span style={{ color: "var(--color-muted)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(optional)</span></span>

                    <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: "12px" }}>
                        <label className="flex flex-col" style={{ gap: "6px" }}>
                            <span style={labelStyle}>Phone</span>
                            <input className="auth-input" type="tel" name="phone" placeholder="Phone number" value={formData.phone} onChange={handleChange} />
                        </label>
                        <label className="flex flex-col" style={{ gap: "6px" }}>
                            <span style={labelStyle}>Gender</span>
                            <select className="auth-input" name="gender" value={formData.gender} onChange={handleChange}>
                                <option value="">Select…</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                                <option value="Prefer not to say">Prefer not to say</option>
                            </select>
                        </label>
                    </div>

                    <label className="flex flex-col" style={{ gap: "6px" }}>
                        <span style={labelStyle}>Date of Birth</span>
                        <input className="auth-input" type="date" name="dateOfBirth" value={formData.dateOfBirth} onChange={handleChange} />
                    </label>

                    {/* ── Delivery address ── */}
                    <span style={{ ...sectionLabelStyle, marginTop: "8px" }}>Delivery Address <span style={{ color: "var(--color-muted)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(optional)</span></span>

                    <label className="flex flex-col" style={{ gap: "6px" }}>
                        <span style={labelStyle}>Street</span>
                        <input className="auth-input" type="text" name="street" placeholder="Street address" value={formData.street} onChange={handleChange} />
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: "12px" }}>
                        <label className="flex flex-col" style={{ gap: "6px" }}>
                            <span style={labelStyle}>City</span>
                            <input className="auth-input" type="text" name="city" placeholder="City" value={formData.city} onChange={handleChange} />
                        </label>
                        <label className="flex flex-col" style={{ gap: "6px" }}>
                            <span style={labelStyle}>State</span>
                            <input className="auth-input" type="text" name="state" placeholder="State" value={formData.state} onChange={handleChange} />
                        </label>
                    </div>

                    <label className="flex flex-col" style={{ gap: "6px" }}>
                        <span style={labelStyle}>Pincode</span>
                        <input className="auth-input" type="text" name="pincode" placeholder="Pincode" value={formData.pincode} onChange={handleChange} />
                    </label>

                    <button
                        type="submit"
                        disabled={loading}
                        className="flex items-center justify-center"
                        style={{ width: "100%", background: "var(--color-primary)", color: "var(--color-inverse)", fontWeight: 700, fontSize: "15px", padding: "13px", borderRadius: "9999px", boxShadow: "0px 4px 6px -4px color-mix(in srgb, var(--color-primary) 20%, transparent)", marginTop: "8px", gap: "8px", opacity: loading ? 0.85 : 1 }}
                    >
                        {loading ? <span className="auth-spinner" /> : "Create Account"}
                    </button>
                </form>

                <p style={{ fontSize: "14px", color: "var(--color-muted)", textAlign: "center", marginTop: "24px" }}>
                    Already have an account?{" "}
                    <Link to="/login" style={{ color: "var(--color-primary)", fontWeight: 700 }}>Sign in</Link>
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
                  style={{ marginTop: "12px", padding: "12px", borderRadius: "9999px", border: "1px solid var(--color-border-strong)", fontSize: "15px", fontWeight: 600, color: "var(--color-body)", background: "transparent", cursor: (guestBusy || loading) ? "not-allowed" : "pointer", opacity: (guestBusy || loading) ? 0.6 : 1 }}
                >
                  {guestBusy ? <span className="auth-spinner" /> : null}
                  Continue as Guest
                </button>
            </div>
        </div>
    );
};

export default SignupPage;