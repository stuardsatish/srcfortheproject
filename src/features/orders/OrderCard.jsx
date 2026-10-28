// DEPRECATED — intentionally left empty.
//
// The previous implementation read/wrote the abandoned per-user
// `/users/{uid}/orders` subcollection using a stale schema (`order.items`,
// `item.id`, status "completed") that no other page uses. It was imported
// nowhere. Orders now live solely in the top-level `orders` collection;
// AdminOrdersPage renders its own inline order card. Kept as a no-op stub so
// any accidental future import resolves to a harmless component.

const OrderCard = () => null

export default OrderCard