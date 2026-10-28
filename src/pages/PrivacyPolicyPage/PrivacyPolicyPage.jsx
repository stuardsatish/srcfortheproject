import { useEffect, useState } from "react"
import LegalPageLayout, { LegalSection } from "../../components/Common/LegalPageLayout"
import { getInvoiceSettings } from "../../services/settingsService"

const PrivacyPolicyPage = () => {
    const [settings, setSettings] = useState(null)

    useEffect(() => {
        let active = true
        getInvoiceSettings().then((data) => active && setSettings(data)).catch(() => { })
        return () => { active = false }
    }, [])

    const companyName = settings?.companyName || "us"
    const supportEmail = settings?.supportEmail || settings?.email || ""

    return (
        <LegalPageLayout title="Privacy Policy" lastUpdated="October 2026">
            <LegalSection title="What we collect">
                <p>
                    When you create an account or place an order with {companyName}, we collect the information
                    you provide directly — your name, email, phone number, delivery address, and order history.
                    We also store basic device/session information to keep your account secure.
                </p>
            </LegalSection>
            <LegalSection title="How we use it">
                <p>
                    We use this information to process orders, send order updates, provide customer support, and
                    improve our catalog and service. We do not sell your personal information to third parties.
                </p>
            </LegalSection>
            <LegalSection title="Payment information">
                <p>
                    Payments are processed by Razorpay. We do not store your card, UPI, or bank details ourselves —
                    they are handled directly by our payment partner under their own security standards.
                </p>
            </LegalSection>
            <LegalSection title="Your choices">
                <p>
                    You can review and update your profile details at any time from My Profile. If you'd like your
                    account or data removed, contact us using the details on our Contact page.
                </p>
            </LegalSection>
            {supportEmail && (
                <LegalSection title="Contact us">
                    <p>Questions about this policy? Email us at <a href={`mailto:${supportEmail}`} style={{ color: "var(--color-link)", fontWeight: 600 }}>{supportEmail}</a>.</p>
                </LegalSection>
            )}
        </LegalPageLayout>
    )
}

export default PrivacyPolicyPage