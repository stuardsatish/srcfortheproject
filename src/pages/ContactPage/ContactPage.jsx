import { useEffect, useState } from "react"
import { Mail, Phone, MapPin, Globe } from "lucide-react"
import { getInvoiceSettings } from "../../services/settingsService"

const InfoRow = ({ icon, label, value, href }) => {
    if (!value) return null
    const content = (
        <div className="flex items-start" style={{ gap: "14px" }}>
            <div
                className="flex items-center justify-center flex-shrink-0"
                style={{ width: "40px", height: "40px", borderRadius: "9999px", background: "var(--color-surface-muted)", color: "var(--color-primary)" }}
            >
                {icon}
            </div>
            <div className="flex flex-col">
                <span style={{ fontWeight: 600, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--color-muted)" }}>{label}</span>
                <span style={{ fontWeight: 500, fontSize: "16px", color: "var(--color-ink)" }}>{value}</span>
            </div>
        </div>
    )
    return href ? <a href={href} className="block" style={{ textDecoration: "none" }}>{content}</a> : content
}

const ContactPage = () => {
    const [settings, setSettings] = useState(null)

    useEffect(() => {
        let active = true
        getInvoiceSettings()
            .then((data) => active && setSettings(data))
            .catch((err) => console.log("ContactPage settings error:", err))
        return () => { active = false }
    }, [])

    const email = settings?.supportEmail || settings?.email || ""
    const phone = settings?.supportPhone || settings?.mobile || ""
    const address = settings?.address || ""
    const website = settings?.website || ""

    return (
        <div className="mx-auto pt-24 sm:pt-6 pb-16 px-5 sm:px-8" style={{ maxWidth: "720px" }}>
            <h1 style={{ fontWeight: 700, fontSize: "32px", color: "var(--color-ink)" }}>Contact Us</h1>
            <p style={{ fontWeight: 400, fontSize: "15px", color: "var(--color-body)", marginTop: "8px", marginBottom: "32px" }}>
                Questions about an order, a product, or anything else? Reach out any of the ways below.
            </p>

            <div className="flex flex-col" style={{ gap: "24px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "16px", padding: "28px" }}>
                <InfoRow icon={<Mail size={18} />} label="Email" value={email} href={email ? `mailto:${email}` : undefined} />
                <InfoRow icon={<Phone size={18} />} label="Phone" value={phone} href={phone ? `tel:${phone}` : undefined} />
                <InfoRow icon={<MapPin size={18} />} label="Address" value={address} />
                <InfoRow icon={<Globe size={18} />} label="Website" value={website} href={website ? (website.startsWith("http") ? website : `https://${website}`) : undefined} />
            </div>

            <p style={{ fontWeight: 400, fontSize: "13px", color: "var(--color-muted)", marginTop: "24px" }}>
                For order-specific help, you can also check the status and details of any order from{" "}
                <a href="/userorders" style={{ color: "var(--color-link)", fontWeight: 600 }}>My Orders</a>.
            </p>
        </div>
    )
}

export default ContactPage