import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import LegalPageLayout, { LegalSection } from "../../components/Common/LegalPageLayout"
import { getInvoiceSettings } from "../../services/settingsService"

/**
 * Help Center / FAQ (roadmap task 1.15).
 *
 * Question set and answer copy are shared verbatim with the mobile app's
 * `(app)/support/faq.jsx`, so the two apps answer the same question the same
 * way. Every answer describes what the apps can ACTUALLY do today:
 *   - Cancellation says "contact us" — no self-service cancel exists yet
 *     (roadmap Phase 6), matching the Refund Policy's own honest wording.
 *   - Payment methods are the three really supported (Razorpay / COD /
 *     WhatsApp-assisted), each admin-toggleable, hence "where enabled".
 *
 * Support email/phone read from the admin-configurable `invoiceSettings` row —
 * same source as the Contact page and the Refund Policy.
 */

const FAQS = [
    {
        q: "How do I track my order?",
        a: "Open My Orders from the account menu. Each order shows its current status as it moves through confirmed, shipped, and delivered. Completed orders move to Past Orders, where you can also download the invoice.",
    },
    {
        q: "What payment methods can I use?",
        a: "Cards, UPI, and netbanking through Razorpay, plus Cash on Delivery and WhatsApp-assisted ordering where enabled. The final amount is always calculated on our server, so the total you confirm at checkout is the total you pay.",
    },
    {
        q: "How much is delivery, and how long does it take?",
        a: "Orders above the free-shipping threshold ship free; below it a flat charge applies, and either way the exact amount is shown at checkout before you pay. Orders are usually handed to our delivery partner within 1–2 business days, then take a further 2–5 business days to arrive.",
        link: { to: "/shipping-policy", label: "See the Shipping Policy for current rates" },
    },
    {
        q: "Can I cancel an order?",
        a: "There's no self-service cancel button yet. If your order hasn't shipped, contact us with your order number as soon as possible and we'll cancel it for you. Once it has shipped it can't be cancelled, but you can request a return after it arrives.",
    },
    {
        q: "How do returns and refunds work?",
        a: "If something arrives damaged, incorrect, or not as described, contact us within the return window shown on the product page, with your order number, and we'll arrange a replacement or refund. Approved refunds on online payments go back to the original payment method via Razorpay, typically within 5–7 business days.",
        link: { to: "/refund-policy", label: "See the Refund Policy for full details" },
    },
    {
        q: "Why can't I review a product?",
        a: "Reviews are limited to items you've actually bought and received — we check your order history before accepting one. That's why every review on a product page carries a “Verified Purchase” badge.",
    },
    {
        q: "How do I use a promo code?",
        a: "Enter it in the cart before checking out. The discount is validated on our server against the code's rules (minimum order value, expiry, usage limits), and the updated total shows immediately if it applies.",
    },
    {
        q: "An item is out of stock. Can I be notified?",
        a: "Yes — save it to your Wishlist, then use “Notify Me” on the wishlist card. We record your interest against that item so you can be alerted when it comes back in stock.",
    },
    {
        q: "How do I change my details or password?",
        a: "Go to My Profile. You can edit your name, gender, date of birth, phone, and delivery address there, and change your password. Your email address is fixed to the one you signed up with.",
    },
]

const FaqItem = ({ question, answer, link, isOpen, onToggle }) => (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "10px", overflow: "hidden" }}>
        <button
            onClick={onToggle}
            aria-expanded={isOpen}
            className="w-full flex justify-between items-center gap-3 text-left"
            style={{ padding: "14px 16px", background: "var(--color-surface)", cursor: "pointer" }}
        >
            <span style={{ fontWeight: 600, fontSize: "15px", color: "var(--color-ink)" }}>{question}</span>
            <span
                style={{
                    transition: "transform 0.2s",
                    transform: isOpen ? "rotate(180deg)" : "none",
                    color: "var(--color-muted)",
                    fontSize: "12px",
                    flexShrink: 0,
                }}
            >
                ▼
            </span>
        </button>
        {isOpen && (
            <div style={{ padding: "12px 16px 16px", borderTop: "1px solid var(--color-border)", fontSize: "14px", lineHeight: "21px", color: "var(--color-body)" }}>
                <p>{answer}</p>
                {link && (
                    <p style={{ marginTop: "10px" }}>
                        <Link to={link.to} style={{ color: "var(--color-link)", fontWeight: 600 }}>
                            {link.label}
                        </Link>
                    </p>
                )}
            </div>
        )}
    </div>
)

const FaqPage = () => {
    const [openIndex, setOpenIndex] = useState(null)
    const [settings, setSettings] = useState(null)

    useEffect(() => {
        let active = true
        getInvoiceSettings().then((data) => active && setSettings(data)).catch(() => { })
        return () => { active = false }
    }, [])

    const supportEmail = settings?.supportEmail || settings?.email || ""
    const supportPhone = settings?.supportPhone || settings?.mobile || ""

    return (
        <LegalPageLayout title="Help Center" lastUpdated="October 2026">
            <p>
                Answers to the questions we get asked most. If yours isn&apos;t here, reach out using the
                contact details at the bottom of this page.
            </p>

            <div className="flex flex-col" style={{ gap: "10px" }}>
                {FAQS.map((item, i) => (
                    <FaqItem
                        key={item.q}
                        question={item.q}
                        answer={item.a}
                        link={item.link}
                        isOpen={openIndex === i}
                        onToggle={() => setOpenIndex(openIndex === i ? null : i)}
                    />
                ))}
            </div>

            <LegalSection title="Policies">
                <ul className="flex flex-col" style={{ gap: "6px" }}>
                    <li>
                        <Link to="/shipping-policy" style={{ color: "var(--color-link)", fontWeight: 600 }}>Shipping Policy</Link>
                    </li>
                    <li>
                        <Link to="/refund-policy" style={{ color: "var(--color-link)", fontWeight: 600 }}>Refund Policy</Link>
                    </li>
                    <li>
                        <Link to="/privacy-policy" style={{ color: "var(--color-link)", fontWeight: 600 }}>Privacy Policy</Link>
                    </li>
                    <li>
                        <Link to="/terms-conditions" style={{ color: "var(--color-link)", fontWeight: 600 }}>Terms &amp; Conditions</Link>
                    </li>
                </ul>
            </LegalSection>

            <LegalSection title="Still need help?">
                <p>
                    Reach us directly
                    {supportEmail ? <> at <a href={`mailto:${supportEmail}`} style={{ color: "var(--color-link)", fontWeight: 600 }}>{supportEmail}</a></> : null}
                    {supportPhone ? <> or call <a href={`tel:${supportPhone}`} style={{ color: "var(--color-link)", fontWeight: 600 }}>{supportPhone}</a></> : null}
                    . You can also use the <Link to="/contact" style={{ color: "var(--color-link)", fontWeight: 600 }}>Contact</Link> page.
                </p>
            </LegalSection>
        </LegalPageLayout>
    )
}

export default FaqPage