import { configureStore } from "@reduxjs/toolkit";
import prodcutsReducer from './ProductSlice'
import cartReducer from './CartSlice'
import themeReducer from "./ThemeSlice";
import loadingReducer from "./LoadingSlice";
import userReducer from "./UserSlice";
import wishlistReducer from "./WishlistSlice"

export const store = configureStore({
    reducer: {
        products: prodcutsReducer,
        cart: cartReducer,
        theme: themeReducer,
        loading: loadingReducer,
        user: userReducer,
        wishlist: wishlistReducer,
    },
});