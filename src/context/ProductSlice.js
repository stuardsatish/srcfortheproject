import { createSlice } from "@reduxjs/toolkit";

const productSlice = createSlice({
  name: "products",

  initialState: {
    product: [],
  },

  reducers: {

    // ADD PRODUCTS (API DATA)
    addProduct: (state, action) => {
      state.product = action.payload;
    },

    // REMOVE SINGLE PRODUCT
    removeProduct: (state, action) => {
      state.product = state.product.filter(
        (product) => product.id !== action.payload
      );
    },

    // CLEAR ALL PRODUCTS
    removeAllProduct: (state) => {
      state.product = [];
    },

  },
});

export const {
  addProduct,
  removeProduct,
  removeAllProduct,
} = productSlice.actions;

export default productSlice.reducer;