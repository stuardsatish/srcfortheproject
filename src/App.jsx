import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom"
import { lazy, Suspense, useState, useEffect, useRef } from "react"
import { useDispatch, useSelector } from "react-redux"

const LandingPage = lazy(() => import("./pages/LandingPage/LandingPage"))
const ProcessDetailsPage = lazy(() => import("./pages/ProcessDetailsPage/ProcessDetailsPage"))

const ServicesPage = lazy(() => import("./pages/ServicesPage/ServicesPage"))
const ContactPage = lazy(() => import("./pages/ContactPage/ContactPage"))
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage/PrivacyPolicyPage"))
const RefundPolicyPage = lazy(() => import("./pages/RefundPolicyPage/RefundPolicyPage"))
const TermsPage = lazy(() => import("./pages/TermsPage/TermsPage"))
const ShippingPolicyPage = lazy(() => import("./pages/ShippingPolicyPage/ShippingPolicyPage"))
const FaqPage = lazy(() => import("./pages/FaqPage/FaqPage"))
const ProductsPage = lazy(() => import("./pages/ProductsPage/ProductsPage"))
const ProductDetail = lazy(() => import("./pages/ProductDetail/ProductDetail"))
const CartPage = lazy(() => import("./pages/CartPage/CartPage"))
const LoginPage = lazy(() => import("./pages/LoginPage/LoginPage"))
const SignupPage = lazy(() => import("./pages/SignupPage/SignupPage"))
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage/ResetPasswordPage"))
const AdminOrdersPage = lazy(() => import("./pages/AdminOrdersPage/AdminOrdersPage"))
const OrdersHubPage = lazy(() => import("./pages/AdminOrdersPage/OrdersHubPage"))
const WishlistPage = lazy(() => import("./pages/WishlistPage/WishlistPage"))
const UsersPage = lazy(() => import("./pages/UsersPage/UsersPage"))
const CustomersHubPage = lazy(() => import("./pages/UsersPage/CustomersHubPage"))
const AddProductPage = lazy(() => import("./pages/AddProductPage/AddProductPage"))
const ProductsHubPage = lazy(() => import("./pages/AddProductPage/ProductsHubPage"))
const AddDiscountPage = lazy(() => import("./pages/AddDiscountPage/AddDiscountPage"))
const EditProductPage = lazy(() => import("./pages/EditProductPage/EditProductPage"))
const UserOrdersPage = lazy(() => import("./pages/UserOrdersPage/UserOrdersPage"))
const OrderDetailPage = lazy(() => import("./pages/OrderDetailPage/OrderDetailPage"))
const UserPastOrdersPage = lazy(() => import("./pages/UserPastOrdersPage/UserPastOrdersPage"))
const MyProfile = lazy(() => import("./pages/MyProfile/MyProfile"))
const AddressesPage = lazy(() => import("./pages/AddressesPage/AddressesPage"))
const AllUsersOrdersAnalytics = lazy(() => import("./pages/AllUsersOrdersAnalytics/AllUsersOrdersAnalytics"))
const AllProductsOrdersAnalytics = lazy(() => import("./pages/AllProductsOrdersAnalytics/AllProductsOrdersAnalytics"))
const AdminUploadOrders = lazy(() => import("./pages/AdminUploadOrders/AdminUploadOrders"))
const ScrollSequence = lazy(() => import("./pages/ScrollSequence/ScrollSequence"))
const CreateOrdersPage = lazy(() => import("./pages/CreateOrdersPage/CreateOrdersPage"))
const BillingPage = lazy(() => import("./pages/BillingPage/BillingPage"))
const Optimization = lazy(() => import("./pages/Optimization/Optimization"))
const AdminReturnsPage = lazy(() => import("./pages/AdminReturnsPage/AdminReturnsPage"))
const AdminInventoryPage = lazy(() => import("./pages/AdminInventoryPage/AdminInventoryPage"))
const MyReturnsPage = lazy(() => import("./pages/MyReturnsPage/MyReturnsPage"))
const NotificationsPage = lazy(() => import("./pages/NotificationsPage/NotificationsPage"))
const AdminDashboard = lazy(() => import("./pages/Dashboard/AdminDashboard"))

import Loader from "./components/Common/Loader"
import Navbar from "./components/Layout/Navbar"
import MobileNav from "./components/Layout/MobileNav"
import AdminLayout from "./components/Layout/AdminLayout"
import SessionManager from "./components/SessionManager"
import useSessionWatcher from "./hooks/useSessionWatcher"

import { ToastContainer } from "react-toastify"
import "react-toastify/dist/ReactToastify.css"

import { supabase } from "./context/SupabaseConfig"

import { setUser, clearUser } from "./context/UserSlice"
import { setCart } from "./context/CartSlice"
import { setWishlist } from "./context/WishlistSlice"

