import { useEffect, useState } from "react"
import LegalPageLayout, { LegalSection } from "../../components/Common/LegalPageLayout"
import { getInvoiceSettings } from "../../services/settingsService"

const TermsPage = () => {
    const [settings, setSettings] = useState(null)

    useEffect(() => {
        let active = true
        getInvoiceSettings().then((data) => active && setSettings(data)).catch(() => { })
        return () => { active = false }
    }, [])

    const companyName = settings?.companyName || "us"

    return (
        <LegalPageLayout title="Terms & Conditions" lastUpdated="October 2026">
            <LegalSection title="Using this site">
                <p>
                    By creating an account or placing an order with {companyName}, you agree to these terms.
                    You're responsible for keeping your login credentials secure and for the accuracy of the
                    delivery and contact details you provide.
                </p>
            </LegalSection>
            <LegalSection title="Orders & pricing">
                <p>
                    Prices, stock levels, and discounts shown on the site are set by us and may change without
                    notice. The price and availability confirmed at checkout is what applies to your order — the
                    final amount is always calculated server-side, never trusted from the browser.
                </p>
            </LegalSection>
            <LegalSection title="Payments">
                <p>
                    Online payments are processed through Razorpay (cards, UPI, netbanking); Cash on Delivery and
                    WhatsApp-assisted ordering may also be offered where enabled. Placing an order is an offer to
                    buy, which we accept once payment is confirmed or the order is placed for COD.
                </p>
            </LegalSection>
            <LegalSection title="Reviews">
                <p>
                    Product reviews can only be submitted for items you've actually purchased and received. We
                    reserve the right to remove reviews that are abusive, spam, or unrelated to the product.
                </p>
            </LegalSection>
            <LegalSection title="Changes">
                <p>
                    We may update these terms from time to time; continued use of the site after a change means
                    you accept the updated terms.
                </p>
            </LegalSection>
        </LegalPageLayout>
    )
}

export default TermsPage