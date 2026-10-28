import { useEffect, useState } from "react"
import LegalPageLayout, { LegalSection } from "../../components/Common/LegalPageLayout"
import { getShippingSettings } from "../../services/settingsService"

const money = (n) => `₹${Number(n || 0).toFixed(2)}`

const ShippingPolicyPage = () => {
    const [shipping, setShipping] = useState(null)

    useEffect(() => {
        let active = true
        getShippingSettings().then((data) => active && setShipping(data)).catch(() => { })
        return () => { active = false }
    }, [])

    return (
        <LegalPageLayout title="Shipping Policy" lastUpdated="October 2026">
            <LegalSection title="Shipping cost">
                {shipping ? (
                    <p>
                        Orders over {money(shipping.freeShippingThreshold)} ship free. Orders under that amount
                        have a flat shipping charge of {money(shipping.shippingCost)}, shown at checkout before
                        you pay.
                    </p>
                ) : (
                    <p>Shipping cost is calculated at checkout based on your order total.</p>
                )}
            </LegalSection>
            <LegalSection title="Delivery time">
                <p>
                    Most orders are packed and handed to our delivery partner within 1–2 business days. Delivery
                    typically takes a further 2–5 business days depending on your location.
                </p>
            </LegalSection>
            <LegalSection title="Order tracking">
                <p>
                    You can check the current status of any order from My Orders. We'll also update the order
                    status as it moves through confirmed, shipped, and delivered.
                </p>
            </LegalSection>
            <LegalSection title="Delivery issues">
                <p>
                    If your order hasn't arrived within the expected window, or arrives damaged, contact us with
                    your order number and we'll look into it right away.
                </p>
            </LegalSection>
        </LegalPageLayout>
    )
}

export default ShippingPolicyPage