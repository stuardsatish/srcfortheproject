import { Link } from "react-router-dom"
import { Truck, RotateCcw } from "lucide-react"

/**
 * Compact "Delivery & Returns" reassurance block (roadmap task 1.17).
 *
 * Shown on the product page and in the cart — the two points where a buyer is
 * deciding whether to commit and wants the delivery/returns terms to hand.
 * Counterpart of the mobile app's `components/PolicyLinks.jsx`, same two rows
 * and same destinations.
 *
 * Deliberately links rather than inlining the copy: the policy pages read live
 * `shippingSettings`/`invoiceSettings`, so duplicating their text here would
 * risk the two drifting apart.
 */
const ROWS = [
    { to: "/shipping-policy", label: "Delivery & shipping charges", Icon: Truck },
    { to: "/refund-policy", label: "Returns & refunds", Icon: RotateCcw },
]

const PolicyLinks = ({ style }) => (
    <div
        style={{
            border: "1px solid color-mix(in srgb, var(--color-border) 40%, transparent)",
            borderRadius: "12px",
            overflow: "hidden",
            ...style,
        }}
    >
        {ROWS.map((row, i) => {
            const RowIcon = row.Icon
            return (
                <Link
                    key={row.to}
                    to={row.to}
                    className="flex items-center justify-between hover:opacity-70 transition"
                    style={{
                        padding: "14px 16px",
                        background: "var(--color-surface)",
                        borderTop: i > 0 ? "1px solid color-mix(in srgb, var(--color-border) 40%, transparent)" : "none",
                    }}
                >
                    <span className="flex items-center" style={{ gap: "12px" }}>
                        <RowIcon size={17} color="var(--color-primary)" />
                        <span style={{ fontWeight: 500, fontSize: "13px", color: "var(--color-ink)" }}>{row.label}</span>
                    </span>
                    <span style={{ color: "var(--color-muted)", fontSize: "14px" }}>›</span>
                </Link>
            )
        })}
    </div>
)

export default PolicyLinks