import React from "react"

// Return / exchange policy editor for ONE purchasable option (a product, or a variant that overrides it).
// Return and exchange are independent: each has its own ON/OFF and its own window in days.
// A window is only meaningful (and only sent) while its policy is ON — the DB enforces the same rule.
//
//   value:    { returnEnabled, returnDays, exchangeEnabled, exchangeDays }   (days are strings, as typed)
//   onChange: (nextValue) => void
//   idPrefix: unique prefix for the input ids (a page can render this component several times)

const BORDER = "var(--color-border)"
const MUTED = "var(--color-body)"

const inputCls =
    "w-24 bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-[var(--color-ring)] disabled:opacity-40"

function PolicyRow({ id, title, enabled, days, onToggle, onDays }) {
    return (
        <div className="flex flex-wrap items-center gap-3 py-2">
            <label htmlFor={`${id}-on`} className="flex items-center gap-2 cursor-pointer min-w-[190px]">
                <input id={`${id}-on`} type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
                <span className="text-[13px] font-semibold">{title}</span>
            </label>
            <label htmlFor={`${id}-days`} className="flex items-center gap-2 text-[13px]" style={{ color: MUTED }}>
                Within
                <input
                    id={`${id}-days`}
                    type="number" min={1} max={365} step={1} inputMode="numeric"
                    value={enabled ? days : ""}
                    placeholder="—"
                    disabled={!enabled}
                    onChange={(e) => onDays(e.target.value)}
                    className={inputCls}
                    aria-label={`${title}: window in days`}
                />
                days of delivery
            </label>
        </div>
    )
}

export default function PolicyFields({ value, onChange, idPrefix = "policy" }) {
    const set = (patch) => onChange({ ...value, ...patch })
    return (
        <div className="rounded-xl px-4 py-2" style={{ border: `1px solid ${BORDER}`, background: "var(--color-surface)" }}>
            <PolicyRow
                id={`${idPrefix}-return`} title="Returns accepted"
                enabled={value.returnEnabled} days={value.returnDays}
                onToggle={(on) => set({ returnEnabled: on })}
                onDays={(d) => set({ returnDays: d })}
            />
            <PolicyRow
                id={`${idPrefix}-exchange`} title="Exchanges accepted"
                enabled={value.exchangeEnabled} days={value.exchangeDays}
                onToggle={(on) => set({ exchangeEnabled: on })}
                onDays={(d) => set({ exchangeDays: d })}
            />
            <p className="text-[11px] pb-2" style={{ color: MUTED }}>
                Measured from the recorded delivery date. A customer can only request what is ON here, and only inside the window.
                The policy in force when an order is placed is saved on that order, so later edits never change existing orders.
            </p>
        </div>
    )
}