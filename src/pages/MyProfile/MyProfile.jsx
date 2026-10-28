import React, { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useDispatch } from "react-redux"
import { supabase } from "../../context/SupabaseConfig"
import { setUser } from "../../context/UserSlice"
import { validateImageFile } from "../../utils/uploadValidation"
import { addressFromProfile, formatAddressLine } from "../../utils/addresses"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import {
  ArrowLeft, Pencil, Camera, Lock, Copy, Check, Eye, EyeOff, X,
  Home as HomeIcon, Search as SearchIcon, ShoppingCart, Heart as HeartIcon, User as UserIcon,
} from "lucide-react"
import useIsMobile from "../../hooks/useIsMobile"

/* ── Palette (matches the rest of the project) ── */
const C = {
  pageBg: "var(--color-background)",
  card: "var(--color-surface)",
  primary: "var(--color-primary)",
  textPri: "var(--color-ink)",
  textSec: "var(--color-muted)",
  border: "color-mix(in srgb, var(--color-border) 30%, transparent)",
  inputBg: "var(--color-surface-muted)",
  green: "var(--color-primary)",
  red: "var(--color-error)",
}

const getInitials = (name) => {
  if (!name) return "U"
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "U"
  return parts.map((p) => p[0]).join("").slice(0, 2).toUpperCase()
}

const formatDate = (val) => {
  if (!val) return ""
  const d = new Date(val)
  if (isNaN(d.getTime())) return String(val)
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
}

