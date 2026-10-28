import { useEffect, useState } from "react"
import { useSelector } from "react-redux"
import { toast } from "react-toastify"
import { X } from "lucide-react"
import useIsMobile from "../../hooks/useIsMobile"
import {
    LABEL_PRESETS,
    emptyAddressFields,
    validateAddress,
    createAddress,
    updateAddress,
} from "../../utils/addresses"

const C = {
    card: "var(--color-surface)",
    primary: "var(--color-primary)",
    textPri: "var(--color-ink)",
    textSec: "var(--color-muted)",
    border: "color-mix(in srgb, var(--color-border) 60%, transparent)",
    inputBg: "var(--color-surface-muted)",
    red: "var(--color-error)",
}

const fieldLabel = { fontSize: "11px", fontWeight: 500, color: C.textSec, textTransform: "uppercase", letterSpacing: "0.6px" }

// Order the fields appear in, for "focus the first invalid one".
const FIELD_ORDER = ["label", "fullName", "phone", "line1", "line2", "landmark", "city", "state", "pincode"]

const Field = ({ name, label, error, children }) => (
    <label className="flex flex-col" style={{ gap: "6px" }}>
        <span style={fieldLabel}>{label}</span>
        {children}
        {error && (
            <span id={`addr-err-${name}`} role="alert" style={{ fontSize: "12px", fontWeight: 500, color: C.red }}>{error}</span>
        )}
    </label>
)

/**
 * Add / edit form for one address.
 *
 *  - `address` null  -> add mode;  an address object -> edit mode.
 *  - `isFirst` marks the customer's very first address, which is always the
 *    default (the database enforces it; the checkbox just reflects that).
 *  - `preselectDefault` pre-ticks (but leaves editable) "make default" for the
 *    checkout flow, where a newly added address is normally the one wanted.
 *  - `onSaved(address)` runs after a successful save, before the modal closes.
 */
const AddressFormModal = ({ open, onClose, address = null, isFirst = false, preselectDefault = false, onSaved }) => {
    if (!open) return null
    return <AddressFormDialog address={address} isFirst={isFirst} preselectDefault={preselectDefault} onClose={onClose} onSaved={onSaved} />
}

