import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "react-toastify"
import { ArrowLeft, MapPin, Plus } from "lucide-react"
import AddressCard from "../../components/Address/AddressCard"
import AddressFormModal from "../../components/Address/AddressFormModal"
import useAddresses from "../../hooks/useAddresses"
import useIsMobile from "../../hooks/useIsMobile"
import { ADDRESS_LIMIT, deleteAddress, setDefaultAddress, isAddressBookMissing } from "../../utils/addresses"

const C = {
  pageBg: "var(--color-background)",
  primary: "var(--color-primary)",
  textPri: "var(--color-ink)",
  textSec: "var(--color-muted)",
  red: "var(--color-error)",
}

const AddressesPage = () => {
  const navigate = useNavigate()
  const isMobile = useIsMobile(640)
  const { addresses, status, error, reload } = useAddresses()

  const [form, setForm] = useState({ open: false, address: null })
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const atLimit = addresses.length >= ADDRESS_LIMIT
  const unavailable = status === "ready" && isAddressBookMissing()

  const handleSetDefault = async (a) => {
    if (busyId) return
    setBusyId(a.id)
    try {
      await setDefaultAddress(a.id)
      toast.success(`${a.label || "Address"} is now your default address`)
      reload()
    } catch (err) {
      toast.error(err.message || "Could not change the default address.")
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await deleteAddress(deleteTarget.id)
      toast.success("Address deleted")
      setDeleteTarget(null)
      reload()
    } catch (err) {
      toast.error(err.message || "Could not delete the address.")
    } finally {
      setDeleting(false)
    }
  }

  const addButton = (
    <button
      type="button"
      onClick={() => setForm({ open: true, address: null })}
      disabled={atLimit || unavailable}
      title={atLimit ? `You can save up to ${ADDRESS_LIMIT} addresses` : undefined}
      className="flex items-center justify-center flex-shrink-0"
      style={{
        gap: "6px", background: C.primary, color: "var(--color-inverse)", borderRadius: "9999px",
        padding: isMobile ? "9px 16px" : "10px 22px", fontSize: "14px", fontWeight: 700,
        opacity: atLimit || unavailable ? 0.45 : 1,
      }}
    >
      <Plus size={16} /> Add new address
    </button>
  )

  return (
    <div className="min-h-screen w-full" style={{ background: C.pageBg, fontFamily: "Inter, sans-serif", overflowX: "hidden", maxWidth: "100vw" }}>
      <div style={{ maxWidth: "860px", margin: "0 auto", padding: isMobile ? "96px 16px 96px" : "40px 24px" }}>
        {/* Header */}
        <div className="flex items-center justify-between" style={{ gap: "12px", marginBottom: "8px", flexWrap: "wrap" }}>
          <div className="flex items-center" style={{ gap: "10px", minWidth: 0 }}>
            <button type="button" onClick={() => navigate("/myprofile")} aria-label="Back to profile" className="flex items-center justify-center flex-shrink-0" style={{ width: "36px", height: "36px", borderRadius: "9999px", background: "var(--color-surface)" }}>
              <ArrowLeft size={18} color={C.textPri} />
            </button>
            <div className="flex flex-col" style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: isMobile ? "20px" : "24px", fontWeight: 700, color: C.textPri }}>My Addresses</h1>
              {status === "ready" && addresses.length > 0 && (
                <p style={{ fontSize: "13px", color: C.textSec }}>{addresses.length} of {ADDRESS_LIMIT} saved</p>
              )}
            </div>
          </div>
          {addButton}
        </div>

        {atLimit && (
          <p role="status" style={{ fontSize: "13px", fontWeight: 500, color: C.textSec, margin: "4px 0 0 46px" }}>
            You've reached the limit of {ADDRESS_LIMIT} saved addresses. Delete one to add another.
          </p>
        )}

        <div style={{ marginTop: "20px" }}>
          {status === "loading" && (
            <div className="flex flex-col animate-pulse" style={{ gap: "14px" }} aria-label="Loading addresses">
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ height: "148px", borderRadius: "12px", background: "var(--color-surface)" }} />
              ))}
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center text-center" style={{ gap: "12px", padding: "56px 16px", borderRadius: "12px", background: "var(--color-surface)" }}>
              <p style={{ fontSize: "14px", fontWeight: 600, color: C.red }}>{error}</p>
              <button type="button" onClick={reload} style={{ border: `1px solid ${C.textPri}`, borderRadius: "9999px", padding: "8px 24px", fontSize: "14px", fontWeight: 600, color: C.textPri }}>
                Retry
              </button>
            </div>
          )}

          {status === "ready" && addresses.length === 0 && (
            <div className="flex flex-col items-center text-center" style={{ gap: "12px", padding: "56px 16px", borderRadius: "12px", background: "var(--color-surface)" }}>
              <span className="flex items-center justify-center" style={{ width: "72px", height: "72px", borderRadius: "9999px", background: "var(--color-surface-muted)" }}>
                <MapPin size={30} color={C.primary} />
              </span>
              <h2 style={{ fontSize: "18px", fontWeight: 700, color: C.textPri }}>
                {unavailable ? "Address book unavailable" : "No saved addresses yet"}
              </h2>
              <p style={{ fontSize: "14px", color: C.textSec, maxWidth: "320px" }}>
                {unavailable ? "Saved addresses aren't available right now. Please try again later." : "Add an address so checkout is just a tap away."}
              </p>
            </div>
          )}

          {status === "ready" && addresses.length > 0 && (
            <div className="flex flex-col" style={{ gap: "14px" }}>
              {addresses.map((a) => (
                <AddressCard
                  key={a.id}
                  address={a}
                  busy={busyId === a.id}
                  onEdit={(addr) => setForm({ open: true, address: addr })}
                  onDelete={setDeleteTarget}
                  onSetDefault={handleSetDefault}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <AddressFormModal
        open={form.open}
        address={form.address}
        isFirst={addresses.length === 0}
        onClose={() => setForm({ open: false, address: null })}
        onSaved={reload}
      />

      {deleteTarget && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center p-4"
          style={{ background: "var(--color-overlay)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
          onClick={() => { if (!deleting) setDeleteTarget(null) }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Delete address"
            className="bg-surface w-full"
            style={{ maxWidth: "400px", borderRadius: "16px", padding: "24px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: C.textPri }}>Delete this address?</h3>
            <p style={{ fontSize: "14px", color: "var(--color-body)", marginTop: "8px", lineHeight: "21px" }}>
              {deleteTarget.label || "This address"} · {deleteTarget.fullName || deleteTarget.line1}
              {deleteTarget.isDefault && addresses.length > 1
                ? ". It is your default address — your most recently added address will become the default."
                : "."}
            </p>
            <div className="flex items-center justify-end" style={{ gap: "12px", marginTop: "20px" }}>
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} style={{ border: `1px solid ${C.textPri}`, borderRadius: "9999px", padding: "9px 22px", fontSize: "14px", fontWeight: 600, color: C.textPri, opacity: deleting ? 0.5 : 1 }}>
                Cancel
              </button>
              <button type="button" onClick={handleDelete} disabled={deleting} style={{ background: C.red, borderRadius: "9999px", padding: "9px 22px", fontSize: "14px", fontWeight: 700, color: "var(--color-inverse)", opacity: deleting ? 0.7 : 1 }}>
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AddressesPage