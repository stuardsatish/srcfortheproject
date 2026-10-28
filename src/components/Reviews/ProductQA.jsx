import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useSelector } from "react-redux"
import { toast } from "react-toastify"
import { MessageCircle } from "lucide-react"
import {
    MAX_ANSWER_LENGTH,
    MAX_QUESTION_LENGTH,
    answerQuestion,
    askQuestion,
    deleteAnswer,
    deleteQuestion,
    fetchProductQA,
} from "../../utils/reviewsPlus"
import { relativeTime } from "../../utils/relativeTime"

const INITIAL_VISIBLE = 3

/**
 * Product Q&A (roadmap 3.3), rendered below the reviews on both PDP layouts.
 * Renders nothing at all until the backend answers, and nothing if the Q&A
 * feature isn't live. After any write it simply refetches.
 *
 * @param {{ productId:string, variant?:"desktop"|"mobile", sectionId?:string }} props
 */
export default function ProductQA({ productId, variant = "desktop", sectionId }) {
    const navigate = useNavigate()
    const user = useSelector((s) => s.user.user)
    const userId = user?.uid ?? null
    const mobile = variant === "mobile"

    const [result, setResult] = useState(null) // { productId, available, permissions, questions } | { productId, error }
    const [reloadKey, setReloadKey] = useState(0)
    const [showAll, setShowAll] = useState(false)
    const [answeringId, setAnsweringId] = useState(null)

    const [draft, setDraft] = useState("")
    const [posting, setPosting] = useState(false)
    const [busyId, setBusyId] = useState(null) // id of the row being deleted

    // Re-fetched on sign-in/out too: permissions and "is mine" depend on who is looking.
    useEffect(() => {
        let active = true
        fetchProductQA(productId)
            .then((r) => { if (active) setResult({ productId, ...r }) })
            .catch((e) => {
                console.warn("[qa] could not load questions:", e.message)
                if (active) setResult({ productId, error: e.message })
            })
        return () => { active = false }
    }, [productId, reloadKey, userId])

    const reload = () => setReloadKey((k) => k + 1)

    // Until the first answer for THIS product, show nothing (no skeleton: if the
    // feature turns out to be missing the section must never have flashed).
    if (!result || result.productId !== productId) return null
    if (result.available === false) return null

    const fontSize = mobile ? "14px" : "16px"
    const lineHeight = mobile ? "20px" : "24px"

    const shell = mobile
        ? { padding: "8px 20px 24px", display: "flex", flexDirection: "column", gap: "16px" }
        : { borderTop: "1px solid var(--color-border-strong)", paddingTop: "72px", marginTop: "72px", display: "flex", flexDirection: "column", gap: "32px" }
    const Shell = mobile ? "section" : "div"

    if (result.error) {
        return (
            <Shell id={sectionId} style={shell}>
                <h2 style={{ fontWeight: 600, fontSize: mobile ? "18px" : "32px", color: "var(--color-ink)" }}>Questions &amp; Answers</h2>
                <div className="flex items-center justify-between" style={{ gap: "12px", background: "var(--color-surface-muted)", borderRadius: "12px", padding: "16px" }}>
                    <span style={{ fontSize, color: "var(--color-body)" }}>We couldn&apos;t load the questions right now.</span>
                    <button type="button" onClick={reload} style={{ fontWeight: 700, fontSize: "13px", color: "var(--color-primary)" }}>Retry</button>
                </div>
            </Shell>
        )
    }

    const { permissions, questions } = result
    const visible = showAll ? questions : questions.slice(0, INITIAL_VISIBLE)
    const draftLen = draft.trim().length
    const canPost = draftLen >= 5 && !posting

    const submitQuestion = async () => {
        if (!canPost) return
        setPosting(true)
        try {
            await askQuestion(productId, draft.trim())
            setDraft("")
            setShowAll(false)
            toast.success("Your question has been posted.")
            reload()
        } catch (e) {
            toast.error(e.message)
        } finally {
            setPosting(false)
        }
    }

    const submitAnswer = async (questionId, text) => {
        try {
            await answerQuestion(questionId, text)
            setAnsweringId(null)
            toast.success("Your answer has been posted.")
            reload()
            return true
        } catch (e) {
            toast.error(e.message)
            return false
        }
    }

    const remove = async (id, kind) => {
        const msg = kind === "question" ? "Delete this question and all its answers?" : "Delete this answer?"
        if (!window.confirm(msg)) return
        setBusyId(id)
        try {
            await (kind === "question" ? deleteQuestion(id) : deleteAnswer(id))
            toast.success(kind === "question" ? "Question deleted." : "Answer deleted.")
            reload()
        } catch (e) {
            toast.error(e.message)
        } finally {
            setBusyId(null)
        }
    }

    const linkBtn = { fontWeight: 600, fontSize: "13px", color: "var(--color-primary)" }
    const dangerBtn = { fontWeight: 600, fontSize: "13px", color: "var(--color-error)" }
    const meta = { fontSize: mobile ? "12px" : "13px", color: "var(--color-muted)" }

    return (
        <Shell id={sectionId} style={shell}>
            <div className="flex items-center" style={{ gap: "10px" }}>
                <h2 style={{ fontWeight: 600, fontSize: mobile ? "18px" : "32px", color: "var(--color-ink)" }}>Questions &amp; Answers</h2>
                <span style={{ fontWeight: 600, fontSize: mobile ? "13px" : "16px", color: "var(--color-muted)" }}>({questions.length})</span>
            </div>

            <div style={{ maxWidth: mobile ? "none" : "880px", display: "flex", flexDirection: "column", gap: mobile ? "16px" : "28px" }}>
                {/* ASK */}
                <div style={{ background: "var(--color-surface-muted)", borderRadius: "12px", padding: mobile ? "16px" : "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
                    <label htmlFor={`qa-ask-${sectionId || "q"}`} style={{ fontWeight: 600, fontSize, color: "var(--color-ink)" }}>Ask a question</label>
                    <textarea
                        id={`qa-ask-${sectionId || "q"}`}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value.slice(0, MAX_QUESTION_LENGTH))}
                        maxLength={MAX_QUESTION_LENGTH}
                        disabled={!permissions.canAsk || posting}
                        placeholder={!user ? "Sign in to ask a question" : permissions.canAsk ? "What would you like to know about this product?" : "Questions aren't available for your account right now"}
                        rows={3}
                        style={{ width: "100%", background: "var(--color-surface)", borderRadius: "10px", padding: "12px", fontSize: mobile ? "14px" : "15px", color: "var(--color-ink)", border: "1px solid var(--color-border-strong)", resize: "vertical", outline: "none", fontFamily: "Inter, sans-serif", opacity: permissions.canAsk ? 1 : 0.7 }}
                    />
                    <div className="flex items-center justify-between" style={{ gap: "12px" }}>
                        {permissions.canAsk ? (
                            <span style={meta}>{draft.length}/{MAX_QUESTION_LENGTH}{draftLen > 0 && draftLen < 5 ? " · at least 5 characters" : ""}</span>
                        ) : user ? (
                            <span style={meta}>Asking questions isn&apos;t available for your account right now.</span>
                        ) : (
                            <span style={meta}>Sign in to ask a question.</span>
                        )}
                        {user ? (
                            <button
                                type="button"
                                onClick={submitQuestion}
                                disabled={!canPost || !permissions.canAsk}
                                style={{ height: "40px", padding: "0 20px", borderRadius: "9999px", background: "var(--color-primary)", color: "var(--color-inverse)", fontWeight: 700, fontSize: "14px", opacity: canPost && permissions.canAsk ? 1 : 0.45, cursor: canPost && permissions.canAsk ? "pointer" : "not-allowed", flexShrink: 0 }}
                            >
                                {posting ? "Posting…" : "Post question"}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => navigate("/login")}
                                style={{ height: "40px", padding: "0 20px", borderRadius: "9999px", background: "var(--color-primary)", color: "var(--color-inverse)", fontWeight: 700, fontSize: "14px", flexShrink: 0 }}
                            >
                                Sign in to ask
                            </button>
                        )}
                    </div>
                </div>

                {/* LIST */}
                {questions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center" style={{ gap: "6px", padding: mobile ? "24px 16px" : "40px 24px", borderRadius: "12px", border: "1px dashed var(--color-border-strong)" }}>
                        <MessageCircle size={mobile ? 22 : 26} style={{ color: "var(--color-primary)" }} />
                        <p style={{ fontWeight: 600, fontSize: mobile ? "15px" : "18px", color: "var(--color-ink)" }}>No questions yet</p>
                        <p style={{ fontSize: mobile ? "13px" : "15px", color: "var(--color-muted)" }}>Be the first to ask about this product.</p>
                    </div>
                ) : (
                    <div className="flex flex-col" style={{ gap: mobile ? "16px" : "24px" }}>
                        {visible.map((q) => (
                            <article key={q.id} style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: mobile ? "16px" : "24px", display: "flex", flexDirection: "column", gap: "8px" }}>
                                <div className="flex items-start" style={{ gap: "10px" }}>
                                    <span aria-hidden="true" className="flex items-center justify-center flex-shrink-0" style={{ width: "24px", height: "24px", borderRadius: "6px", background: "var(--color-ink)", color: "var(--color-inverse)", fontWeight: 700, fontSize: "12px", marginTop: "1px" }}>Q</span>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <p style={{ fontWeight: 600, fontSize, lineHeight, color: "var(--color-ink)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{q.question}</p>
                                        <p style={meta}>Asked by {q.asker} · {relativeTime(q.createdAt)}</p>
                                    </div>
                                </div>

                                {q.answers.map((a) => (
                                    <div key={a.id} className="flex items-start" style={{ gap: "10px", paddingLeft: mobile ? "8px" : "34px" }}>
                                        <span aria-hidden="true" className="flex items-center justify-center flex-shrink-0" style={{ width: "24px", height: "24px", borderRadius: "6px", background: a.isStaff ? "var(--color-primary)" : "var(--color-surface-muted)", color: a.isStaff ? "var(--color-inverse)" : "var(--color-body)", fontWeight: 700, fontSize: "12px", marginTop: "1px" }}>A</span>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <p style={{ fontSize, lineHeight, color: "var(--color-body)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{a.answer}</p>
                                            <p className="flex items-center flex-wrap" style={{ ...meta, gap: "6px" }}>
                                                {a.isStaff ? (
                                                    <span style={{ fontWeight: 700, fontSize: "11px", padding: "1px 8px", borderRadius: "9999px", background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", color: "var(--color-primary)" }}>Store</span>
                                                ) : (
                                                    <span>{a.answerer}</span>
                                                )}
                                                <span>· {relativeTime(a.createdAt)}</span>
                                                {(a.isMine || permissions.isStaff) && (
                                                    <button type="button" onClick={() => remove(a.id, "answer")} disabled={busyId === a.id} style={dangerBtn}>Delete</button>
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                ))}

                                <div className="flex items-center" style={{ gap: "16px", paddingLeft: mobile ? "0" : "34px" }}>
                                    {permissions.canAnswer && answeringId !== q.id && (
                                        <button type="button" onClick={() => setAnsweringId(q.id)} style={linkBtn}>Answer</button>
                                    )}
                                    {(q.isMine || permissions.isStaff) && (
                                        <button type="button" onClick={() => remove(q.id, "question")} disabled={busyId === q.id} style={dangerBtn}>Delete</button>
                                    )}
                                </div>

                                {permissions.canAnswer && answeringId === q.id && (
                                    <AnswerForm
                                        mobile={mobile}
                                        onCancel={() => setAnsweringId(null)}
                                        onSubmit={(text) => submitAnswer(q.id, text)}
                                    />
                                )}
                            </article>
                        ))}

                        {questions.length > INITIAL_VISIBLE && (
                            <button
                                type="button"
                                onClick={() => setShowAll((v) => !v)}
                                style={{ alignSelf: "flex-start", height: "40px", padding: "0 20px", borderRadius: "9999px", border: "1px solid var(--color-ink)", fontWeight: 700, fontSize: "14px", color: "var(--color-ink)" }}
                            >
                                {showAll ? "Show fewer questions" : `Show all ${questions.length} questions`}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </Shell>
    )
}

function AnswerForm({ mobile, onSubmit, onCancel }) {
    const [text, setText] = useState("")
    const [busy, setBusy] = useState(false)
    const len = text.trim().length
    const ok = len >= 2 && !busy

    const submit = async () => {
        if (!ok) return
        setBusy(true)
        const done = await onSubmit(text.trim())
        // On success the form unmounts; only a failed post leaves it open again.
        if (!done) setBusy(false)
    }

    return (
        <div style={{ paddingLeft: mobile ? "0" : "34px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_ANSWER_LENGTH))}
                maxLength={MAX_ANSWER_LENGTH}
                disabled={busy}
                rows={3}
                autoFocus
                placeholder="Write your answer…"
                aria-label="Your answer"
                style={{ width: "100%", background: "var(--color-surface)", borderRadius: "10px", padding: "12px", fontSize: mobile ? "14px" : "15px", color: "var(--color-ink)", border: "1px solid var(--color-border-strong)", resize: "vertical", outline: "none", fontFamily: "Inter, sans-serif" }}
            />
            <div className="flex items-center justify-between" style={{ gap: "12px" }}>
                <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>{text.length}/{MAX_ANSWER_LENGTH}</span>
                <div className="flex items-center" style={{ gap: "8px" }}>
                    <button type="button" onClick={onCancel} disabled={busy} style={{ height: "36px", padding: "0 14px", fontWeight: 600, fontSize: "13px", color: "var(--color-body)" }}>Cancel</button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={!ok}
                        style={{ height: "36px", padding: "0 18px", borderRadius: "9999px", background: "var(--color-primary)", color: "var(--color-inverse)", fontWeight: 700, fontSize: "13px", opacity: ok ? 1 : 0.45, cursor: ok ? "pointer" : "not-allowed" }}
                    >
                        {busy ? "Posting…" : "Post answer"}
                    </button>
                </div>
            </div>
        </div>
    )
}