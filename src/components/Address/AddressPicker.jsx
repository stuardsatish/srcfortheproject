import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "react-toastify"
import { Plus } from "lucide-react"
import RightDrawer from "../Common/RightDrawer"
import AddressFormModal from "./AddressFormModal"
import useAddresses from "../../hooks/useAddresses"
import { ADDRESS_LIMIT, formatAddressLine, setDefaultAddress, isAddressBookMissing } from "../../utils/addresses"

const C = {
    primary: "var(--color-primary)",
    textPri: "var(--color-ink)",
    textSec: "var(--color-muted)",
    border: "color-mix(in srgb, var(--color-border) 60%, transparent)",
}

/**
 * Checkout address picker. "Selecting" an address means making it the default:
 * the database mirrors the default into `profiles.address`, which checkout and
 * the order functions already read, and `setDefaultAddress` refreshes Redux.
 */
const AddressPicker = ({ open, onClose }) => {
    const navigate = useNavigate()
    const { addresses, status, error, reload } = useAddresses(open)
    const [busyId, setBusyId] = useState(null)
    const [formOpen, setFormOpen] = useState(false)

    const atLimit = addresses.length >= ADDRESS_LIMIT

    const choose = async (a) => {
        if (busyId) return
        if (a.isDefault) { onClose(); return }
        setBusyId(a.id)
        try {
            await setDefaultAddress(a.id)
            toast.success(`Delivering to ${a.label || "this address"}`)
            onClose()
        } catch (err) {
            toast.error(err.message || "Could not change the delivery address.")
        } finally {
            setBusyId(null)
        }
    }

    return (
        <>
            {/* While the form is on top, Escape / backdrop belong to the form. */}
            <RightDrawer open={open} onClose={() => { if (!formOpen) onClose() }} title="Deliver to" widthPx={440} zIndex={260}>
                {status === "loading" && (
                    <div className="flex flex-col animate-pulse" style={{ gap: "12px" }} aria-label="Loading addresses">
                        {[0, 1].map((i) => (
                            <div key={i} style={{ height: "96px", borderRadius: "12px", background: "var(--color-surface-muted)" }} />
                        ))}
                    </div>
                )}

                {status === "error" && (
                    <div className="flex flex-col items-center text-center" style={{ gap: "12px", padding: "24px 0" }}>
                        <p style={{ fontSize: "14px", color: "var(--color-error)", fontWeight: 600 }}>{error}</p>
                        <button onClick={reload} style={{ border: `1px solid ${C.textPri}`, borderRadius: "9999px", padding: "8px 20px", fontSize: "14px", fontWeight: 600, color: C.textPri }}>
                            Retry
                        </button>
                    </div>
                )}

                {status === "ready" && (
                    <>
                        {addresses.length === 0 && (
                            <p style={{ fontSize: "14px", color: C.textSec, textAlign: "center", padding: "16px 0" }}>
                                {isAddressBookMissing() ? "Saved addresses aren't available right now." : "You haven't saved an address yet."}
                            </p>
                        )}

                        <div className="flex flex-col" style={{ gap: "12px" }} role="radiogroup" aria-label="Delivery address">
                            {addresses.map((a) => {
                                const busy = busyId === a.id
                                return (
                                    <button
                                        key={a.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={a.isDefault}
                                        disabled={!!busyId}
                                        onClick={() => choose(a)}
                                        className="flex text-left"
                                        style={{
                                            gap: "12px", padding: "14px 16px", borderRadius: "12px",
                                            border: `1.5px solid ${a.isDefault ? C.primary : C.border}`,
                                            background: a.isDefault ? "color-mix(in srgb, var(--color-primary) 6%, transparent)" : "var(--color-surface)",
                                            opacity: busyId && !busy ? 0.6 : 1,
                                        }}
                                    >
                                        <span
                                            aria-hidden="true"
                                            className="flex items-center justify-center flex-shrink-0"
                                            style={{ width: "18px", height: "18px", marginTop: "2px", borderRadius: "9999px", border: `2px solid ${a.isDefault ? C.primary : "var(--color-border-strong)"}` }}
                                        >
                                            {a.isDefault && <span style={{ width: "8px", height: "8px", borderRadius: "9999px", background: C.primary }} />}
                                        </span>
                                        <span className="flex flex-col" style={{ gap: "4px", minWidth: 0, flex: 1 }}>
                                            <span className="flex items-center flex-wrap" style={{ gap: "8px" }}>
                                                <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: C.primary, background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", padding: "2px 8px", borderRadius: "9999px" }}>
                                                    {a.label || "Address"}
                                                </span>
                                                {a.isDefault && <span style={{ fontSize: "11px", fontWeight: 600, color: C.textSec }}>Default</span>}
                                                {busy && <span style={{ fontSize: "11px", fontWeight: 600, color: C.textSec }}>Selecting…</span>}
                                            </span>
                                            <span style={{ fontSize: "14px", fontWeight: 700, color: C.textPri }}>
                                                {a.fullName || "—"}{a.phone ? ` · ${a.phone}` : ""}
                                            </span>
                                            <span style={{ fontSize: "13px", color: "var(--color-body)", lineHeight: "19px", wordBreak: "break-word" }}>{formatAddressLine(a)}</span>
                                        </span>
                                    </button>
                                )
                            })}
                        </div>

                        <button
                            type="button"
                            onClick={() => setFormOpen(true)}
                            disabled={atLimit || isAddressBookMissing()}
                            className="flex items-center justify-center"
                            style={{ gap: "8px", padding: "14px", borderRadius: "12px", border: `1px dashed ${C.border}`, color: C.primary, fontSize: "14px", fontWeight: 600, background: "transparent", opacity: atLimit ? 0.55 : 1 }}
                        >
                            <Plus size={16} /> Add new address
                        </button>
                        {atLimit && (
                            <p style={{ fontSize: "12px", color: C.textSec, marginTop: "-6px" }}>
                                You can save up to {ADDRESS_LIMIT} addresses. Delete one to add another.
                            </p>
                        )}

                        <button
                            type="button"
                            onClick={() => { onClose(); navigate("/addresses") }}
                            style={{ fontSize: "13px", fontWeight: 700, color: C.primary, alignSelf: "center" }}
                        >
                            Manage addresses
                        </button>
                    </>
                )}
            </RightDrawer>

            <AddressFormModal
                open={formOpen}
                onClose={() => setFormOpen(false)}
                isFirst={addresses.length === 0}
                preselectDefault
                onSaved={(saved) => { if (saved?.isDefault) onClose(); else reload() }}
            />
        </>
    )
}

export default AddressPicker