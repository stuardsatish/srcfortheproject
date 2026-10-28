import clsx from "clsx";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useWindowScroll } from "react-use";
import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { TiLocationArrow } from "react-icons/ti";
import {
  FaUserCircle,
  FaShoppingCart,
  FaMoon,
  FaSun,
  FaHeart,
} from "react-icons/fa";
import { supabase } from "../../context/SupabaseConfig";
import { clearUser } from "../../context/UserSlice";
import { useTheme } from "../../theme/ThemeContext";
import { assets } from "../../assets/assets";
import useIsMobile from "../../hooks/useIsMobile";
import { broadcastAuth, clearSession } from "../../utils/sessionUtils";
import { clearLocalSession } from "../../utils/sessionManager";
import NotificationBell from "../../features/notifications/NotificationBell";

/** Capitalise the first letter of a display name (e.g. "john" → "John"). */
const capitalize = (s) => {
  const str = String(s || "").trim();
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
};

const navItems = [
  { name: "Home", path: "/" },
  { name: "Products", path: "/products" },
  { name: "Process", path: "/process-details" },
];

// Per-route page background so the floating navbar (and the body around it)
// always blend with the page it sits on. Default is the app cream.
const ROUTE_BG = {
  "/admin/testing": "var(--color-surface-inverse)",
  "/admin/add-product": "var(--color-surface-muted)",
  "/admin/myorders": "var(--color-background)",
  "/admin/returns": "var(--color-background)",
  "/admin/inventory": "var(--color-background)",
  "/myreturns": "var(--color-background)",
  "/notifications": "var(--color-background)",
  "/admin/users": "var(--color-background)",
  "/admin/createOrders": "var(--color-background)",
  "/admin/billing": "var(--color-surface-muted)",
  "/admin/optimization": "var(--color-background)",
  "/admin/adminUploadOrders": "var(--color-surface-muted)",
  "/admin/allUsersOrdersAnalytics": "var(--color-info-subtle)",
  "/admin/allProductsOrdersAnalytics": "var(--color-surface-muted)",
};
const DEFAULT_BG = "var(--color-background)";
const isDarkBg = (hex) => {
  // Backgrounds are now theme tokens (`var(--color-...)`), not raw hex. This
  // luminance check only understands hex, so treat any non-hex value as a
  // light background (navText → ink) rather than mis-parsing it.
  if (typeof hex !== "string" || !hex.startsWith("#")) return false;
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 140;
};

