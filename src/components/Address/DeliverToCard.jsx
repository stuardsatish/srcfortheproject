import { useSelector } from "react-redux"
import { MapPin, Plus } from "lucide-react"
import { addressFromProfile, formatAddressLine } from "../../utils/addresses"

const C = {
    primary: "var(--color-primary)",
    textPri: "var(--color-ink)",
    textSec: "var(--color-muted)",
}

/**
 * "Deliver to" card for the checkout area. Reads the default address straight
 * from the Redux profile (`user.address`, which the address service keeps in
 * step with the address book), so it updates the moment a default changes.
 *
 * `onChange` opens the picker; `onAdd` opens the add-address form (shown when
 * the customer has no address on file).
 */
const DeliverToCard = ({ onChange, onAdd, compact = false }) => {
    const profileAddress = useSelector((s) => s.user.user?.address)
    const address = addressFromProfile(profileAddress)
    const pad = compact ? "14px 16px" : "20px 24px"

    if (!address) {
        return (
            <button
                type="button"
                onClick={onAdd}
                className="flex items-center w-full text-left"
                style={{
                    gap: "12px", padding: pad, borderRadius: "12px",
                    border: "1px dashed var(--color-border-strong)", background: "var(--color-surface)",
                }}
            >
                <span className="flex items-center justify-center flex-shrink-0" style={{ width: "36px", height: "36px", borderRadius: "9999px", background: "color-mix(in srgb, var(--color-primary) 10%, transparent)" }}>
                    <Plus size={18} color={C.primary} />
                </span>
                <span className="flex flex-col" style={{ gap: "2px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: C.primary }}>Add delivery address</span>
                    <span style={{ fontSize: "12px", color: C.textSec }}>We need an address to deliver your order.</span>
                </span>
            </button>
        )
    }

    const who = [address.fullName, address.phone].filter(Boolean).join(" · ")

    return (
        <div
            className="flex"
            style={{
                gap: "12px", padding: pad, borderRadius: "12px", alignItems: "flex-start",
                background: "var(--color-surface)", border: "1px solid var(--color-border)",
                boxShadow: "0px 4px 12px color-mix(in srgb, var(--color-accent) 5%, transparent)",
            }}
        >
            <MapPin size={18} color={C.primary} className="flex-shrink-0" style={{ marginTop: "2px" }} />
            <div className="flex flex-col" style={{ gap: "4px", minWidth: 0, flex: 1 }}>
                <div className="flex items-center flex-wrap" style={{ gap: "8px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", color: C.textSec }}>Deliver to</span>
                    {address.label && (
                        <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: C.primary, background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", padding: "2px 8px", borderRadius: "9999px" }}>
                            {address.label}
                        </span>
                    )}
                </div>
                {who && <span style={{ fontSize: "14px", fontWeight: 700, color: C.textPri }}>{who}</span>}
                <span style={{ fontSize: "13px", color: "var(--color-body)", lineHeight: "19px", wordBreak: "break-word" }}>{formatAddressLine(address)}</span>
            </div>
            <button
                type="button"
                onClick={onChange}
                className="flex-shrink-0"
                style={{ fontSize: "13px", fontWeight: 700, color: C.primary, padding: "4px 2px" }}
            >
                Change
            </button>
        </div>
    )
}

export default DeliverToCard