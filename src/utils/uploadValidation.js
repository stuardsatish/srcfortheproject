/**
 * Client-side upload guard (UX layer — the Storage rules in storage.rules are
 * the real enforcement). Rejects anything that isn't a small raster image and
 * explicitly blocks SVG (embedded-script / stored-XSS risk).
 */

// Raster formats we actually display. SVG is intentionally excluded.
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

/**
 * @param {File} file
 * @param {{ maxBytes?: number, allowGif?: boolean }} [opts]
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateImageFile(file, opts = {}) {
    const { maxBytes = 5 * 1024 * 1024, allowGif = true } = opts;
    if (!file) return { ok: false, error: "No file selected." };

    const type = (file.type || "").toLowerCase();
    const ext = (file.name.split(".").pop() || "").toLowerCase();

    // Block SVG by type OR extension (defence in depth).
    if (type === "image/svg+xml" || ext === "svg") {
        return { ok: false, error: "SVG files are not allowed." };
    }

    const allowedTypes = allowGif ? ALLOWED_TYPES : ALLOWED_TYPES.filter((t) => t !== "image/gif");
    const allowedExts = allowGif ? ALLOWED_EXTENSIONS : ALLOWED_EXTENSIONS.filter((e) => e !== "gif");

    if (!allowedTypes.includes(type) || !allowedExts.includes(ext)) {
        return { ok: false, error: "Only PNG, JPG, WEBP or GIF images are allowed." };
    }
    if (file.size > maxBytes) {
        return { ok: false, error: `File is too large (max ${Math.round(maxBytes / (1024 * 1024))} MB).` };
    }
    return { ok: true };
}

/** Validate a list of files; returns the first error, or { ok: true }. */
export function validateImageFiles(files, opts = {}) {
    for (const f of files) {
        const r = validateImageFile(f, opts);
        if (!r.ok) return r;
    }
    return { ok: true };
}