import { startLoading, stopLoading } from "./context/LoadingSlice"

import UserRoute from "./routes/UserRoute"
import AdminRoute from "./routes/AdminRoute"



// Reserves vertical space for the always-visible fixed navbar so page content
// never sits underneath it. Skipped on the full-bleed hero routes (landing /
// video) where the nav intentionally overlays the hero, and hidden on small
// screens where the floating nav retracts on shell routes (those pages render
// their own TopAppBar). Also hidden on admin routes which use the sidebar layout.
const FULL_BLEED_ROUTES = ["/", "/video"]
const ADMIN_ROUTE_PREFIX = "/admin"
const NavbarSpacer = () => {
  const { pathname } = useLocation()
  if (FULL_BLEED_ROUTES.includes(pathname)) return null
  if (pathname.startsWith(ADMIN_ROUTE_PREFIX)) return null
  return <div aria-hidden="true" className="hidden sm:block" style={{ height: "88px" }} />
}

// Hides the floating Navbar and MobileNav on all /admin/* routes so the new
// sidebar layout takes over navigation. Customer-facing routes are unaffected.
const NavbarVisibilityGuard = ({ children }) => {
  const { pathname } = useLocation()
  if (pathname.startsWith(ADMIN_ROUTE_PREFIX)) return null
  return children
}

const areCartItemsEqual = (arr1, arr2) => {
  if (!arr1 || !arr2) return false
  if (arr1.length !== arr2.length) return false
  for (const item1 of arr1) {
    const item2 = arr2.find((x) => x.id === item1.id)
    if (!item2) return false
    if (item1.quantity !== item2.quantity) return false
    if (item1.price !== item2.price) return false
    if (Number(item1.discount || 0) !== Number(item2.discount || 0)) return false
    if ((item1.discountExpiry || "") !== (item2.discountExpiry || "")) return false
    if ((item1.variant_id || "") !== (item2.variant_id || "")) return false
    if (!!item1.unavailable !== !!item2.unavailable) return false
  }
  return true
}