const Navbar = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();

  const cartItems = useSelector((state) => state.cart.cartItems);
  const { mode, setMode } = useTheme();
  const darkMode = mode === "dark";
  const user = useSelector((state) => state.user.user);
  const wishlistItems = useSelector((state) => state.wishlist.wishlistItems);

  // Admins don't use the storefront — hide Products/Process/Contact + cart/wishlist.
  const isAdmin = user?.role === "admin";
  const adminHome = "/admin/myorders";
  // Admins get Home (their dashboard) + the two analytics dashboards inline.
  const visibleNavItems = isAdmin
    ? [
      { name: "Home", path: adminHome },
      { name: "Users Analytics", path: "/admin/allUsersOrdersAnalytics" },
      { name: "Products Analytics", path: "/admin/allProductsOrdersAnalytics" },
    ]
    : navItems;

  // The Redux user object already carries the full profile (fetched from
  // Supabase profiles on login/bootstrap) - no separate fetch needed here.
  const userData = user;
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const menuRef = useRef(null);
  const navContainerRef = useRef(null);

  const { y: currentScrollY } = useWindowScroll();
  const [lastScrollY, setLastScrollY] = useState(0);

  // Special route logic: Products route (/products) stays visible
  const isProductsRoute = location.pathname === "/products";
  const [isNavVisible, setIsNavVisible] = useState(true); // Always visible (sticky header)

  // Show the global navbar at the top on every route, including mobile.
  const isMobile = useIsMobile(640);
  const navHidden = false;

  // Navbar background adapts to the current page so it always blends in,
  // and we paint the body the same color (covers the gap around the pill).
  const bgKey = Object.keys(ROUTE_BG).find((p) => location.pathname.startsWith(p));
  const navBg = bgKey ? ROUTE_BG[bgKey] : DEFAULT_BG;
  const navDark = isDarkBg(navBg);
  const navText = navDark ? "var(--color-surface-muted)" : "var(--color-ink)";

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = navBg;
    return () => { document.body.style.background = prev; };
  }, [navBg]);

  const wishlistCount = wishlistItems.length;
  const totalCount = useMemo(
    () => cartItems.reduce((acc, item) => acc + item.quantity, 0),
    [cartItems]
  );
  const [cartBounced, setCartBounced] = useState(false);
  const prevCountRef = useRef(totalCount);

  useEffect(() => {
    if (totalCount > prevCountRef.current) {
      setCartBounced(true);
      const t = setTimeout(() => setCartBounced(false), 600);
      return () => clearTimeout(t);
    }
    prevCountRef.current = totalCount;
  }, [totalCount]);


  // Click outside to close menus
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keep the navbar visible on every route change
  useEffect(() => {
    setIsNavVisible(true);
  }, [location.pathname]);

  // Close mobile drawer on route change — and always release the body scroll
  // lock. The lock is set when the drawer opens; without this safety net a
  // navigation triggered from inside the drawer can leave `overflow: hidden`
  // stuck on <body>, which makes the destination page completely unscrollable
  // (most visible in mobile/phone view, where the drawer lives).
  useEffect(() => {
    setDrawerOpen(false);
    document.body.style.overflow = "";
  }, [location.pathname]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  // Keep the floating-nav pill styling on at all times (navbar no longer
  // auto-hides on scroll — it stays pinned in the header area).
  useEffect(() => {
    navContainerRef.current?.classList.add("floating-nav");
    setLastScrollY(currentScrollY);
  }, [currentScrollY]);

  // GSAP Animation — the navbar is permanently visible; it only retracts on the
  // mobile shell routes that render their own TopAppBar (via `navHidden`).
  useGSAP(() => {
    const show = !navHidden;

    gsap.to(navContainerRef.current, {
      yPercent: show ? 0 : -100,
      opacity: show ? 1 : 0,
      duration: 0.3,
      ease: "power2.out",
    });
  }, { dependencies: [navHidden], scope: navContainerRef });

  const handleLogout = useCallback(async () => {
    try {
      // Clear the active session in the profile first (while still
      // authenticated), so a clean logout leaves no "phantom" session for
      // the watcher to flag.
      if (user?.uid) {
        try {
          await supabase.from("profiles").update({ active_session_id: null }).eq("id", user.uid);
        } catch (e) {
          console.log("Could not clear active session:", e);
        }
      }
      clearLocalSession();

      await supabase.auth.signOut();
      dispatch(clearUser());
      clearSession();
      broadcastAuth("logout"); // sign out every other tab too
      setMenuOpen(false);
      setDrawerOpen(false);
      navigate("/login");
    } catch (error) {
      console.error("Logout Error:", error);
    }
  }, [dispatch, navigate, user]);


  const handleDrawerNav = (path) => {
    navigate(path);
    setDrawerOpen(false);
  };

  // Highlight the drawer item matching the current route.
  const drawerItemClass = (path) =>
    clsx(
      "w-full text-left px-0 min-h-[44px] flex items-center text-sm transition-colors",
      location.pathname === path || location.pathname.startsWith(path + "/")
        ? "text-accent-strong font-bold"
        : "text-ink/70 font-medium hover:text-ink"
    );

  return (
    <>
      {/* Top sensing area to trigger hover-to-show when navbar is hidden.
          Desktop only — the mobile shell (MobileNav) replaces the navbar below md. */}
      <div
        className={`hidden md:block fixed top-0 left-0 w-full h-8 z-[55] cursor-pointer ${navHidden ? "hidden" : ""}`}
        onMouseEnter={() => setIsHovering(true)}
      />

      <div
        ref={navContainerRef}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        className={`hidden md:block fixed inset-x-0 top-4 z-50 h-16 border-none transition-all duration-700 sm:inset-x-6 ${navHidden ? "hidden" : ""}`}
      >
        <header className="absolute top-1/2 w-full -translate-y-1/2">
          <nav className="relative flex size-full items-center justify-between p-4 backdrop-blur-sm rounded-lg sm:rounded-2xl border border-ink/10 shadow-sm" style={{ background: navBg }}>
            {/* Left: Logo & Products CTA */}
            <div className="flex items-center gap-7">
              <NavLink to={isAdmin ? adminHome : "/"} className="flex items-center">
                <img src={assets.logo} alt="logo" className="w-10 h-10 object-contain" />
              </NavLink>

              {!isAdmin && (
                <button
                  onClick={() => navigate("/products")}
                  className="bg-transparent border border-ink/20 text-ink md:flex hidden items-center justify-center gap-2 px-4 py-2 rounded-full font-bold text-xs uppercase transition-transform hover:scale-105 hover:bg-surface-inverse/5"
                >
                  <span>Products</span>
                  <TiLocationArrow />
                </button>
              )}
            </div>

            {/* Center: Navigation Links (Desktop only) */}
            <div className="flex h-full items-center">
              <div className="hidden md:flex items-center absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                {visibleNavItems.map((item, index) => (
                  <NavLink
                    key={index}
                    to={item.path}
                    style={{ color: navText }}
                    className={({ isActive }) =>
                      clsx(
                        "relative font-general text-xs uppercase after:absolute after:-bottom-0.5 after:left-0 after:h-[2px] after:w-full after:origin-bottom-right after:scale-x-0 after:bg-current after:transition-transform after:duration-300 after:ease-[cubic-bezier(0.65_0.05_0.36_1)] hover:after:origin-bottom-left hover:after:scale-x-100 cursor-pointer",
                        index !== 0 && "ms-10",
                        isActive && "after:scale-x-100"
                      )
                    }
                  >
                    {item.name}
                  </NavLink>
                ))}
              </div>

              {/* Right Side: Theme, Icons, User (Desktop) */}
              <div className="hidden md:flex items-center gap-5 ml-8">
                {/* Theme Toggle: Sun switches to light, Moon switches to dark */}
                <button
                  onClick={() => setMode(darkMode ? "light" : "dark")}
                  className="flex items-center group p-2 hover:bg-surface-inverse/5 rounded-full transition-all"
                  title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                >
                  <span className="">
                    {darkMode ? <FaSun size={18} style={{ color: navText }} /> : <FaMoon size={18} style={{ color: navText }} />}
                  </span>
                </button>

                {/* Notifications (customers and admins): unread count, opens /notifications */}
                {user && <NotificationBell color={navText} />}

                {user && !isAdmin && (
                  <>
                    <button
                      onClick={() => navigate("/wishlist")}
                      className="relative text-ink hover:text-accent-strong transition-colors"
                    >
                      <FaHeart size={18} />
                      {wishlistCount > 0 && (
                        <span className="absolute -top-2 -right-2 bg-accent-strong text-inverse text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
                          {wishlistCount}
                        </span>
                      )}
                    </button>

                    <button
                      onClick={() => navigate("/cart")}
                      className="relative text-ink hover:text-accent-strong transition-colors"
                    >
                      <FaShoppingCart size={20} />
                      {totalCount > 0 && (
                        <span className={`absolute -top-2 -right-2 bg-surface-inverse text-inverse text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold transition-all duration-300 ${cartBounced ? "scale-125 ring-2 ring-primary" : "scale-100"}`}>
                          {totalCount}
                        </span>
                      )}
                    </button>
                  </>
                )}

                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="hover:text-accent-strong transition-colors"
                    style={{ color: navText }}
                  >
                    <FaUserCircle size={28} />
                  </button>

                  {menuOpen && (
                    <div className="absolute right-0 mt-4 w-56 bg-surface/95 backdrop-blur-xl border border-ink/10 rounded-xl overflow-hidden shadow-2xl z-[60]">
                      <div className="px-4 py-3 border-b border-ink/5">
                        <p className="text-[10px] uppercase tracking-widest text-muted">
                          {user ? "Signed in as" : "Welcome"}
                        </p>
                        <p className="text-sm font-bold text-ink truncate">
                          {user ? capitalize(userData?.name) || "User" : "Guest"}
                        </p>
                      </div>

                      {!user && (
                        <button
                          onClick={() => { setMenuOpen(false); navigate("/login"); }}
                          className="w-full text-left px-4 py-3 text-sm text-ink hover:bg-surface-inverse/5 font-medium"
                        >
                          Login
                        </button>
                      )}

                      {user && user.role === "admin" ? (
                        <>
                          <NavLink to="/admin/users" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">Users</NavLink>
                          <NavLink to="/admin/add-product" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">Products</NavLink>
                          <NavLink to="/admin/createOrders" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">WhatsApp Order</NavLink>
                          <NavLink to="/admin/billing" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">Billing</NavLink>
                          <NavLink to="/admin/optimization" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">Optimization</NavLink>
                          <NavLink to="/admin/adminUploadOrders" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">Upload Orders</NavLink>
                          <NavLink to="/admin/myorders" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">My Orders</NavLink>
                          <NavLink to="/admin/returns" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">Returns &amp; Exchanges</NavLink>
                          <NavLink to="/admin/inventory" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">Inventory</NavLink>
                          <NavLink to="/admin/add-discount" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">Add Discount</NavLink>
                          <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-sm text-error hover:bg-error-subtle border-t border-ink/5">Logout</button>
                        </>
                      ) : user ? (
                        <>
                          <NavLink to="/myprofile" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">My Profile</NavLink>
                          <NavLink to="/userorders" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">Current Orders</NavLink>
                          <NavLink to="/userpastorders" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">Past Orders</NavLink>
                          <NavLink to="/myreturns" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">My Returns</NavLink>
                          {/* <NavLink to="/wishlist" onClick={() => setMenuOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-surface-inverse/5">Wishlist</NavLink> */}
                          <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-sm text-error hover:bg-error-subtle border-t border-ink/5">Logout</button>
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              {/* ── MOBILE: Action icons + Hamburger ── */}
              <div className="flex md:hidden items-center gap-3">
                {user && <NotificationBell size={18} className="relative text-ink min-w-[44px] min-h-[44px] flex items-center justify-center" badgeClassName="absolute top-1 right-1" />}
                {user && !isAdmin && (
                  <>
                    <button
                      onClick={() => navigate("/wishlist")}
                      className="relative text-ink min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <FaHeart size={18} />
                      {wishlistCount > 0 && (
                        <span className="absolute top-1 right-1 bg-accent-strong text-inverse text-[9px] rounded-full w-4 h-4 flex items-center justify-center">
                          {wishlistCount}
                        </span>
                      )}
                    </button>

                    <button
                      onClick={() => navigate("/cart")}
                      className="relative text-ink min-w-[44px] min-h-[44px] flex items-center justify-center"
                    >
                      <FaShoppingCart size={18} />
                      {totalCount > 0 && (
                        <span className={`absolute top-1 right-1 bg-surface-inverse text-inverse text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold transition-all duration-300 ${cartBounced ? "scale-125 ring-2 ring-primary" : "scale-100"}`}>
                          {totalCount}
                        </span>
                      )}
                    </button>
                  </>
                )}

                <button
                  onClick={() => setDrawerOpen(!drawerOpen)}
                  className={`hamburger-btn ${drawerOpen ? "active" : ""}`}
                  style={{ color: navText }}
                  aria-label="Toggle menu"
                >
                  <span></span>
                  <span></span>
                  <span></span>
                </button>
              </div>
            </div>
          </nav>
        </header>
      </div>

      {/* ── MOBILE DRAWER (retired — replaced by MobileNav below md; fully hidden) ── */}
      <div
        className={`mobile-drawer-backdrop hidden ${drawerOpen ? "open" : ""}`}
        onClick={() => setDrawerOpen(false)}
      />
      <div className={`mobile-drawer hidden ${drawerOpen ? "open" : ""}`}>
        <div className="flex flex-col h-full">
          {/* Drawer Header */}
          <div className="flex items-center justify-between p-6 border-b border-ink/5">
            <NavLink to={isAdmin ? adminHome : "/"} onClick={() => setDrawerOpen(false)} className="flex items-center gap-3">
              <img src={assets.logo} alt="logo" className="w-8 h-8 object-contain" />
              <span className="text-sm font-bold uppercase tracking-widest text-ink">Menu</span>
            </NavLink>
            <button
              onClick={() => setMode(darkMode ? "light" : "dark")}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-surface-inverse/5 transition-all"
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              {darkMode ? <FaSun size={18} className="text-ink" /> : <FaMoon size={18} className="text-ink" />}
            </button>
          </div>

          {/* Nav Links */}
          <div className="flex-1 py-4">
            {visibleNavItems.map((item, index) => (
              <NavLink
                key={index}
                to={item.path}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center px-6 min-h-[52px] text-sm font-bold uppercase tracking-widest transition-all",
                    isActive
                      ? "text-ink bg-surface-inverse/5 border-l-2 border-ink"
                      : "text-ink/60 hover:text-ink hover:bg-surface-inverse/[0.02]"
                  )
                }
              >
                {item.name}
              </NavLink>
            ))}
          </div>

          {/* User section */}
          <div className="border-t border-ink/5 p-6">
            {user ? (
              <div className="space-y-1">
                <div className="px-0 py-3 mb-2">
                  <p className="text-[10px] uppercase tracking-widest text-muted">Signed in as</p>
                  <p className="text-sm font-bold text-ink truncate">{capitalize(userData?.name) || "User"}</p>
                </div>
                {user.role === "admin" ? (
                  <>
                    <button onClick={() => handleDrawerNav("/admin/users")} className={drawerItemClass("/admin/users")}>Users</button>
                    <button onClick={() => handleDrawerNav("/admin/add-product")} className={drawerItemClass("/admin/add-product")}>Add Product</button>
                    <button onClick={() => handleDrawerNav("/admin/createOrders")} className={drawerItemClass("/admin/createOrders")}>WhatsApp Order</button>
                    <button onClick={() => handleDrawerNav("/admin/billing")} className={drawerItemClass("/admin/billing")}>Billing</button>
                    <button onClick={() => handleDrawerNav("/admin/optimization")} className={drawerItemClass("/admin/optimization")}>Optimization</button>
                    <button onClick={() => handleDrawerNav("/admin/adminUploadOrders")} className={drawerItemClass("/admin/adminUploadOrders")}>Upload Orders</button>
                    <button onClick={() => handleDrawerNav("/admin/myorders")} className={drawerItemClass("/admin/myorders")}>My Orders</button>
                    <button onClick={() => handleDrawerNav("/admin/returns")} className={drawerItemClass("/admin/returns")}>Returns &amp; Exchanges</button>
                    <button onClick={() => handleDrawerNav("/admin/inventory")} className={drawerItemClass("/admin/inventory")}>Inventory</button>
                    <button onClick={() => handleDrawerNav("/notifications")} className={drawerItemClass("/notifications")}>Notifications</button>
                    <button onClick={() => handleDrawerNav("/admin/add-discount")} className={drawerItemClass("/admin/add-discount")}>Add Discount</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => handleDrawerNav("/myprofile")} className={drawerItemClass("/myprofile")}>My Profile</button>
                    <button onClick={() => handleDrawerNav("/userorders")} className={drawerItemClass("/userorders")}>Current Orders</button>
                    <button onClick={() => handleDrawerNav("/userpastorders")} className={drawerItemClass("/userpastorders")}>Past Orders</button>
                    <button onClick={() => handleDrawerNav("/myreturns")} className={drawerItemClass("/myreturns")}>My Returns</button>
                    <button onClick={() => handleDrawerNav("/notifications")} className={drawerItemClass("/notifications")}>Notifications</button>
                    <button onClick={() => handleDrawerNav("/wishlist")} className={drawerItemClass("/wishlist")}>Wishlist</button>
                  </>
                )}
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-0 min-h-[44px] flex items-center text-sm text-error font-bold mt-2 pt-3 border-t border-ink/5"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleDrawerNav("/login")}
                className="w-full py-4 rounded-xl bg-surface-inverse text-inverse text-xs font-bold uppercase tracking-widest text-center hover:bg-surface-inverse transition-colors"
              >
                Login / Sign Up
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default memo(Navbar);