const AddressFormDialog = ({ address, isFirst, preselectDefault, onClose, onSaved }) => {
    const isMobile = useIsMobile(640)
    const user = useSelector((s) => s.user.user)
    const isEdit = !!address
    const forceDefault = isEdit ? address.isDefault : isFirst

    // Seed a brand-new address with who the customer already is, to save typing.
    const [values, setValues] = useState(() =>
        isEdit
            ? emptyAddressFields(address)
            : emptyAddressFields({ fullName: user?.name || "", phone: user?.phone || "" }),
    )
    const [labelChoice, setLabelChoice] = useState(() => {
        if (!isEdit) return "Home"
        if (!address.label) return "Home"
        return LABEL_PRESETS.includes(address.label) && address.label !== "Other" ? address.label : "Other"
    })
    const [customLabel, setCustomLabel] = useState(() =>
        isEdit && address.label && !["Home", "Work"].includes(address.label) ? address.label : "",
    )
    const [makeDefault, setMakeDefault] = useState(forceDefault || (!isEdit && preselectDefault))
    const [errors, setErrors] = useState({})
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape" && !saving) onClose() }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [onClose, saving])

    const set = (name, value) => {
        setValues((v) => ({ ...v, [name]: value }))
        if (errors[name]) setErrors((e) => ({ ...e, [name]: "" }))
    }

    const bind = (name) => ({
        name,
        className: "addr-input",
        value: values[name],
        onChange: (e) => set(name, e.target.value),
        "aria-invalid": !!errors[name],
        "aria-describedby": errors[name] ? `addr-err-${name}` : undefined,
    })

    const submit = async (e) => {
        e.preventDefault()
        if (saving) return
        const label = labelChoice === "Other" ? customLabel : labelChoice
        const result = validateAddress({ ...values, label })
        setErrors(result.errors)
        if (!result.ok) {
            const first = FIELD_ORDER.find((k) => result.errors[k])
            // The label error belongs to the custom-label input (the chips are never empty).
            e.currentTarget.elements.namedItem(first === "label" ? "customLabel" : first)?.focus()
            return
        }
        setSaving(true)
        try {
            const payload = { ...result.values, isDefault: forceDefault || makeDefault }
            const saved = isEdit ? await updateAddress(address.id, payload) : await createAddress(payload)
            toast.success(isEdit ? "Address updated" : "Address saved")
            onSaved?.(saved)
            onClose()
        } catch (err) {
            // Server messages (e.g. the 10-address limit) are already user-readable.
            toast.error(err.message || "Could not save the address.")
            setSaving(false)
        }
    }

    return (
        <div
            className="fixed inset-0 z-[300] flex"
            style={{
                background: "var(--color-overlay)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)",
                alignItems: isMobile ? "flex-end" : "center", justifyContent: "center",
            }}
            onClick={() => { if (!saving) onClose() }}
        >
            <style>{`
        .addr-input{width:100%;background:${C.inputBg};border-radius:12px;padding:12px 16px;border:1px solid transparent;font-size:14px;color:${C.textPri};font-family:'Inter',sans-serif;outline:none;transition:border-color .15s,background .15s;}
        .addr-input:focus{border-color:${C.textPri};background:var(--color-surface);}
        .addr-input[aria-invalid="true"]{border-color:${C.red};}
        .addr-input::placeholder{color:${C.textSec};}
        .addr-check{appearance:none;-webkit-appearance:none;width:18px;height:18px;margin-top:1px;flex-shrink:0;border-radius:5px;border:1.5px solid var(--color-border-strong);background:var(--color-surface);cursor:pointer;}
        .addr-check:checked{background:var(--color-primary) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='white' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.5l3 3 6-6.5'/%3E%3C/svg%3E") center/80% no-repeat;border-color:var(--color-primary);}
        .addr-check:disabled{cursor:default;}
      `}</style>
            <form
                role="dialog"
                aria-modal="true"
                aria-label={isEdit ? "Edit address" : "Add new address"}
                noValidate
                onSubmit={submit}
                onClick={(e) => e.stopPropagation()}
                className="bg-surface w-full"
                style={{
                    maxWidth: isMobile ? "100%" : "520px",
                    borderRadius: isMobile ? "16px 16px 0 0" : "16px",
                    padding: "24px",
                    paddingBottom: isMobile ? "calc(24px + env(safe-area-inset-bottom, 16px))" : "24px",
                    maxHeight: "92vh", overflowY: "auto",
                }}
            >
                <div className="flex items-center justify-between" style={{ marginBottom: "16px" }}>
                    <h2 style={{ fontSize: "18px", fontWeight: 700, color: C.textPri }}>{isEdit ? "Edit address" : "Add new address"}</h2>
                    <button type="button" onClick={onClose} disabled={saving} aria-label="Close"><X size={20} color={C.textSec} /></button>
                </div>

                <div className="flex flex-col" style={{ gap: "14px" }}>
                    {/* Label chips; "Other" reveals a free-text label */}
                    <div className="flex flex-col" style={{ gap: "6px" }}>
                        <span style={fieldLabel}>Save as</span>
                        <div className="flex flex-wrap" style={{ gap: "8px" }} role="radiogroup" aria-label="Address label">
                            {LABEL_PRESETS.map((p) => {
                                const active = labelChoice === p
                                return (
                                    <button
                                        key={p}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        onClick={() => { setLabelChoice(p); if (errors.label) setErrors((er) => ({ ...er, label: "" })) }}
                                        style={{
                                            padding: "7px 16px", borderRadius: "9999px", fontSize: "13px", fontWeight: 600,
                                            border: `1px solid ${active ? C.primary : C.border}`,
                                            background: active ? "color-mix(in srgb, var(--color-primary) 10%, transparent)" : "transparent",
                                            color: active ? C.primary : C.textPri,
                                        }}
                                    >
                                        {p}
                                    </button>
                                )
                            })}
                        </div>
                        {labelChoice === "Other" && (
                            <>
                                <input
                                    name="customLabel"
                                    className="addr-input"
                                    type="text"
                                    maxLength={30}
                                    placeholder="e.g. Parents' house"
                                    aria-label="Custom label"
                                    aria-invalid={!!errors.label}
                                    aria-describedby={errors.label ? "addr-err-label" : undefined}
                                    value={customLabel}
                                    onChange={(e) => { setCustomLabel(e.target.value); if (errors.label) setErrors((er) => ({ ...er, label: "" })) }}
                                    style={{ marginTop: "4px" }}
                                />
                                {errors.label && <span id="addr-err-label" role="alert" style={{ fontSize: "12px", fontWeight: 500, color: C.red }}>{errors.label}</span>}
                            </>
                        )}
                    </div>

                    <Field name="fullName" label="Full name" error={errors.fullName}>
                        <input {...bind("fullName")} type="text" autoComplete="name" maxLength={100} placeholder="Receiver's name" />
                    </Field>
                    <Field name="phone" label="Mobile number" error={errors.phone}>
                        <input {...bind("phone")} type="tel" inputMode="numeric" autoComplete="tel" maxLength={20} placeholder="10-digit mobile number" />
                    </Field>
                    <Field name="line1" label="Flat / House no., Building, Street" error={errors.line1}>
                        <input {...bind("line1")} type="text" autoComplete="address-line1" maxLength={200} placeholder="Flat / House no., Building, Street" />
                    </Field>
                    <Field name="line2" label="Area, Colony (optional)" error={errors.line2}>
                        <input {...bind("line2")} type="text" autoComplete="address-line2" maxLength={200} placeholder="Area, Colony" />
                    </Field>
                    <Field name="landmark" label="Landmark (optional)" error={errors.landmark}>
                        <input {...bind("landmark")} type="text" maxLength={100} placeholder="Near…" />
                    </Field>
                    <div className="grid grid-cols-2" style={{ gap: "10px" }}>
                        <Field name="city" label="City" error={errors.city}>
                            <input {...bind("city")} type="text" autoComplete="address-level2" maxLength={80} placeholder="City" />
                        </Field>
                        <Field name="state" label="State" error={errors.state}>
                            <input {...bind("state")} type="text" autoComplete="address-level1" maxLength={80} placeholder="State" />
                        </Field>
                    </div>
                    <Field name="pincode" label="Pincode" error={errors.pincode}>
                        <input
                            {...bind("pincode")}
                            type="text"
                            inputMode="numeric"
                            autoComplete="postal-code"
                            placeholder="6-digit pincode"
                            onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))}
                        />
                    </Field>

                    <label className="flex items-start" style={{ gap: "10px", opacity: forceDefault ? 0.75 : 1 }}>
                        <input
                            type="checkbox"
                            className="addr-check"
                            checked={forceDefault || makeDefault}
                            disabled={forceDefault}
                            onChange={(e) => setMakeDefault(e.target.checked)}
                        />
                        <span style={{ fontSize: "14px", fontWeight: 600, color: C.textPri, lineHeight: "20px" }}>
                            Make this my default address
                            {forceDefault && (
                                <span style={{ display: "block", fontSize: "12px", fontWeight: 500, color: C.textSec }}>
                                    {isEdit ? "This is your default address. Pick another address as default to change it." : "Your first address is always your default."}
                                </span>
                            )}
                        </span>
                    </label>
                </div>

                <div className="flex items-center justify-end" style={{ gap: "12px", marginTop: "24px" }}>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        style={{ border: `1px solid ${C.textPri}`, borderRadius: "9999px", padding: "10px 24px", fontSize: "14px", fontWeight: 600, color: C.textPri, background: "transparent", opacity: saving ? 0.5 : 1 }}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className="flex items-center justify-center"
                        style={{ background: C.primary, borderRadius: "9999px", padding: "10px 24px", fontSize: "14px", fontWeight: 700, color: "var(--color-inverse)", minWidth: "140px", opacity: saving ? 0.7 : 1 }}
                    >
                        {saving ? "Saving…" : isEdit ? "Save changes" : "Save address"}
                    </button>
                </div>
            </form>
        </div>
    )
}

export default AddressFormModal