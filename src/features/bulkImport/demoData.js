// The DEMO import: sample single products, parents with variants, mixed return / exchange policies, several images.
// Single source of truth for  public/templates/demo/products-demo.xlsx , the demo image list and the sample report.
// __tests__/templates.test.mjs validates this data with the REAL validator (zero errors), so it cannot drift from the rules.
//
// What it demonstrates (BULK_UPLOAD_TEMPLATE_GUIDE §3.1):
//   * SHIRT-001  SINGLE            ₹500, 7-day returns / 5-day exchange
//   * SHIRT-002  PARENT + 3 VARIANTS — the main product has its OWN price (₹500); Pink ₹300, White ₹200 (own policy: no returns, 3-day exchange), Violet ₹350
//   * SHOE-001   SINGLE            10-day returns / 7-day exchange, two extra gallery images, 15% discount with an expiry
//   * CUSTOM-001 SINGLE            customised item: NOT returnable, NOT exchangeable
//   * HOODIE-001 PARENT (main product not sold) + variants with two attributes (Color + Size)
//   * GIFT-001   SINGLE            inventory NOT tracked (unlimited), stored as DRAFT

const R = (o) => o

export const DEMO_ROWS = [
  R({ importId: 'SHIRT-001', type: 'SINGLE', name: 'Classic Shirt', sku: 'SHIRT-001', brand: 'Acme Wear', category: 'Shirts', tags: 'cotton|casual|summer',
      shortDescription: 'Soft cotton shirt for everyday wear.', description: 'A classic cotton shirt with a relaxed fit. Machine washable.',
      price: 500, gstRate: 5, hsn: '6205', stock: 50, trackInventory: 'YES', status: 'ACTIVE', mainImage: 'SHIRT-001.jpg',
      returnEnabled: 'YES', returnDays: 7, exchangeEnabled: 'YES', exchangeDays: 5, notes: 'Single product: no variants.' }),

  R({ importId: 'SHIRT-002', type: 'PARENT', name: 'Designer Shirt', sku: 'SHIRT-002', brand: 'Acme Wear', category: 'Shirts', tags: 'designer|party',
      shortDescription: 'Designer shirt in three colours.', description: 'The main product is sold on its own at ₹500; each colour is a separate option with its own price and stock.',
      price: 500, gstRate: 5, hsn: '6205', stock: 10, trackInventory: 'YES', status: 'ACTIVE', sellMain: 'YES', attributeNames: 'Color', mainImage: 'SHIRT-002.jpg',
      returnEnabled: 'YES', returnDays: 7, exchangeEnabled: 'YES', exchangeDays: 5, notes: 'PARENT: its own price (500) is independent of the variant prices.' }),
  R({ importId: 'SHIRT-002-PINK', type: 'VARIANT', parentId: 'SHIRT-002', name: 'Designer Shirt', variantName: 'Pink', sku: 'SHIRT-002-PINK',
      price: 300, stock: 20, trackInventory: 'YES', status: 'ACTIVE', variantAttributes: 'Color=Pink', mainImage: 'SHIRT-002-PINK.jpg', notes: 'Inherits the parent policy (7 / 5 days).' }),
  R({ importId: 'SHIRT-002-WHITE', type: 'VARIANT', parentId: 'SHIRT-002', name: 'Designer Shirt', variantName: 'White', sku: 'SHIRT-002-WHITE',
      price: 200, stock: 30, trackInventory: 'YES', status: 'ACTIVE', variantAttributes: 'Color=White', mainImage: 'SHIRT-002-WHITE.jpg',
      returnEnabled: 'NO', exchangeEnabled: 'YES', exchangeDays: 3, notes: 'Overrides the parent: no returns, exchange within 3 days.' }),
  R({ importId: 'SHIRT-002-VIOLET', type: 'VARIANT', parentId: 'SHIRT-002', name: 'Designer Shirt', variantName: 'Violet', sku: 'SHIRT-002-VIOLET',
      price: 350, stock: 15, trackInventory: 'YES', status: 'ACTIVE', variantAttributes: 'Color=Violet', mainImage: 'SHIRT-002-VIOLET.jpg' }),

  R({ importId: 'SHOE-001', type: 'SINGLE', name: 'Trail Shoe', sku: 'SHOE-001', brand: 'StrideCo', category: 'Footwear', tags: 'running|outdoor',
      shortDescription: 'Light trail running shoe.', description: 'Grippy outsole, breathable mesh upper.',
      price: 2499, gstRate: 12, hsn: '6404', discount: 15, discountExpiry: '2030-12-31', stock: 12, trackInventory: 'YES', status: 'ACTIVE',
      mainImage: 'SHOE-001.jpg', galleryImages: 'SHOE-001-side.jpg|SHOE-001-sole.jpg', returnEnabled: 'YES', returnDays: 10, exchangeEnabled: 'YES', exchangeDays: 7,
      notes: 'Several images and a discount that ends on the date given.' }),

  R({ importId: 'CUSTOM-001', type: 'SINGLE', name: 'Engraved Pen', sku: 'CUSTOM-001', brand: 'Inkwell', category: 'Gifts', tags: 'custom|gift',
      shortDescription: 'Pen engraved with your name.', description: 'Made to order, so it cannot be returned or exchanged.',
      price: 899, gstRate: 18, hsn: '9608', stock: 5, trackInventory: 'YES', status: 'ACTIVE', mainImage: 'CUSTOM-001.jpg',
      returnEnabled: 'NO', exchangeEnabled: 'NO', notes: 'Customised item: not returnable, not exchangeable.' }),

  R({ importId: 'HOODIE-001', type: 'PARENT', name: 'Everyday Hoodie', sku: 'HOODIE-001', brand: 'Acme Wear', category: 'Hoodies', tags: 'winter',
      shortDescription: 'Fleece hoodie.', description: 'Sold by colour and size only (the main product itself is not sold).',
      price: 1299, gstRate: 12, hsn: '6110', stock: 0, trackInventory: 'NO', status: 'ACTIVE', sellMain: 'NO', attributeNames: 'Color|Size', mainImage: 'HOODIE-001.jpg',
      returnEnabled: 'YES', returnDays: 7, exchangeEnabled: 'YES', exchangeDays: 7, notes: 'Sell Main Product = NO: only the variants can be bought.' }),
  R({ importId: 'HOODIE-001-RED-M', type: 'VARIANT', parentId: 'HOODIE-001', variantName: 'Red / M', sku: 'HOODIE-001-RED-M', price: 1299, stock: 8, status: 'ACTIVE',
      variantAttributes: 'Color=Red|Size=M', mainImage: 'HOODIE-001-RED.jpg' }),
  R({ importId: 'HOODIE-001-RED-L', type: 'VARIANT', parentId: 'HOODIE-001', variantName: 'Red / L', sku: 'HOODIE-001-RED-L', price: 1299, stock: 6, status: 'ACTIVE',
      variantAttributes: 'Color=Red|Size=L', mainImage: 'HOODIE-001-RED.jpg' }),
  R({ importId: 'HOODIE-001-BLUE-M', type: 'VARIANT', parentId: 'HOODIE-001', variantName: 'Blue / M', sku: 'HOODIE-001-BLUE-M', price: 1399, stock: 4, status: 'ACTIVE',
      variantAttributes: 'Color=Blue|Size=M', mainImage: 'HOODIE-001-BLUE.jpg' }),

  R({ importId: 'GIFT-001', type: 'SINGLE', name: 'Gift Wrap Service', sku: 'GIFT-001', category: 'Gifts', tags: 'service',
      shortDescription: 'Gift wrapping.', description: 'Add gift wrapping to any order. Stock is not tracked.',
      price: 49, gstRate: 18, trackInventory: 'NO', status: 'DRAFT', mainImage: 'GIFT-001.jpg', notes: 'Inventory not tracked; saved as DRAFT.' }),
]

/** every image file name the demo rows reference (main + additional), in first-use order */
export function demoImageFiles(rows = DEMO_ROWS) {
  const seen = new Set()
  const out = []
  for (const r of rows) {
    for (const f of [r.mainImage, ...String(r.galleryImages || '').split('|')].map((x) => String(x || '').trim()).filter(Boolean)) {
      if (!seen.has(f.toLowerCase())) { seen.add(f.toLowerCase()); out.push(f) }
    }
  }
  return out
}