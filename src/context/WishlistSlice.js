import { createSlice } from "@reduxjs/toolkit"

const initialState = {
  wishlistItems: []
}

const wishlistSlice = createSlice({
  name: "wishlist",
  initialState,
  reducers: {

    setWishlist: (state, action) => {
      state.wishlistItems = action.payload
    },

    addWishlist: (state, action) => {

      const exists = state.wishlistItems.find(
        item => String(item.id) === String(action.payload.id)
      )

      if (!exists) {
        state.wishlistItems.push(action.payload)
      }

    },

    removeWishlist: (state, action) => {

      state.wishlistItems = state.wishlistItems.filter(
        (item) => item.id !== action.payload
      )

    },

  }
})

export const { setWishlist, addWishlist, removeWishlist } = wishlistSlice.actions
export default wishlistSlice.reducer