import { useState } from "react"
import ModalShell from "../../../components/Common/ModalShell"
import { ERROR_STYLE, GHOST_BTN, HINT_STYLE, INPUT_STYLE, LABEL_STYLE, PRIMARY_BTN } from "../../orders/shipping/shipmentUi"

/**
 * A small "type something and confirm" dialog (a customer message, an internal note, a cancel reason ...).
 * `onSubmit(text)` may be async and may throw (the message is shown in the dialog); the dialog closes itself on success.
 * Mount it only while open so the text starts empty each time.
 */
const TextPromptModal = ({ title, subtitle, label, hint, placeholder, required = true, confirmLabel = "Save", initial = "", maxLength = 1000, danger = false, onSubmit, onClose }) => {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const value = text.trim()
    if (required && !value) { setError("This cannot be empty"); return }
    setBusy(true)
    try {
      await onSubmit(value)
      onClose?.()
    } catch (err) {
      setError(err.message || "Something went wrong")
      setBusy(false)
    }
  }

  return (
    <ModalShell open onClose={onClose} busy={busy} width={500} title={title} subtitle={subtitle}
      footer={(<>
        <button type="button" onClick={onClose} disabled={busy} style={GHOST_BTN}>Cancel</button>
        <button type="submit" form="text-prompt-form" disabled={busy} style={{ ...PRIMARY_BTN, background: danger ? "var(--color-error)" : "var(--color-primary)", opacity: busy ? 0.7 : 1 }}>{busy ? "Saving..." : confirmLabel}</button>
      </>)}>
      <form id="text-prompt-form" onSubmit={submit} noValidate>
        <label style={LABEL_STYLE} htmlFor="text-prompt-field">{label}</label>
        <textarea id="text-prompt-field" rows={4} value={text} maxLength={maxLength} placeholder={placeholder} onChange={(e) => setText(e.target.value)} style={{ ...INPUT_STYLE, height: "auto", padding: "8px 12px" }} autoFocus />
        {error ? <p style={ERROR_STYLE}>{error}</p> : hint ? <p style={HINT_STYLE}>{hint}</p> : null}
      </form>
    </ModalShell>
  )
}

export default TextPromptModal