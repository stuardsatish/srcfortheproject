// Single source of truth for the Bulk Product Import CSV column headers.
// Keep this in sync with the row fields read in AddProductPage.jsx (onCsv / startBatchUpload):
// title (fallback: name), category, price, stock, brand, sku (fallback: SKU), gstRate (fallback: gst), hsnCode (fallback: hsn), shortDescription, description, image (fallback: thumbnail)
export const PRODUCT_IMPORT_HEADERS = [
    "title",
    "category",
    "price",
    "stock",
    "brand",
    "sku",
    "gstRate",
    "hsnCode",
    "shortDescription",
    "description",
    "image",
]

// One example row shown under the header to illustrate the expected format per column.
export const PRODUCT_IMPORT_SAMPLE_ROW = [
    "Apex Ultra Slim Laptop",
    "Electronics",
    "49999",
    "25",
    "Apex",
    "APX-001-BLU",
    "18",
    "8471",
    "Slim and powerful everyday laptop",
    "Detailed product specifications and content go here.",
    "https://example.com/images/apex-laptop.jpg",
]