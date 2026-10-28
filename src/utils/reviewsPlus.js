// Reviews++ service layer (roadmap 3.1 photos, 3.2 helpful votes, 3.3 Q&A).
// Backed by supabase/migrations/20261008_01_reviews_plus.sql. That SQL is applied
// by hand, so every read treats "the backend feature is missing" as a normal
// condition (returns null / `available: false`) instead of an error. Real
// errors (RLS, validation messages raised by the RPCs, network) are thrown with
// the server's own — user-readable — message for the caller to toast.
import { supabase } from "../context/SupabaseConfig"
import { validateImageFile } from "./uploadValidation"

export const REVIEW_PHOTO_BUCKET = "review-photos"
export const MAX_REVIEW_PHOTOS = 4
export const MAX_REVIEW_PHOTO_BYTES = 3 * 1024 * 1024
export const MAX_QUESTION_LENGTH = 500
export const MAX_ANSWER_LENGTH = 1000

/* ---------------- missing-backend handling ---------------- */

const MISSING_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01"])

/** True when PostgREST says the function / table doesn't exist (SQL not applied yet). */
export function isBackendMissing(error) {
    if (!error) return false
    if (MISSING_CODES.has(error.code)) return true
    return /could not find the function|schema cache/i.test(String(error.message || ""))
}

let warnedMissing = false
function warnMissingOnce() {
    if (warnedMissing) return
    warnedMissing = true
    console.warn("[reviewsPlus] Reviews++ backend (20261008_01_reviews_plus.sql) isn't applied yet — photo/vote/Q&A features are hidden.")
}

// Server messages are written to be shown to shoppers; keep them as-is.
const toError = (error, fallback) => new Error(error?.message || fallback)

/* ---------------- 3.1 review photos ---------------- */

/** Public URL for a storage object path stored in `reviews.photos`. */
export function reviewPhotoUrl(path) {
    if (!path) return ""
    return supabase.storage.from(REVIEW_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
}

/**
 * Client-side guard, same rules as the bucket: JPG/PNG/WEBP, <= 3 MB, never SVG/GIF.
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateReviewPhoto(file) {
    const r = validateImageFile(file, { maxBytes: MAX_REVIEW_PHOTO_BYTES, allowGif: false })
    if (r.ok) return r
    // The shared validator's generic wording still lists GIF; ours doesn't allow it.
    if (/^Only PNG/.test(r.error)) return { ok: false, error: "Only JPG, PNG or WEBP photos are allowed." }
    return r
}

const EXT_BY_TYPE = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

// Storage keys are kept to a boring character set; ids are interpolated into them.
const safeSegment = (v) => String(v ?? "").replace(/[^A-Za-z0-9._-]/g, "_")

/**
 * Upload photos to `<userId>/<orderId>_<productId>/<timestamp>_<i>.<ext>` (the
 * storage policy only lets a user write inside their own `<uid>/` folder).
 * All-or-nothing: if one upload fails the ones that succeeded are removed again.
 * @returns {Promise<string[]>} storage object paths, in the order given
 */
export async function uploadReviewPhotos({ userId, orderId, productId, files }) {
    const list = Array.from(files || [])
    if (list.length === 0) return []
    if (!userId) throw new Error("Please sign in to upload photos.")
    if (list.length > MAX_REVIEW_PHOTOS) throw new Error(`You can attach up to ${MAX_REVIEW_PHOTOS} photos.`)
    for (const file of list) {
        const v = validateReviewPhoto(file)
        if (!v.ok) throw new Error(v.error)
    }

    const folder = `${userId}/${safeSegment(orderId)}_${safeSegment(productId)}`
    const stamp = Date.now()
    const bucket = supabase.storage.from(REVIEW_PHOTO_BUCKET)
    const results = await Promise.allSettled(
        list.map(async (file, i) => {
            const ext = EXT_BY_TYPE[(file.type || "").toLowerCase()] || "jpg"
            const path = `${folder}/${stamp}_${i}.${ext}`
            // Short-ish cache: a photo the user later removes should stop being served reasonably soon.
            const { error } = await bucket.upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false })
            if (error) throw error
            return path
        })
    )

    const paths = results.filter((r) => r.status === "fulfilled").map((r) => r.value)
    const failed = results.find((r) => r.status === "rejected")
    if (failed) {
        if (paths.length) await bucket.remove(paths).catch(() => { })
        throw toError(failed.reason, "Photo upload failed.")
    }
    return paths
}

/** Attach (or replace — an empty array clears) the photos on the caller's own review. */
export async function setReviewPhotos(reviewId, paths) {
    const { error } = await supabase.rpc("set_review_photos", { p_review_id: reviewId, p_photos: paths || [] })
    if (error) {
        if (isBackendMissing(error)) {
            warnMissingOnce()
            throw new Error("Photo uploads aren't available yet.")
        }
        throw toError(error, "Could not save photos.")
    }
}

/**
 * Upload the newly chosen files and make `[...keep, ...uploaded]` the review's
 * photo list. `previous` is what the review had before (edit flow): photos that
 * were dropped are deleted from storage afterwards, best effort.
 * @returns {Promise<string[]>} the final list now stored on the review
 */
export async function saveReviewPhotos({ userId, orderId, productId, reviewId, keep = [], files = [], previous = [] }) {
    const uploaded = await uploadReviewPhotos({ userId, orderId, productId, files })
    const finalPaths = [...keep, ...uploaded]
    try {
        await setReviewPhotos(reviewId, finalPaths)
    } catch (e) {
        // The review never pointed at these files — don't leave them orphaned.
        if (uploaded.length) await supabase.storage.from(REVIEW_PHOTO_BUCKET).remove(uploaded).catch(() => { })
        throw e
    }
    const dropped = previous.filter((p) => !finalPaths.includes(p) && p.startsWith(`${userId}/`))
    if (dropped.length) await supabase.storage.from(REVIEW_PHOTO_BUCKET).remove(dropped).catch(() => { })
    return finalPaths
}

