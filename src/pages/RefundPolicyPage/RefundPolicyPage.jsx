import { useEffect, useMemo, useState } from "react"
import LegalPageLayout, { LegalSection } from "../../components/Common/LegalPageLayout"
import { getInvoiceSettings, getReturnPolicyDefaults } from "../../services/settingsService"
import { returnPolicyCopy } from "../../features/products/policyCopy"

const RefundPolicyPage = () => {
    const [settings, setSettings] = useState(null)
    const [policyDoc, setPolicyDoc] = useState(null)

    useEffect(() => {
        let active = true
        getInvoiceSettings().then((data) => active && setSettings(data)).catch(() => { })
        // the return window is a STORE setting (Admin > Optimization), not a number in this file; each product shows its own
        getReturnPolicyDefaults().then((data) => active && setPolicyDoc(data)).catch(() => { })
        return () => { active = false }
    }, [])

    const supportEmail = settings?.supportEmail || settings?.email || ""
    const supportPhone = settings?.supportPhone || settings?.mobile || ""
    const copy = useMemo(() => returnPolicyCopy(policyDoc), [policyDoc])

    return (
        <LegalPageLayout title="Refund Policy" lastUpdated="October 2026">
            <LegalSection title="Cancellations">
                <p>
                    To cancel an order before it ships, contact us as soon as possible using the details below —
                    include your order number so we can act quickly. Once an order has shipped, it can no longer
                    be cancelled; you're welcome to request a return instead once it arrives.
                </p>
            </LegalSection>
            <LegalSection title="Returns">
                {copy.returns.map((text, i) => (
                    <p key={i} className={i > 0 ? "mt-3" : ""}>{text}</p>
                ))}
            </LegalSection>
            <LegalSection title="Exchanges">
                {copy.exchanges.map((text, i) => (
                    <p key={i} className={i > 0 ? "mt-3" : ""}>{text}</p>
                ))}
            </LegalSection>
            <LegalSection title="Refund timing">
                <p>
                    Approved refunds for online payments are credited back to the original payment method via
                    Razorpay, typically within 5–7 business days. Cash on Delivery refunds are processed as store
                    credit or bank transfer, whichever we agree with you.
                </p>
            </LegalSection>
            <LegalSection title="How to request one">
                <p>
                    Find your order number under My Orders or Past Orders, then reach out to us directly
                    {supportEmail ? <> at <a href={`mailto:${supportEmail}`} style={{ color: "var(--color-link)", fontWeight: 600 }}>{supportEmail}</a></> : null}
                    {supportPhone ? <> or call <a href={`tel:${supportPhone}`} style={{ color: "var(--color-link)", fontWeight: 600 }}>{supportPhone}</a></> : null}.
                </p>
            </LegalSection>
        </LegalPageLayout>
    )
}

export default RefundPolicyPage