import { NavLink, useNavigate, useLocation } from "react-router-dom"
import { assets } from "../../assets/assets"
import { useDispatch, useSelector } from "react-redux"
import { toggleTheme } from "../../context/ThemeSlice"

import { supabase } from "../../context/SupabaseConfig"

import { clearUser } from "../../context/UserSlice"

import { useEffect, useState } from "react"

import { FaUserCircle } from "react-icons/fa"


const Header = () => {

  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()

  const cartItems = useSelector((state) => state.cart.cartItems)
  const darkMode = useSelector((state) => state.theme.darkMode)
  const user = useSelector((state) => state.user.user)
  const wishlistItems = useSelector((state) => state.wishlist.wishlistItems)

  const wishlistCount = wishlistItems.length

  // The Redux user object already carries the full profile (fetched from
  // Supabase profiles on login/bootstrap) - no separate fetch needed here.
  const userData = user
  const [menuOpen, setMenuOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const totalCount = cartItems.reduce(
    (acc, item) => acc + item.quantity,
    0
  )

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false)
    setMenuOpen(false)
  }, [location.pathname])

  // Lock body when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut()
      dispatch(clearUser())
      setDrawerOpen(false)
      navigate("/login")
    } catch (error) {
      console.error("Logout Error:", error)
    }
  }

  return (
    <>
      {/* Top Bar */}
      <div className="bg-muted text-inverse text-xs md:text-sm px-4 md:px-10 py-2 flex flex-col md:flex-row justify-between gap-1">
        <div className="space-x-4">
          <span> +91 99666 33322</span>
          <span className="hidden sm:inline"> contact@cognizant.com</span>
        </div>
      </div>

      {/* Navbar */}
      <header className="flex justify-between items-center px-4 md:px-10 py-3 md:py-4 shadow-md">

        <img src={assets.logo} alt="Logo" className="h-10 md:h-12 w-auto" />

        {/* Desktop Nav */}
        <nav className="hidden md:flex space-x-8 font-medium items-center">

          <NavLink
            to="/"
            className={({ isActive }) =>
              isActive ? "text-accent-strong" : "hover:text-accent-strong"
            }
          >
            Home
          </NavLink>

          <NavLink
            to="/products"
            className={({ isActive }) =>
              isActive ? "text-accent-strong" : "hover:text-accent-strong"
            }
          >
            Products
          </NavLink>

          <NavLink
            to="/services"
            className={({ isActive }) =>
              isActive ? "text-accent-strong" : "hover:text-accent-strong"
            }
          >
            Services
          </NavLink>

          <NavLink
            to="/contact"
            className={({ isActive }) =>
              isActive ? "text-accent-strong" : "hover:text-accent-strong"
            }
          >
            Contact Us
          </NavLink>

          {/* Theme Toggle */}
          <button onClick={() => dispatch(toggleTheme())} className="min-w-[44px] min-h-[44px] flex items-center justify-center">
            {darkMode ? " " : " "}
          </button>

          {/* Show Name */}
          {userData && (
            <span className="text-sm font-medium">
              Hi, {userData.name}
            </span>
          )}

          {/* Login / Logout */}
          {user ? (
            <button
              onClick={handleLogout}
              className="bg-error text-inverse px-3 py-1 rounded hover:bg-error/90"
            >
              Logout
            </button>
          ) : (
            <NavLink
              to="/login"
              className="bg-success text-inverse px-3 py-1 rounded hover:bg-success"
            >
              Login
            </NavLink>
          )}

          <div className="relative">
            <FaUserCircle
              size={28}
              className="cursor-pointer"
              onClick={() => setMenuOpen(!menuOpen)}
            />

            {menuOpen && (
              <div className="absolute right-0 bg-surface shadow-md rounded p-3 w-40 flex flex-col space-y-2 z-50">
                {user?.role === "user" && (
                  <NavLink to="/wishlist" className="block hover:text-accent-strong">
                    Wishlist
                    {wishlistCount > 0 && (
                      <span className="ml-2 bg-error text-inverse text-xs px-2 py-1 rounded-full">
                        {wishlistCount}
                      </span>
                    )}
                  </NavLink>
                )}

                {user?.role === "user" && (
                  <NavLink to="/cart" className="block hover:text-accent-strong">
                    Cart
                    {totalCount > 0 && (
                      <span className="ml-2 bg-accent text-inverse text-xs px-2 py-1 rounded-full">
                        {totalCount}
                      </span>
                    )}
                  </NavLink>
                )}

                {user?.role === "user" && (
                  <NavLink to="/userorders" className={({ isActive }) => isActive ? "text-accent-strong" : "hover:text-accent-strong"}>
                    My Orders
                  </NavLink>
                )}

                {user?.role === "admin" && (
                  <NavLink to="/admin/myorders" className={({ isActive }) => isActive ? "text-accent-strong" : "hover:text-accent-strong"}>
                    Admin Orders
                  </NavLink>
                )}

                {user?.role === "admin" && (
                  <NavLink to="/admin/add-product" className={({ isActive }) => isActive ? "text-accent-strong" : "hover:text-accent-strong"}>
                    Add Products
                  </NavLink>
                )}

                {user?.role === "admin" && (
                  <NavLink to="/admin/allUsersOrdersAnalytics" className={({ isActive }) => isActive ? "text-accent-strong" : "hover:text-accent-strong"}>
                    User Analytics
                  </NavLink>
                )}

                {user?.role === "admin" && (
                  <NavLink to="/admin/allProductsOrdersAnalytics" className={({ isActive }) => isActive ? "text-accent-strong" : "hover:text-accent-strong"}>
                    Product Analytics
                  </NavLink>
                )}

                {user?.role === "admin" && (
                  <NavLink to="/admin/adminUploadOrders" className={({ isActive }) => isActive ? "text-accent-strong" : "hover:text-accent-strong"}>
                    Upload fake orders
                  </NavLink>
                )}

                {user?.role === "user" && (
                  <NavLink to="/userpastorders" className={({ isActive }) => isActive ? "text-accent-strong" : "hover:text-accent-strong"}>
                    My Past Orders
                  </NavLink>
                )}
              </div>
            )}
          </div>

        </nav>

        {/* Mobile: hamburger + cart badge */}
        <div className="flex md:hidden items-center gap-2">
          {user && totalCount > 0 && (
            <button
              onClick={() => navigate("/cart")}
              className="relative min-w-[44px] min-h-[44px] flex items-center justify-center text-body"
            >

              <span className="absolute top-1 right-1 bg-accent text-inverse text-[9px] rounded-full w-4 h-4 flex items-center justify-center">
                {totalCount}
              </span>
            </button>
          )}
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            className={`hamburger-btn text-ink ${drawerOpen ? 'active' : ''}`}
            aria-label="Toggle menu"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </header>

      {/* Mobile Drawer */}
      <div
        className={`mobile-drawer-backdrop md:hidden ${drawerOpen ? 'open' : ''}`}
        onClick={() => setDrawerOpen(false)}
      />
      <div className={`mobile-drawer md:hidden ${drawerOpen ? 'open' : ''}`}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border-subtle">
            <img src={assets.logo} alt="Logo" className="h-8 w-auto" />
            <button
              onClick={() => dispatch(toggleTheme())}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              {darkMode ? " " : " "}
            </button>
          </div>

          {/* User greeting */}
          {userData && (
            <div className="px-6 py-3 bg-surface-muted">
              <p className="text-xs text-muted uppercase tracking-widest">Hello,</p>
              <p className="text-sm font-bold text-ink">{userData.name}</p>
            </div>
          )}

          {/* Nav Links */}
          <div className="flex-1 py-2">
            {[
              { to: "/", label: "Home" },
              { to: "/products", label: "Products" },
              { to: "/services", label: "Services" },
              { to: "/contact", label: "Contact Us" },
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  `flex items-center px-6 min-h-[48px] text-sm font-medium transition-all ${isActive ? "text-accent-strong bg-accent-subtle border-l-2 border-accent" : "text-body hover:bg-surface-muted"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}

            {/* User-specific links */}
            {user && (
              <div className="mt-2 pt-2 border-t border-border-subtle">
                {user.role === "user" && (
                  <>
                    <NavLink to="/wishlist" onClick={() => setDrawerOpen(false)} className="flex items-center justify-between px-6 min-h-[48px] text-sm text-body hover:bg-surface-muted">
                      <span>Wishlist</span>
                      {wishlistCount > 0 && <span className="bg-error text-inverse text-xs px-2 py-0.5 rounded-full">{wishlistCount}</span>}
                    </NavLink>
                    <NavLink to="/cart" onClick={() => setDrawerOpen(false)} className="flex items-center justify-between px-6 min-h-[48px] text-sm text-body hover:bg-surface-muted">
                      <span>Cart</span>
                      {totalCount > 0 && <span className="bg-accent text-inverse text-xs px-2 py-0.5 rounded-full">{totalCount}</span>}
                    </NavLink>
                    <NavLink to="/userorders" onClick={() => setDrawerOpen(false)} className="flex items-center px-6 min-h-[48px] text-sm text-body hover:bg-surface-muted">My Orders</NavLink>
                    <NavLink to="/userpastorders" onClick={() => setDrawerOpen(false)} className="flex items-center px-6 min-h-[48px] text-sm text-body hover:bg-surface-muted">Past Orders</NavLink>
                  </>
                )}
                {user.role === "admin" && (
                  <>
                    <NavLink to="/admin/myorders" onClick={() => setDrawerOpen(false)} className="flex items-center px-6 min-h-[48px] text-sm text-link hover:bg-info-subtle">Admin Orders</NavLink>
                    <NavLink to="/admin/add-product" onClick={() => setDrawerOpen(false)} className="flex items-center px-6 min-h-[48px] text-sm text-link hover:bg-info-subtle">Add Products</NavLink>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Bottom actions */}
          <div className="p-6 border-t border-border-subtle">
            {user ? (
              <button
                onClick={handleLogout}
                className="w-full py-3 bg-error text-inverse rounded-xl text-sm font-bold hover:bg-error/90 transition-colors"
              >
                Logout
              </button>
            ) : (
              <NavLink
                to="/login"
                onClick={() => setDrawerOpen(false)}
                className="block w-full py-3 bg-success text-inverse rounded-xl text-sm font-bold text-center hover:bg-success transition-colors"
              >
                Login
              </NavLink>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default Header