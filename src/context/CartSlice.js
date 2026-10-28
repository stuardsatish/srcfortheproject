import { createSlice } from "@reduxjs/toolkit";

/**
 * Cart item identity:
 *  - Single product  → item.id = productId
 *  - Variant product → item.id = `${productId}_${variantId}`
 *
 * The compound id is set by the caller (ProductDetail / CartPage) before
 * dispatching, so all reducers here remain a simple `x.id === item.id` check.
 */
const cartSlice = createSlice({
  name: "cart",
  initialState: {
    cartItems: [],
  },

  reducers: {

    setCart: (state, action) => {
      state.cartItems = action.payload
    },

    addCart: (state, action) => {
      const item = action.payload
      const itemId = String(item.id || item.compound_id || "")
      const qtyToAdd = typeof item.qtyToAdd === "number" ? item.qtyToAdd : (typeof item.quantity === "number" ? item.quantity : 1)

      const existingItem = state.cartItems.find(
        (x) => String(x.id || x.compound_id) === itemId
      )

      if (existingItem) {
        existingItem.quantity += qtyToAdd
      } else {
        const { qtyToAdd: _discard, ...rest } = item
        state.cartItems.push({ ...rest, id: itemId, quantity: qtyToAdd })
      }
    },

    removeCart: (state, action) => {
      const itemID = String(action.payload)

      const existingItem = state.cartItems.find(
        (x) => String(x.id || x.compound_id) === itemID
      )

      if (existingItem) {
        if (existingItem.quantity > 1) {
          existingItem.quantity -= 1
        } else {
          state.cartItems = state.cartItems.filter(
            (item) => String(item.id || item.compound_id) !== itemID
          )
        }
      }
    },

    // Remove an item entirely, regardless of quantity.
    deleteCart: (state, action) => {
      const itemID = String(action.payload)
      state.cartItems = state.cartItems.filter((item) => String(item.id || item.compound_id) !== itemID)
    },

    clearCart: (state) => {
      state.cartItems = []
    },

  },

})

export const { addCart, removeCart, deleteCart, clearCart, setCart } = cartSlice.actions
export default cartSlice.reducer