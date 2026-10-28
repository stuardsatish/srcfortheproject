import { Truck, RefreshCw, ShieldCheck, Headphones, CreditCard } from "lucide-react"

const SERVICES = [
    {
        icon: <Truck size={22} />,
        title: "Fast Shipping",
        description: "Orders are packed and shipped promptly, with free delivery over our minimum order threshold.",
    },
    {
        icon: <RefreshCw size={22} />,
        title: "Easy Returns",
        description: "Not happy with an order? Reach out to our support team and we'll help sort it out.",
    },
    {
        icon: <CreditCard size={22} />,
        title: "Secure Payments",
        description: "Pay by card, UPI, or netbanking through Razorpay, or choose Cash on Delivery — your choice.",
    },
    {
        icon: <ShieldCheck size={22} />,
        title: "Quality Assurance",
        description: "Every product listing is reviewed for accuracy, so what you see is what you get.",
    },
    {
        icon: <Headphones size={22} />,
        title: "Customer Support",
        description: "Have a question about an order or product? Our Contact page has the fastest way to reach us.",
    },
]

const ServicesPage = () => {
    return (
        <div className="mx-auto pt-24 sm:pt-6 pb-16 px-5 sm:px-8" style={{ maxWidth: "960px" }}>
            <h1 style={{ fontWeight: 700, fontSize: "32px", color: "var(--color-ink)" }}>Our Services</h1>
            <p style={{ fontWeight: 400, fontSize: "15px", color: "var(--color-body)", marginTop: "8px", marginBottom: "32px" }}>
                A few things we take seriously so you can shop with confidence.
            </p>

            <div className="grid sm:grid-cols-2" style={{ gap: "20px" }}>
                {SERVICES.map((service) => (
                    <div
                        key={service.title}
                        className="flex flex-col"
                        style={{ gap: "12px", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "16px", padding: "24px" }}
                    >
                        <div
                            className="flex items-center justify-center"
                            style={{ width: "48px", height: "48px", borderRadius: "9999px", background: "var(--color-surface-muted)", color: "var(--color-primary)" }}
                        >
                            {service.icon}
                        </div>
                        <h2 style={{ fontWeight: 600, fontSize: "18px", color: "var(--color-ink)" }}>{service.title}</h2>
                        <p style={{ fontWeight: 400, fontSize: "14px", lineHeight: "20px", color: "var(--color-body)" }}>{service.description}</p>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default ServicesPage