let photosAvailablePromise = null
/**
 * Is the `reviews.photos` column live? Lets the review modal hide the photo
 * picker (instead of failing after the user chose files) on a database that
 * hasn't had the SQL applied. Cached once the answer is definitive.
 */
export function reviewPhotosAvailable() {
    if (!photosAvailablePromise) {
        photosAvailablePromise = supabase
            .from("reviews")
            .select("photos")
            .limit(1)
            .then(({ error }) => {
                // 42703 = undefined_column. Anything else (RLS, network) is not proof it's missing.
                if (error?.code === "42703" || isBackendMissing(error)) {
                    warnMissingOnce()
                    return false
                }
                if (error) photosAvailablePromise = null
                return true
            })
    }
    return photosAvailablePromise
}

/* ---------------- 3.2 helpful votes ---------------- */

const toVote = (row) => ({
    helpfulCount: Number(row?.helpful_count) || 0,
    unhelpfulCount: Number(row?.unhelpful_count) || 0,
    myVote: Number(row?.my_vote) || 0,
})

/**
 * Vote totals (+ the caller's own vote) for every review of a product.
 * @returns {Promise<Record<string,{helpfulCount:number,unhelpfulCount:number,myVote:number}>|null>}
 *   keyed by review id; `null` when the backend feature isn't there.
 */
export async function fetchReviewVotes(productId) {
    const { data, error } = await supabase.rpc("review_vote_summary", { p_product_id: String(productId) })
    if (error) {
        if (isBackendMissing(error)) { warnMissingOnce(); return null }
        throw toError(error, "Could not load votes.")
    }
    const byReview = {}
    for (const row of data || []) byReview[row.review_id] = toVote(row)
    return byReview
}

/**
 * Cast / change / clear (vote = 0) the caller's vote. Throws the server's message
 * for refusals (own review, signed out, guest).
 * @param {string} reviewId
 * @param {1|-1|0} vote
 */
export async function voteOnReview(reviewId, vote) {
    const { data, error } = await supabase.rpc("vote_on_review", { p_review_id: reviewId, p_vote: vote })
    if (error) {
        if (isBackendMissing(error)) { warnMissingOnce(); throw new Error("Voting isn't available yet.") }
        throw toError(error, "Could not save your vote.")
    }
    return toVote(Array.isArray(data) ? data[0] : data)
}

/* ---------------- 3.3 product Q&A ---------------- */

const NO_PERMISSIONS = { canAsk: false, canAnswer: false, isStaff: false }

const toAnswer = (a) => ({
    id: a.id,
    answer: a.answer,
    createdAt: a.created_at,
    answerer: a.answerer,
    isStaff: !!a.is_staff,
    isMine: !!a.is_mine,
})

const toQuestion = (q) => ({
    id: q.id,
    question: q.question,
    createdAt: q.created_at,
    asker: q.asker,
    isMine: !!q.is_mine,
    answers: (q.answers || []).map(toAnswer),
})

/**
 * Questions (newest first, answers nested) plus what this visitor may do.
 * @returns {Promise<{ available:boolean, permissions:{canAsk:boolean,canAnswer:boolean,isStaff:boolean},
 *   questions:Array<{id:string,question:string,createdAt:string,asker:string,isMine:boolean,
 *   answers:Array<{id:string,answer:string,createdAt:string,answerer:string,isStaff:boolean,isMine:boolean}>}> }>}
 */
export async function fetchProductQA(productId, limit = 30) {
    const pid = String(productId)
    const [perm, list] = await Promise.all([
        supabase.rpc("product_qa_permissions", { p_product_id: pid }),
        supabase.rpc("list_product_qa", { p_product_id: pid, p_limit: limit }),
    ])
    for (const { error } of [perm, list]) {
        if (!error) continue
        if (isBackendMissing(error)) {
            warnMissingOnce()
            return { available: false, permissions: NO_PERMISSIONS, questions: [] }
        }
        throw toError(error, "Could not load questions.")
    }
    const p = perm.data || {}
    return {
        available: true,
        permissions: { canAsk: p.can_ask === true, canAnswer: p.can_answer === true, isStaff: p.is_staff === true },
        questions: (Array.isArray(list.data) ? list.data : []).map(toQuestion),
    }
}

/** @returns {Promise<string>} id of the new question */
export async function askQuestion(productId, question) {
    const { data, error } = await supabase.rpc("ask_product_question", { p_product_id: String(productId), p_question: question })
    if (error) throw toError(error, "Could not post your question.")
    return data
}

/** @returns {Promise<string>} id of the new answer */
export async function answerQuestion(questionId, answer) {
    const { data, error } = await supabase.rpc("answer_product_question", { p_question_id: questionId, p_answer: answer })
    if (error) throw toError(error, "Could not post your answer.")
    return data
}

// RLS lets a user delete their own rows (and admins any). A delete that RLS
// filters out succeeds with zero rows, so ask for the deleted ids back.
async function deleteRow(table, id) {
    const { data, error } = await supabase.from(table).delete().eq("id", id).select("id")
    if (error) throw toError(error, "Could not delete.")
    if (!data?.length) throw new Error("You can't delete this.")
}

export const deleteQuestion = (questionId) => deleteRow("product_questions", questionId)
export const deleteAnswer = (answerId) => deleteRow("product_answers", answerId)