const MyProfile = () => {
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const isMobile = useIsMobile(640)

  const containerRef = useRef(null)
  const toastRef = useRef(null)
  const fileInputRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [authUser, setAuthUser] = useState(null)
  const [profile, setProfile] = useState({})
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState("personal")
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState("")

  const [form, setForm] = useState({
    name: "", phone: "", gender: "", dateOfBirth: "",
  })

  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" })
  const [pwShow, setPwShow] = useState({ current: false, next: false, confirm: false })
  const [pwErrors, setPwErrors] = useState({})

  const [toast, setToast] = useState({ show: false, message: "" })

  /* ── Load the current Supabase auth user + profiles row ── */
  useEffect(() => {
    let active = true
    const load = async () => {
      const { data: { user: sUser } } = await supabase.auth.getUser()
      if (!active) return
      if (!sUser) {
        navigate("/login")
        return
      }
      setAuthUser(sUser)
      const { data: profileRow, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", sUser.id)
        .single()
      if (!active) return
      if (error) console.error("Profile read error:", error)
      setProfile(profileRow || {})
      setLoading(false)
    }
    load().catch((err) => {
      console.error("Profile load error:", err)
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [navigate])

  /* ── Skeleton shimmer (GSAP opacity pulse, not CSS keyframes) ── */
  useGSAP(() => {
    if (!loading) return
    gsap.to(".profile-skeleton", {
      opacity: 0.4, duration: 0.8, repeat: -1, yoyo: true, ease: "sine.inOut",
    })
  }, { scope: containerRef, dependencies: [loading] })

  /* ── Toast entrance / exit (GSAP fromTo) ── */
  useEffect(() => {
    if (!toast.show || !toastRef.current) return
    gsap.fromTo(
      toastRef.current,
      { y: 24, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.4, ease: "power2.out" }
    )
    const t = setTimeout(() => {
      const el = toastRef.current
      if (el) {
        gsap.to(el, {
          y: 24, opacity: 0, duration: 0.4, ease: "power2.in",
          onComplete: () => setToast({ show: false, message: "" }),
        })
      } else {
        setToast({ show: false, message: "" })
      }
    }, 3000)
    return () => clearTimeout(t)
  }, [toast.show])

  const showToast = (message) => setToast({ show: true, message })

  /* ── Derived display values ── */
  const displayName = profile.name || authUser?.user_metadata?.name || "User"
  const initials = getInitials(displayName)
  const photoURL = profile.photo_url || authUser?.user_metadata?.avatar_url || ""
  const email = authUser?.email || profile.email || ""
  const emailVerified = !!authUser?.email_confirmed_at
  const uid = authUser?.id || ""
  const memberSince = formatDate(authUser?.created_at || profile.created_at)
  // The DEFAULT address of the address book, mirrored into profiles.address by
  // the database (legacy {street, city, state, pincode, …} shape).
  const defaultAddress = addressFromProfile(profile.address)
  const addressLine = defaultAddress ? formatAddressLine(defaultAddress) : ""
  const uidShort = uid ? `${uid.slice(0, 6)}…${uid.slice(-4)}` : "—"

  /* ── Handlers ── */
  const openModal = (tab = "personal") => {
    setForm({
      name: profile.name || authUser?.user_metadata?.name || "",
      phone: profile.phone || "",
      gender: profile.gender || "",
      dateOfBirth: profile.date_of_birth || "",
    })
    setActiveTab(tab)
    setModalError("")
    setPwErrors({})
    setPwForm({ current: "", next: "", confirm: "" })
    setModalOpen(true)
  }

  const closeModal = () => {
    if (!saving) setModalOpen(false)
  }

  const handleSavePersonal = async () => {
    if (!authUser) return
    try {
      setSaving(true)
      setModalError("")
      const updates = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        gender: form.gender,
        date_of_birth: form.dateOfBirth || null,
      }
      const { data: updated, error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", authUser.id)
        .select()
        .single()
      if (error) throw error
      setProfile(updated)
      dispatch(setUser({ ...updated, uid: authUser.id }))
      setModalOpen(false)
      showToast("Profile updated successfully")
    } catch (err) {
      console.error("Save profile error:", err)
      setModalError(err.message || "Failed to update profile. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (!authUser) return
    const errs = {}
    if (!pwForm.current) errs.current = "Enter your current password"
    if (pwForm.next.length < 8) errs.next = "Minimum 8 characters"
    if (pwForm.next !== pwForm.confirm) errs.confirm = "Passwords do not match"
    setPwErrors(errs)
    if (Object.keys(errs).length) return

    try {
      setSaving(true)
      setModalError("")
      // Supabase has no dedicated reauthenticate call — verify the current
      // password by signing in with it before applying the change.
      const { error: verifyErr } = await supabase.auth.signInWithPassword({
        email: authUser.email,
        password: pwForm.current,
      })
      if (verifyErr) {
        setPwErrors({ current: "Current password is incorrect" })
        return
      }
      const { error: updateErr } = await supabase.auth.updateUser({ password: pwForm.next })
      if (updateErr) throw updateErr
      setModalOpen(false)
      setPwForm({ current: "", next: "", confirm: "" })
      showToast("Password updated successfully")
    } catch (err) {
      console.error("Change password error:", err)
      setModalError(err.message || "Failed to change password. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !authUser) return
    const _imgCheck = validateImageFile(file, { maxBytes: 2 * 1024 * 1024, allowGif: false })
    if (!_imgCheck.ok) {
      showToast(_imgCheck.error)
      if (fileInputRef.current) fileInputRef.current.value = ""
      return
    }
    try {
      setUploading(true)
      const ext = file.name.split(".").pop() || "jpg"
      const path = `${authUser.id}/avatar.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true })
      if (uploadErr) throw uploadErr
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path)

      const { data: updated, error } = await supabase
        .from("profiles")
        .update({ photo_url: publicUrl })
        .eq("id", authUser.id)
        .select()
        .single()
      if (error) throw error
      await supabase.auth.updateUser({ data: { avatar_url: publicUrl } })

      setProfile(updated)
      dispatch(setUser({ ...updated, uid: authUser.id }))
      showToast("Profile photo updated")
    } catch (err) {
      console.error("Photo upload error:", err)
      showToast("Photo upload failed. Please try again.")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const copyUid = async () => {
    if (!uid) return
    try {
      await navigator.clipboard.writeText(uid)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      console.error("Copy failed:", e)
    }
  }

  /* ── Small render helpers ── */
  const avatar = (size) => (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{ width: size, height: size, borderRadius: "9999px", background: "var(--color-error-subtle)" }}
      >
        {photoURL ? (
          <img src={photoURL} alt={displayName} className="w-full h-full" style={{ objectFit: "cover" }} />
        ) : (
          <span style={{ color: C.primary, fontWeight: 700, fontSize: Math.round(size * 0.33) }}>{initials}</span>
        )}
      </div>
      <button
        onClick={() => fileInputRef.current?.click()}
        aria-label="Change photo"
        disabled={uploading}
        className="absolute flex items-center justify-center"
        style={{ bottom: 0, right: 0, width: "24px", height: "24px", borderRadius: "9999px", background: C.primary, border: "2px solid var(--color-inverse)" }}
      >
        <Camera size={12} color="var(--color-inverse)" />
      </button>
    </div>
  )

  const verifiedPill = (
    <span
      style={{
        display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: "9999px",
        fontSize: "11px", fontWeight: 600,
        background: emailVerified ? "var(--color-success-subtle)" : "var(--color-error-subtle)",
        color: emailVerified ? C.green : "var(--color-error)",
      }}
    >
      {emailVerified ? "Verified" : "Unverified"}
    </span>
  )

  const kvLabel = (size) => ({ fontSize: size, fontWeight: 500, color: C.textSec, textTransform: "uppercase", letterSpacing: "0.6px" })

  // Desktop label/value row
  const desktopRow = (label, value) => (
    <div className="flex flex-col" style={{ gap: "4px" }}>
      <span style={kvLabel("12px")}>{label}</span>
      <span style={{ fontSize: "14px", fontWeight: 600, color: C.textPri }}>{value || "—"}</span>
    </div>
  )

  // Mobile field row with divider
  const mobileRow = (label, value, last, extra) => (
    <div
      className="flex items-center justify-between"
      style={{ padding: "10px 0", borderBottom: last ? "none" : `1px solid ${C.border}`, gap: "12px" }}
    >
      <div className="flex flex-col" style={{ gap: "2px", minWidth: 0 }}>
        <span style={kvLabel("11px")}>{label}</span>
        <span style={{ fontSize: "13px", fontWeight: 600, color: C.textPri, wordBreak: "break-word" }}>{value || "—"}</span>
      </div>
      {extra}
    </div>
  )

  const copyBtn = (
    <button onClick={copyUid} aria-label="Copy UID" className="flex items-center justify-center flex-shrink-0" style={{ width: "28px", height: "28px", color: C.textSec }}>
      {copied ? <Check size={15} color={C.green} /> : <Copy size={15} />}
    </button>
  )

  const changePwLink = (
    <button onClick={() => openModal("password")} style={{ fontSize: "12px", fontWeight: 700, color: C.primary }}>
      Change
    </button>
  )
  // The default address as shown in the Delivery Address card (both layouts).
  const addressBody = (large) => (
    <div className="flex flex-col" style={{ gap: "4px", paddingTop: large ? 0 : "6px" }}>
      {defaultAddress.label && (
        <span style={{ alignSelf: "flex-start", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: C.primary, background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", padding: "3px 10px", borderRadius: "9999px", marginBottom: "4px" }}>
          {defaultAddress.label}
        </span>
      )}
      {(defaultAddress.fullName || defaultAddress.phone) && (
        <span style={{ fontSize: large ? "14px" : "13px", fontWeight: 700, color: C.textPri }}>
          {[defaultAddress.fullName, defaultAddress.phone].filter(Boolean).join(" · ")}
        </span>
      )}
      <p style={{ fontSize: large ? "14px" : "13px", fontWeight: 600, color: C.textPri, lineHeight: large ? "22px" : "20px" }}>{addressLine}</p>
      {defaultAddress.landmark && <span style={{ fontSize: "12px", color: C.textSec }}>Landmark: {defaultAddress.landmark}</span>}
    </div>
  )


  /* ── Skeleton (GSAP-pulsed) ── */
  const skeletonBlock = (style) => <div aria-hidden="true" className="profile-skeleton" style={{ background: C.inputBg, borderRadius: "8px", ...style }} />

  // A label + value row placeholder (mirrors the real key/value rows).
  const skeletonRow = (key) => (
    <div key={key} className="flex flex-col" style={{ gap: "6px" }}>
      {skeletonBlock({ width: "35%", height: "12px" })}
      {skeletonBlock({ width: "65%", height: "16px" })}
    </div>
  )

  // A card placeholder: heading bar + `rows` key/value rows.
  const skeletonCard = (rows, extra) => (
    <div style={{ background: C.card, borderRadius: "12px", padding: isMobile ? "16px" : "24px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)", ...extra }}>
      {skeletonBlock({ width: "50%", height: "16px", marginBottom: isMobile ? "12px" : "20px" })}
      <div className="flex flex-col" style={{ gap: "16px" }}>
        {[...Array(rows)].map((_, i) => skeletonRow(i))}
      </div>
    </div>
  )

  // Content-aware skeleton — mirrors the real profile layout (avatar header +
  // info cards) at each breakpoint so the swap to real data causes no jump.
  const renderSkeleton = () =>
    isMobile ? (
      <>
        <div className="flex flex-col items-center text-center" style={{ padding: "24px 20px 16px", gap: "8px" }}>
          {skeletonBlock({ width: "80px", height: "80px", borderRadius: "9999px" })}
          {skeletonBlock({ width: "160px", height: "20px", marginTop: "4px" })}
          {skeletonBlock({ width: "200px", height: "13px" })}
          {skeletonBlock({ width: "110px", height: "22px", borderRadius: "9999px" })}
        </div>
        <div className="flex flex-col" style={{ padding: "0 16px", gap: "16px" }}>
          {skeletonCard(4)}
          {skeletonCard(4)}
          {skeletonCard(1)}
        </div>
      </>
    ) : (
      <>
        {/* Header card */}
        <div className="flex items-center" style={{ background: C.card, borderRadius: "16px", padding: "32px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)", marginBottom: "24px", gap: "24px" }}>
          {skeletonBlock({ width: "96px", height: "96px", borderRadius: "9999px", flexShrink: 0 })}
          <div className="flex flex-col" style={{ gap: "10px", flex: 1, minWidth: 0 }}>
            {skeletonBlock({ width: "220px", height: "24px" })}
            {skeletonBlock({ width: "260px", height: "14px" })}
            {skeletonBlock({ width: "120px", height: "22px", borderRadius: "9999px" })}
          </div>
          {skeletonBlock({ width: "120px", height: "38px", borderRadius: "9999px", flexShrink: 0 })}
        </div>
        {/* Info cards grid */}
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          {skeletonCard(4)}
          {skeletonCard(4)}
          {skeletonCard(2, { gridColumn: "1 / -1" })}
        </div>
      </>
    )

  /* =========================================================
     EDIT MODAL (shared)
  ========================================================= */
  const editModal = modalOpen && (
    <div
      className="fixed inset-0 z-[120] flex"
      style={{
        background: "var(--color-overlay)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
        alignItems: isMobile ? "flex-end" : "center", justifyContent: "center",
      }}
      onClick={closeModal}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface w-full"
        style={{
          maxWidth: isMobile ? "100%" : "480px",
          borderRadius: isMobile ? "16px 16px 0 0" : "16px",
          padding: "24px",
          paddingBottom: isMobile ? "calc(24px + env(safe-area-inset-bottom, 16px))" : "24px",
          maxHeight: "92vh", overflowY: "auto",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: "16px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: C.textPri }}>Edit Profile</h2>
          <button onClick={closeModal} aria-label="Close"><X size={20} color={C.textSec} /></button>
        </div>

        {/* Tabs */}
        <div className="flex" style={{ background: C.inputBg, borderRadius: "9999px", padding: "4px", marginBottom: "20px" }}>
          {[
            { key: "personal", label: "Personal Info" },
            { key: "password", label: "Change Password" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); setModalError("") }}
              className="flex-1"
              style={{
                padding: "8px 12px", borderRadius: "9999px", fontSize: "13px", fontWeight: 600,
                background: activeTab === t.key ? "var(--color-surface)" : "transparent",
                color: activeTab === t.key ? C.textPri : C.textSec,
                boxShadow: activeTab === t.key ? "0px 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "personal" ? (
          <div className="flex flex-col" style={{ gap: "14px" }}>
            {[
              { key: "name", label: "Full Name", type: "text", placeholder: "Your name" },
              { key: "phone", label: "Phone", type: "tel", placeholder: "Phone number" },
            ].map((f) => (
              <label key={f.key} className="flex flex-col" style={{ gap: "6px" }}>
                <span style={kvLabel("11px")}>{f.label}</span>
                <input
                  className="profile-input"
                  type={f.type}
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              </label>
            ))}

            <label className="flex flex-col" style={{ gap: "6px" }}>
              <span style={kvLabel("11px")}>Gender</span>
              <select className="profile-input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">Select…</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </label>

            <label className="flex flex-col" style={{ gap: "6px" }}>
              <span style={kvLabel("11px")}>Date of Birth</span>
              <input className="profile-input" type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
            </label>

            <span style={{ ...kvLabel("11px"), marginTop: "4px" }}>Delivery Address</span>
            <p style={{ fontSize: "13px", color: C.textSec, lineHeight: "19px" }}>
              Delivery addresses now live in your address book.{" "}
              <button type="button" onClick={() => { setModalOpen(false); navigate("/addresses") }} style={{ fontWeight: 700, color: C.primary }}>
                Manage addresses
              </button>
            </p>
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: "14px" }}>
            {[
              { key: "current", label: "Current Password" },
              { key: "next", label: "New Password" },
              { key: "confirm", label: "Confirm New Password" },
            ].map((f) => (
              <label key={f.key} className="flex flex-col" style={{ gap: "6px" }}>
                <span style={kvLabel("11px")}>{f.label}</span>
                <div className="relative">
                  <input
                    className="profile-input"
                    style={{ paddingRight: "44px" }}
                    type={pwShow[f.key] ? "text" : "password"}
                    value={pwForm[f.key]}
                    onChange={(e) => { setPwForm({ ...pwForm, [f.key]: e.target.value }); setPwErrors({ ...pwErrors, [f.key]: "" }) }}
                  />
                  <button
                    type="button"
                    onClick={() => setPwShow({ ...pwShow, [f.key]: !pwShow[f.key] })}
                    aria-label="Toggle visibility"
                    className="absolute flex items-center justify-center"
                    style={{ right: "12px", top: "50%", transform: "translateY(-50%)", color: C.textSec }}
                  >
                    {pwShow[f.key] ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {pwErrors[f.key] && <span style={{ fontSize: "12px", fontWeight: 500, color: C.red }}>{pwErrors[f.key]}</span>}
              </label>
            ))}
          </div>
        )}

        {modalError && (
          <p style={{ marginTop: "14px", fontSize: "12px", fontWeight: 500, color: C.red }}>{modalError}</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end" style={{ gap: "12px", marginTop: "24px" }}>
          <button
            onClick={closeModal}
            disabled={saving}
            style={{ border: `1px solid ${C.textPri}`, borderRadius: "9999px", padding: "10px 24px", fontSize: "14px", fontWeight: 600, color: C.textPri, background: "transparent", opacity: saving ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            onClick={activeTab === "personal" ? handleSavePersonal : handleChangePassword}
            disabled={saving}
            className="flex items-center justify-center"
            style={{ background: C.primary, borderRadius: "9999px", padding: "10px 24px", fontSize: "14px", fontWeight: 700, color: "var(--color-inverse)", boxShadow: "0px 4px 6px -4px color-mix(in srgb, var(--color-primary) 20%, transparent)", gap: "8px", minWidth: "140px", opacity: saving ? 0.85 : 1 }}
          >
            {saving ? <span className="myprofile-spinner" /> : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  )

  const toastEl = toast.show && (
    <div
      ref={toastRef}
      className="fixed flex items-center justify-center"
      style={{
        left: "50%", transform: "translateX(-50%)",
        bottom: isMobile ? "92px" : "32px", zIndex: 130,
        background: C.textPri, color: "var(--color-inverse)", borderRadius: "12px",
        padding: "12px 20px", fontSize: "14px", fontWeight: 600,
        boxShadow: "0px 10px 30px rgba(0,0,0,0.2)", maxWidth: "90vw",
      }}
    >
      {toast.message}
    </div>
  )

  const styleTag = (
    <style>{`
      .profile-input{width:100%;background:${C.inputBg};border-radius:12px;padding:12px 16px;border:1px solid transparent;font-size:14px;color:${C.textPri};font-family:'Inter',sans-serif;outline:none;transition:border-color .15s,background .15s;}
      .profile-input:focus{border-color:${C.textPri};background:var(--color-surface);}
      .profile-input::placeholder{color:${C.textSec};}
      @keyframes myprofileSpin{to{transform:rotate(360deg);}}
      .myprofile-spinner{width:16px;height:16px;border:2px solid color-mix(in srgb, var(--color-inverse) 40%, transparent);border-top-color:var(--color-inverse);border-radius:9999px;animation:myprofileSpin .7s linear infinite;}
    `}</style>
  )

  /* =========================================================
     MOBILE LAYOUT (≤640px)
  ========================================================= */
  if (isMobile) {
    const sectionHeading = (title, withPencil) => (
      <div className="flex items-center justify-between" style={{ marginBottom: "4px" }}>
        <h3 style={{ fontSize: "14px", fontWeight: 600, color: C.textPri }}>{title}</h3>
        {withPencil && (
          <button onClick={() => openModal("personal")} aria-label="Edit"><Pencil size={16} color={C.primary} /></button>
        )}
      </div>
    )
    return (
      <div ref={containerRef} className="min-h-screen w-full" style={{ background: C.pageBg, fontFamily: "Inter, sans-serif", overflowX: "hidden", maxWidth: "100vw" }}>
        {styleTag}
        <main style={{ paddingTop: "96px", paddingBottom: "80px" }}>
          {loading ? (
            renderSkeleton()
          ) : (
            <>
              {/* Avatar + name */}
              <div className="flex flex-col items-center text-center" style={{ padding: "24px 20px 16px", gap: "8px" }}>
                {avatar(80)}
                <h1 style={{ fontSize: "20px", fontWeight: 700, color: C.textPri, marginTop: "4px" }}>{displayName}</h1>
                <p style={{ fontSize: "13px", fontWeight: 400, color: C.textSec }}>{email}</p>
                {verifiedPill}
              </div>

              <div className="flex flex-col" style={{ padding: "0 16px", gap: "16px" }}>
                {/* Personal Information */}
                <section style={{ background: C.card, borderRadius: "12px", padding: "16px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                  {sectionHeading("Personal Information", true)}
                  {mobileRow("Full Name", profile.name)}
                  {mobileRow("Gender", profile.gender)}
                  {mobileRow("Date of Birth", formatDate(profile.date_of_birth) || profile.date_of_birth)}
                  {mobileRow("Phone", profile.phone, true)}
                </section>

                {/* Account & Security */}
                <section style={{ background: C.card, borderRadius: "12px", padding: "16px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                  {sectionHeading("Account & Security", false)}
                  {mobileRow("Email Address", email, false, <Lock size={14} color={C.textSec} className="flex-shrink-0" />)}
                  {mobileRow("Password", "••••••••", false, changePwLink)}
                  {mobileRow("Member Since", memberSince)}
                  {mobileRow("User ID", uidShort, true, copyBtn)}
                </section>

                {/* Delivery Address — the default entry of the address book */}
                <section style={{ background: C.card, borderRadius: "12px", padding: "16px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                  {sectionHeading("Delivery Address", false)}
                  {defaultAddress ? (
                    <>
                      {addressBody(false)}
                      <button onClick={() => navigate("/addresses")} style={{ marginTop: "12px", fontSize: "13px", fontWeight: 700, color: C.primary }}>
                        Manage addresses
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => navigate("/addresses")}
                      className="w-full flex items-center justify-center"
                      style={{ marginTop: "8px", padding: "16px", borderRadius: "12px", border: `1px dashed ${C.border}`, color: C.primary, fontSize: "13px", fontWeight: 600, background: "transparent" }}
                    >
                      + Add Address
                    </button>
                  )}
                </section>
              </div>
            </>
          )}
        </main>

        {/* BOTTOM NAV — superseded by the global MobileNav tab bar; hidden. */}
        <nav
          className="fixed bottom-0 inset-x-0 z-50 flex items-center justify-around"
          style={{ display: "none", height: "64px", background: "color-mix(in srgb, var(--color-background) 80%, transparent)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", borderRadius: "12px 12px 0 0", boxShadow: "0px 10px 15px -3px rgba(0,0,0,0.1), 0px 4px 6px -4px rgba(0,0,0,0.1)" }}
        >
          {[
            { icon: HomeIcon, label: "Home", to: "/" },
            { icon: SearchIcon, label: "Search", to: "/products" },
            { icon: ShoppingCart, label: "Cart", to: "/cart" },
            { icon: HeartIcon, label: "Wishlist", to: "/wishlist" },
            { icon: UserIcon, label: "Profile", to: "/myprofile", active: true },
          ].map((n) => {
            const Icon = n.icon
            return (
              <button key={n.label} onClick={() => !n.active && navigate(n.to)} className="flex flex-col items-center justify-center" style={{ gap: "4px", color: n.active ? C.primary : "var(--color-body)" }}>
                <Icon size={20} />
                <span style={{ fontSize: "10px", fontWeight: 500 }}>{n.label}</span>
              </button>
            )
          })}
        </nav>

        {editModal}
        {toastEl}
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handlePhotoUpload} />
      </div>
    )
  }

  /* =========================================================
     DESKTOP LAYOUT (≥768px) — uses the existing global Navbar
  ========================================================= */
  return (
    <div ref={containerRef} className="min-h-screen w-full" style={{ background: C.pageBg, fontFamily: "Inter, sans-serif" }}>
      {styleTag}
      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "40px 24px" }}>
        {loading ? (
          renderSkeleton()
        ) : (
          <>
            {/* HEADER CARD */}
            <div
              className="flex items-center"
              style={{ background: C.card, borderRadius: "16px", padding: "32px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)", marginBottom: "24px", gap: "24px" }}
            >
              {avatar(96)}
              <div className="flex flex-col" style={{ gap: "6px", flex: 1, minWidth: 0 }}>
                <h1 style={{ fontSize: "24px", fontWeight: 700, color: C.textPri }}>{displayName}</h1>
                <p style={{ fontSize: "14px", fontWeight: 400, color: C.textSec }}>{email}</p>
                <div>{verifiedPill}</div>
              </div>
              <button
                onClick={() => openModal("personal")}
                className="flex-shrink-0"
                style={{ border: `1px solid ${C.textPri}`, borderRadius: "9999px", padding: "8px 20px", fontSize: "14px", fontWeight: 600, color: C.textPri, background: "transparent" }}
              >
                Edit Profile
              </button>
            </div>

            {/* INFO CARDS GRID */}
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              {/* Card 1 — Personal Information */}
              <div style={{ background: C.card, borderRadius: "12px", padding: "24px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "20px" }}>
                  <h2 style={{ fontSize: "16px", fontWeight: 600, color: C.textPri }}>Personal Information</h2>
                  <button onClick={() => openModal("personal")} aria-label="Edit personal info"><Pencil size={16} color={C.primary} /></button>
                </div>
                <div className="flex flex-col" style={{ gap: "16px" }}>
                  {desktopRow("Full Name", profile.name)}
                  {desktopRow("Gender", profile.gender)}
                  {desktopRow("Date of Birth", formatDate(profile.date_of_birth) || profile.date_of_birth)}
                  {desktopRow("Phone", profile.phone)}
                </div>
              </div>

              {/* Card 2 — Account & Security */}
              <div style={{ background: C.card, borderRadius: "12px", padding: "24px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 600, color: C.textPri, marginBottom: "20px" }}>Account &amp; Security</h2>
                <div className="flex flex-col" style={{ gap: "16px" }}>
                  <div className="flex flex-col" style={{ gap: "4px" }}>
                    <span style={kvLabel("12px")}>Email Address</span>
                    <span className="flex items-center" style={{ fontSize: "14px", fontWeight: 600, color: C.textPri, gap: "8px" }}>
                      <Lock size={14} color={C.textSec} /> {email || "—"}
                    </span>
                  </div>
                  <div className="flex items-end justify-between">
                    <div className="flex flex-col" style={{ gap: "4px" }}>
                      <span style={kvLabel("12px")}>Password</span>
                      <span style={{ fontSize: "14px", fontWeight: 600, color: C.textPri, letterSpacing: "2px" }}>••••••••</span>
                    </div>
                    {changePwLink}
                  </div>
                  {desktopRow("Member Since", memberSince)}
                  <div className="flex items-end justify-between">
                    <div className="flex flex-col" style={{ gap: "4px", minWidth: 0 }}>
                      <span style={kvLabel("12px")}>User ID</span>
                      <span style={{ fontSize: "14px", fontWeight: 600, color: C.textPri }}>{uidShort}</span>
                    </div>
                    {copyBtn}
                  </div>
                </div>
              </div>

              {/* Card 3 — Delivery Address (full width) — the default entry of the address book */}
              <div style={{ gridColumn: "1 / -1", background: C.card, borderRadius: "12px", padding: "24px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: "16px" }}>
                  <h2 style={{ fontSize: "16px", fontWeight: 600, color: C.textPri }}>Delivery Address</h2>
                  {defaultAddress && (
                    <button onClick={() => navigate("/addresses")} style={{ fontSize: "13px", fontWeight: 700, color: C.primary }}>Manage addresses</button>
                  )}
                </div>
                {defaultAddress ? (
                  addressBody(true)
                ) : (
                  <button
                    onClick={() => navigate("/addresses")}
                    className="w-full flex items-center justify-center"
                    style={{ padding: "24px", borderRadius: "12px", border: `1px dashed ${C.border}`, color: C.primary, fontSize: "14px", fontWeight: 600, background: "transparent" }}
                  >
                    + Add Address
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {editModal}
      {toastEl}
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handlePhotoUpload} />
    </div>
  )
}

export default MyProfile