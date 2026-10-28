// Shared wrapper for the policy pages (Privacy/Refund/Terms/Shipping) — same
// title + last-updated + prose layout, content supplied per page.
const LegalPageLayout = ({ title, lastUpdated, children }) => {
    return (
        <div className="mx-auto pt-24 sm:pt-6 pb-16 px-5 sm:px-8" style={{ maxWidth: "760px" }}>
            <h1 style={{ fontWeight: 700, fontSize: "32px", color: "var(--color-ink)" }}>{title}</h1>
            {lastUpdated && (
                <p style={{ fontWeight: 500, fontSize: "13px", color: "var(--color-muted)", marginTop: "6px" }}>
                    Last updated: {lastUpdated}
                </p>
            )}
            <div
                className="flex flex-col"
                style={{ gap: "20px", marginTop: "28px", fontSize: "15px", lineHeight: "24px", color: "var(--color-body)" }}
            >
                {children}
            </div>
        </div>
    )
}

export const LegalSection = ({ title, children }) => (
    <section>
        <h2 style={{ fontWeight: 600, fontSize: "18px", color: "var(--color-ink)", marginBottom: "8px" }}>{title}</h2>
        <div>{children}</div>
    </section>
)

export default LegalPageLayout