const App = () => {

  const dispatch = useDispatch()

  const cartItems = useSelector((state) => state.cart.cartItems)
  const wishListItems = useSelector((state) => state.wishlist.wishlistItems)
  const authUser = useSelector((state) => state.user.user)

  // Single-session enforcement: logs this device out if another device logs in.
  useSessionWatcher(authUser?.uid)

  const [authChecked, setAuthChecked] = useState(false)

  // Keep a ref to current cartItems to prevent infinite listener update loops
  const cartItemsRef = useRef(cartItems)
  useEffect(() => {
    cartItemsRef.current = cartItems
  }, [cartItems])

  // AUTH + LOAD USER + CART + WISHLIST
  useEffect(() => {

    dispatch(startLoading())

    let unsubCart = null  // will hold the Realtime channel unsubscribe for cart_items
    let cancelled = false

    // Cart is per-row in `cart_items` now (one row per user+product) instead
    // of a single jsonb doc, so every event just re-selects the full set for
    // this user — cheap, and it always re-joins `products` for live
    // price/discount/expiry (mirrors what the old onSnapshot handler did by
    // fetching the whole product catalog on every cart change).
    const loadCartAndWishlist = async (uid) => {
      if (unsubCart) { unsubCart(); unsubCart = null }

      let fetchCartTimeout = null

      const fetchCart = async () => {
        // The option-model columns (migration 20261014_01) are optional here: if the database predates them, fall
        // back to the original column list so the cart still loads (deploy order must never break shopping).
        const CART_COLS = "quantity, product_id, variant_id, variant_name, price, discount, discount_expiry, title, image, category"
        const PRODUCT_COLS = "id, title, price, discount, discount_expiry, stock, thumbnail, image, category, variants"
        const selectCart = (productCols) => supabase.from("cart_items").select(`${CART_COLS}, products(${productCols})`).eq("user_id", uid)
        let { data, error } = await selectCart(`${PRODUCT_COLS}, has_variants, main_option_enabled, track_inventory`)
        if (error) ({ data, error } = await selectCart(PRODUCT_COLS))

        if (error) {
          console.error("Error loading cart:", error)
          return
        }

        const formattedItems = (data || []).map((row) => {
          const p = row.products || {}
          const variantId = row.variant_id || ""
          // Compound id matches CartSlice expectations: productId_variantId for variants
          const compoundId = variantId ? `${row.product_id}_${variantId}` : row.product_id
          const variantObj = (Array.isArray(p.variants) ? p.variants : []).find((v) => v.id === variantId)
          const resolvedImage = variantObj?.image || row.image || p.thumbnail || p.image || ""
          // Is this line still something the shop can sell?  A variant that was deactivated / deleted, or a main
          // product that is no longer sold on its own, must NOT silently fall back to the main product's price & stock.
          const missingVariant = !!variantId && !variantObj
          const mainNotSold = !variantId && !!p.has_variants && p.main_option_enabled === false
          const unavailable = missingVariant || mainNotSold
          const untracked = variantId ? variantObj?.track_inventory === false : p.track_inventory === false

          // Stored snapshot values from cart_items table:
          const storedPrice = Number(row.price != null ? row.price : 0)
          const storedDiscount = Number(row.discount || 0)
          const storedDiscountExpiry = row.discount_expiry || ""

          // Live product price:
          const livePrice = missingVariant
            ? storedPrice                                     // keep the price the customer saw; the line is flagged unavailable
            : (variantId && variantObj?.price != null
              ? Number(variantObj.price)
              : (p.price != null ? Number(p.price) : storedPrice))
          const liveDiscount = Number(p.discount || 0)
          const liveDiscountExpiry = p.discount_expiry || ""

          return {
            id: compoundId,
            compound_id: compoundId,
            productId: row.product_id,
            variant_id: variantId,
            variant_name: row.variant_name || "",
            title: p.title || row.title || "",
            price: livePrice,
            storedPrice: storedPrice > 0 ? storedPrice : livePrice,
            storedDiscount,
            storedDiscountExpiry,
            quantity: row.quantity,
            image: resolvedImage,
            thumbnail: resolvedImage,
            stock: unavailable ? 0 : (untracked ? 9999 : (variantObj?.stock != null ? Number(variantObj.stock) : (p.stock || 0))),
            category: p.category || row.category || "general",
            discount: liveDiscount,
            discountExpiry: liveDiscountExpiry,
            unavailable,
          }
        })

        // Merge with optimistic local state so fast clicks aren't rolled back by delayed DB fetches
        const mergedItems = formattedItems.map((dbItem) => {
          const localItem = cartItemsRef.current.find((x) => String(x.id || x.compound_id) === String(dbItem.id))
          if (localItem && localItem.quantity > dbItem.quantity) {
            return { ...dbItem, quantity: localItem.quantity }
          }
          return dbItem
        })

        if (!areCartItemsEqual(mergedItems, cartItemsRef.current)) {
          dispatch(setCart(mergedItems))
        }
      }

      await fetchCart()

      const debouncedFetchCart = () => {
        if (fetchCartTimeout) clearTimeout(fetchCartTimeout)
        fetchCartTimeout = setTimeout(() => {
          fetchCart()
        }, 300)
      }

      const channel = supabase
        .channel(`cart-items-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "cart_items", filter: `user_id=eq.${uid}` },
          debouncedFetchCart
        )
        .subscribe()

      unsubCart = () => {
        if (fetchCartTimeout) clearTimeout(fetchCartTimeout)
        supabase.removeChannel(channel)
      }

      const { data: wishlistRows, error: wishlistError } = await supabase
        .from("wishlist_items")
        .select("*")
        .eq("user_id", uid)

      if (wishlistError) {
        console.error("Error loading wishlist:", wishlistError)
      } else {
        const wishlistData = (wishlistRows || []).map((row) => ({
          id: row.product_id,
          userId: row.user_id,
          productId: row.product_id,
          title: row.title,
          image: row.image,
          price: row.price,
          category: row.category,
          addedAt: row.added_at,
        }))
        dispatch(setWishlist(wishlistData))
      }
    }

    // Fetch the `profiles` row (replaces the old users/{uid} Firestore doc)
    // and hydrate Redux + cart/wishlist for a signed-in Supabase session.
    const handleSession = async (session) => {
      if (cancelled) return

      if (session?.user) {
        try {
          const { data: profile, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", session.user.id)
            .single()

          if (error) throw error

          dispatch(setUser({ ...profile, uid: session.user.id }))
          await loadCartAndWishlist(session.user.id)
        } catch (error) {
          console.error("Error loading user data:", error)
        }
      } else {
        if (unsubCart) { unsubCart(); unsubCart = null }
        dispatch(clearUser())
        dispatch(setCart([]))
        dispatch(setWishlist([]))
      }

      dispatch(stopLoading())
      setAuthChecked(true)
    }

    // Initial load, then react to sign-in/sign-out/token-refresh events.
    supabase.auth.getSession().then(({ data: { session } }) => handleSession(session))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // INITIAL_SESSION is already handled by getSession().then() above; skip it
      // here to avoid double-calling handleSession (and double-subscribing the
      // cart Realtime channel) on every page load with an active session.
      if (event === 'INITIAL_SESSION') return
      handleSession(session)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
      if (unsubCart) unsubCart()
    }

  }, [dispatch])

  if (!authChecked) {
    return <Loader />
  }

  return (

    <BrowserRouter>

      <ToastContainer position="top-right" autoClose={3000} />

      <SessionManager />

      {/* Navbar and MobileNav are hidden on admin routes — the sidebar takes over */}
      <NavbarVisibilityGuard>
        <Navbar />
        <MobileNav />
      </NavbarVisibilityGuard>
      <NavbarSpacer />

      <Suspense fallback={<Loader />}>
        <Routes>

          {/* PUBLIC */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* NEW PUBLIC ROUTES */}
          <Route path="/" element={<LandingPage />} />

          <Route path="/process-details" element={<ProcessDetailsPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/product/:id" element={<ProductDetail />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="/refund-policy" element={<RefundPolicyPage />} />
          <Route path="/terms-conditions" element={<TermsPage />} />
          <Route path="/shipping-policy" element={<ShippingPolicyPage />} />
          <Route path="/help" element={<FaqPage />} />
          <Route path="/faq" element={<FaqPage />} />



          {/* USER PROTECTED ROUTES */}
          <Route path="/cart" element={<UserRoute><CartPage /></UserRoute>} />
          <Route path="/wishlist" element={<UserRoute><WishlistPage /></UserRoute>} />
          <Route path="/userorders" element={<UserRoute><UserOrdersPage /></UserRoute>} />
          <Route path="/userpastorders" element={<UserRoute><UserPastOrdersPage /></UserRoute>} />
          <Route path="/order/:id" element={<UserRoute><OrderDetailPage /></UserRoute>} />
          <Route path="/myreturns" element={<UserRoute><MyReturnsPage /></UserRoute>} />
          <Route path="/notifications" element={<UserRoute><NotificationsPage /></UserRoute>} />
          <Route path="/myprofile" element={<UserRoute><MyProfile /></UserRoute>} />
          <Route path="/addresses" element={<UserRoute><AddressesPage /></UserRoute>} />


          <Route path="/video" element={<UserRoute><ScrollSequence /></UserRoute>} />



          {/* ADMIN ROUTES — wrapped in AdminLayout (sidebar shell) */}

          {/* Dashboard — default admin home shown on login */}
          <Route path="/admin/dashboard" element={<AdminRoute><AdminLayout><AdminDashboard /></AdminLayout></AdminRoute>} />

          {/* Orders Hub — 3 outer tabs: To Pack & Ship | All Orders | Returns */}
          <Route path="/admin/myorders" element={<AdminRoute><AdminLayout><OrdersHubPage /></AdminLayout></AdminRoute>} />

          {/* Customers Hub — 2 tabs: Everyone | Analytics */}
          <Route path="/admin/users" element={<AdminRoute><AdminLayout><CustomersHubPage /></AdminLayout></AdminRoute>} />

          {/* Products Hub — 2 tabs: Catalog | Analytics */}
          <Route path="/admin/add-product" element={<AdminRoute><AdminLayout><ProductsHubPage /></AdminLayout></AdminRoute>} />

          <Route path="/admin/adminUploadOrders" element={<AdminRoute><AdminLayout><AdminUploadOrders /></AdminLayout></AdminRoute>} />
          <Route path="/admin/upload-orders" element={<AdminRoute><AdminLayout><AdminUploadOrders /></AdminLayout></AdminRoute>} />

          <Route path="/admin/returns" element={<AdminRoute><AdminLayout><OrdersHubPage /></AdminLayout></AdminRoute>} />

          <Route path="/admin/inventory" element={<AdminRoute><AdminLayout><AdminInventoryPage /></AdminLayout></AdminRoute>} />

          <Route path="/admin/add-discount" element={<AdminRoute><AdminLayout><AddDiscountPage /></AdminLayout></AdminRoute>} />

          <Route path="/admin/edit-product/:id" element={<AdminRoute><AdminLayout><EditProductPage /></AdminLayout></AdminRoute>} />

          <Route path="/admin/createOrders" element={<AdminRoute><AdminLayout><CreateOrdersPage /></AdminLayout></AdminRoute>} />
          <Route path="/admin/create-order" element={<AdminRoute><AdminLayout><CreateOrdersPage /></AdminLayout></AdminRoute>} />

          <Route path="/admin/billing" element={<AdminRoute><AdminLayout><BillingPage /></AdminLayout></AdminRoute>} />

          <Route path="/admin/optimization" element={<AdminRoute><AdminLayout><Optimization /></AdminLayout></AdminRoute>} />

          {/* Legacy analytics routes — redirect to hub tabs (kept for any existing bookmarks) */}
          <Route path="/admin/allUsersOrdersAnalytics" element={<AdminRoute><AdminLayout><CustomersHubPage /></AdminLayout></AdminRoute>} />
          <Route path="/admin/allProductsOrdersAnalytics" element={<AdminRoute><AdminLayout><ProductsHubPage /></AdminLayout></AdminRoute>} />

        </Routes>
      </Suspense>

    </BrowserRouter>

  )

}

export default App