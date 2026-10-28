import { formatAddressLine } from "../../utils/addresses"

const C = {
    primary: "var(--color-primary)",
    textPri: "var(--color-ink)",
    textSec: "var(--color-muted)",
    red: "var(--color-error)",
}

const actionBtn = (color, disabled) => ({
    fontSize: "13px", fontWeight: 700, color, padding: "6px 0", opacity: disabled ? 0.5 : 1,
})

/** One saved address in the address book list. */
const AddressCard = ({ address, busy = false, onEdit, onDelete, onSetDefault }) => {
    const a = address
    return (
        <article
            className="flex flex-col"
            style={{
                gap: "10px", padding: "16px 20px", borderRadius: "12px",
                background: "var(--color-surface)",
                border: `1px solid ${a.isDefault ? C.primary : "var(--color-border)"}`,
                boxShadow: "0px 4px 20px rgba(26,43,60,0.05)",
            }}
        >
            <div className="flex items-center flex-wrap" style={{ gap: "8px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: C.primary, background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", padding: "3px 10px", borderRadius: "9999px" }}>
                    {a.label || "Address"}
                </span>
                {a.isDefault && (
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-success)", background: "var(--color-success-subtle)", padding: "3px 10px", borderRadius: "9999px" }}>
                        Default
                    </span>
                )}
            </div>

            <div className="flex flex-col" style={{ gap: "4px" }}>
                <span style={{ fontSize: "14px", fontWeight: 700, color: C.textPri }}>
                    {a.fullName || "—"}{a.phone ? ` · ${a.phone}` : ""}
                </span>
                <span style={{ fontSize: "14px", color: "var(--color-body)", lineHeight: "21px", wordBreak: "break-word" }}>{formatAddressLine(a)}</span>
                {a.landmark && <span style={{ fontSize: "12px", color: C.textSec }}>Landmark: {a.landmark}</span>}
            </div>

            <div className="flex items-center flex-wrap" style={{ gap: "20px", borderTop: "1px solid var(--color-border-subtle)", paddingTop: "8px" }}>
                <button type="button" onClick={() => onEdit(a)} disabled={busy} style={actionBtn(C.primary, busy)}>Edit</button>
                <button type="button" onClick={() => onDelete(a)} disabled={busy} style={actionBtn(C.red, busy)}>Delete</button>
                {!a.isDefault && (
                    <button type="button" onClick={() => onSetDefault(a)} disabled={busy} style={{ ...actionBtn(C.textPri, busy), marginLeft: "auto" }}>
                        {busy ? "Updating…" : "Set as default"}
                    </button>
                )}
            </div>
        </article>
    )
}

export default AddressCard