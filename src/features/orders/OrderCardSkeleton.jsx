import Skeleton from "../../components/Common/Skeleton";

/**
 * Mobile order-card skeleton — mirrors the compact card rendered in the
 * <lg order lists (/userorders, /userpastorders): a rounded-12 surface card
 * with a header row (order id on the left, price + status pill on the right)
 * over a couple of product rows (44×44 thumb + title/qty lines).
 *
 * Desktop order lists use their own inline skeleton (see UserOrdersPage /
 * UserPastOrdersPage), so this component only needs to track the mobile card.
 */
const OrderCardSkeleton = () => {
    return (
        <div
            className="bg-surface"
            style={{ borderRadius: "12px", padding: "16px", boxShadow: "0px 4px 20px rgba(26,43,60,0.05)" }}
            aria-hidden="true"
        >
            {/* Header row: order id (left) + price & status pill (right) */}
            <div
                className="flex items-center justify-between"
                style={{ borderBottom: "1px solid var(--color-surface-muted)", paddingBottom: "12px", marginBottom: "12px", gap: "8px" }}
            >
                <div className="flex flex-col" style={{ gap: "6px" }}>
                    <Skeleton className="h-2.5 w-10" />
                    <Skeleton className="h-3.5 w-24" />
                </div>
                <div className="flex items-center flex-shrink-0" style={{ gap: "10px" }}>
                    <Skeleton className="h-4 w-14" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                </div>
            </div>

            {/* Product rows */}
            <div className="flex flex-col" style={{ gap: "10px" }}>
                {[...Array(2)].map((_, i) => (
                    <div key={i} className="flex items-center" style={{ gap: "10px" }}>
                        <Skeleton className="w-11 h-11 rounded-lg flex-shrink-0" />
                        <div className="flex flex-col" style={{ gap: "6px", flex: 1 }}>
                            <Skeleton className="h-3.5 w-1/2" />
                            <Skeleton className="h-2.5 w-1/4" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default OrderCardSkeleton;