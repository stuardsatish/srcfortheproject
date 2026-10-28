import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  ChevronLeft,
  MoreVertical,
  Home as HomeIcon,
  Store as StoreIcon,
  ShoppingCart as CartIcon,
  Heart as HeartIcon,
  User as UserIcon,
  Users as UsersIcon,
  BarChart3 as ChartIcon,
  PlusSquare as PlusIcon,
  ClipboardList as OrdersIcon,
} from "lucide-react";
import { supabase } from "../../context/SupabaseConfig";
import { clearUser } from "../../context/UserSlice";
import useIsMobile from "../../hooks/useIsMobile";
import { broadcastAuth, clearSession } from "../../utils/sessionUtils";
import { clearLocalSession } from "../../utils/sessionManager";

/* ------------------------------------------------------------------ *
 * Mobile-only header + bottom tab bar (screens below 768px).
 * The desktop navbar is untouched; it is hidden below `md` and this
 * shell takes its place. All paths reuse the project's existing routes.
 * ------------------------------------------------------------------ */

// Title shown in the header, derived from the active route. Most-specific
// entries first; "/" is matched exactly so it doesn't swallow every path.
const ROUTE_TITLES = [
  ["/admin/users", "Users"],
  ["/admin/createOrders", "WhatsApp Order"],
  ["/admin/billing", "Billing"],
  ["/admin/optimization", "Optimization"],
  ["/admin/allUsersOrdersAnalytics", "User Analytics"],
  ["/admin/allProductsOrdersAnalytics", "Product Analytics"],
  ["/admin/adminUploadOrders", "Uploaded Orders"],
  ["/admin/add-product", "Add Product"],
  ["/admin/add-discount", "Add Discount"],
  ["/admin/edit-product", "Edit Product"],
  ["/admin/myorders", "My Orders"],
  ["/admin/returns", "Returns & Exchanges"],
  ["/admin/inventory", "Inventory"],
  ["/admin/testing", "Testing"],
  ["/product/", "Product"],
  ["/products", "Products"],
  ["/cart", "Cart"],
  ["/wishlist", "Wishlist"],
  ["/contact", "Contact"],
  ["/process-details", "Process"],
  ["/userorders", "Current Orders"],
  ["/userpastorders", "Past Orders"],
  ["/myreturns", "My Returns"],
  ["/notifications", "Notifications"],
  ["/order/", "Order Details"],
  ["/myprofile", "My Profile"],
  ["/addresses", "My Addresses"],
  ["/services", "Services"],
  ["/login", "Login"],
  ["/signup", "Sign Up"],
];

const resolveTitle = (pathname) => {
  if (pathname === "/") return "Home";
  const hit = ROUTE_TITLES.find(
    ([path]) => pathname === path || pathname.startsWith(path)
  );
  return hit ? hit[1] : "MELT";
};

const isActivePath = (pathname, path) =>
  path === "/"
    ? pathname === "/"
    : pathname === path || pathname.startsWith(path + "/") || pathname.startsWith(path);

const MobileNav = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile(768);

  const user = useSelector((state) => state.user.user);
  const cartItems = useSelector((state) => state.cart.cartItems);
  const wishlistItems = useSelector((state) => state.wishlist.wishlistItems);

  const isAdmin = user?.role === "admin";

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const cartCount = cartItems.reduce((acc, i) => acc + (i.quantity || 0), 0);
  const wishlistCount = wishlistItems.length;

  const [cartBounced, setCartBounced] = useState(false);
  const prevCartCountRef = useRef(cartCount);

  useEffect(() => {
    if (cartCount > prevCartCountRef.current) {
      setCartBounced(true);
      const t = setTimeout(() => setCartBounced(false), 600);
      return () => clearTimeout(t);
    }
    prevCartCountRef.current = cartCount;
  }, [cartCount]);

  // Close the dropdown when navigating, clicking outside, or pressing Escape.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const handleLogout = useCallback(async () => {
    try {
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
      broadcastAuth("logout");
      setMenuOpen(false);
      navigate("/login");
    } catch (error) {
      console.error("Logout Error:", error);
    }
  }, [dispatch, navigate, user]);

  const go = (path) => {
    setMenuOpen(false);
    navigate(path);
  };

  // Render nothing on desktop so the existing navbar stands alone.
  if (!isMobile) return null;

  // Dropdown items by role (paths are all existing routes).
  const menuItems = isAdmin
    ? [
      { label: "Users", path: "/admin/users" },
      { label: "WhatsApp Order", path: "/admin/createOrders" },
      { label: "Billing", path: "/admin/billing" },
      { label: "Optimization", path: "/admin/optimization" },
      { label: "Uploaded Orders", path: "/admin/adminUploadOrders" },
      { label: "Returns & Exchanges", path: "/admin/returns" },
      { label: "Inventory", path: "/admin/inventory" },
      { label: "Notifications", path: "/notifications" },
      { label: "Add Discount", path: "/admin/add-discount" },
      { label: "Edit Profile", path: "/myprofile" },
    ]
    : [
      { label: "Process", path: "/process-details" },
      { label: "Contact", path: "/contact" },
      { label: "My Profile", path: "/myprofile" },
      { label: "Current Orders", path: "/userorders" },
      { label: "Past Orders", path: "/userpastorders" },
      { label: "My Returns", path: "/myreturns" },
      { label: "Notifications", path: "/notifications" },
      { label: "Edit Profile", path: "/myprofile" },
    ];

  // Bottom tabs by role.
  const tabs = isAdmin
    ? [
      { label: "Home", path: "/", Icon: HomeIcon, fillActive: true },
      { label: "User Analytics", path: "/admin/allUsersOrdersAnalytics", Icon: UsersIcon },
      { label: "Product Analytics", path: "/admin/allProductsOrdersAnalytics", Icon: ChartIcon },
      { label: "Add Product", path: "/admin/add-product", Icon: PlusIcon },
      { label: "My Orders", path: "/admin/myorders", Icon: OrdersIcon },
    ]
    : [
      { label: "Home", path: "/", Icon: HomeIcon, fillActive: true },
      { label: "Products", path: "/products", Icon: StoreIcon },
      { label: "Cart", path: "/cart", Icon: CartIcon, dot: cartCount > 0 },
      { label: "Wishlist", path: "/wishlist", Icon: HeartIcon },
      { label: "Profile", path: "/myprofile", Icon: UserIcon },
    ];

  const title = resolveTitle(location.pathname);

  return (
    <>
      {/* ── MOBILE HEADER ── */}
      <header
        className="md:hidden fixed top-0 inset-x-0 z-[60] h-14 flex items-center justify-between px-1"
        style={{
          background: "color-mix(in srgb, var(--color-background) 92%, transparent)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          boxShadow: "0px 2px 12px -6px rgba(16,24,40,0.14)",
        }}
      >
        {/* Left: back */}
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="min-w-[44px] min-h-[44px] flex items-center justify-center active:opacity-60"
          style={{ color: "var(--color-body)" }}
        >
          <ChevronLeft size={24} strokeWidth={2.2} />
        </button>

        {/* Center: dynamic page title. Intentionally NOT an <h1> — the landing
            page runs GSAP SplitText.create("h1") which globally splits every
            <h1> into character spans; that mutates the node outside React and
            freezes the title on route changes. A span (role=heading) is
            invisible to that selector. */}
        <span
          role="heading"
          aria-level={1}
          className="block flex-1 mx-2 text-center truncate"
          style={{
            fontSize: "15px",
            fontWeight: 800,
            letterSpacing: "0.4px",
            textTransform: "uppercase",
            color: "var(--color-ink)",
          }}
        >
          {title}
        </span>

        {/* Right: three-dot menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Open menu"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center active:opacity-60"
            style={{ color: "var(--color-body)" }}
          >
            <MoreVertical size={22} strokeWidth={2.2} />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-1 top-full mt-1 w-56 bg-surface border border-ink/10 rounded-xl overflow-hidden shadow-2xl z-[70]"
            >
              {/* Signed in as — muted caption */}
              <div className="px-4 py-3 border-b border-ink/5">
                <p className="text-[10px] uppercase tracking-widest text-muted">
                  {user ? "Signed in as" : "Welcome"}
                </p>
                <p className="text-sm font-bold text-ink truncate">
                  {user ? user.name || "User" : "Guest"}
                </p>
              </div>

              {user ? (
                <>
                  {menuItems.map((item, i) => (
                    <button
                      key={`${item.path}-${i}`}
                      role="menuitem"
                      onClick={() => go(item.path)}
                      className="w-full text-left px-4 py-3 text-sm text-ink hover:bg-surface-inverse/5 active:bg-surface-inverse/5"
                    >
                      {item.label}
                    </button>
                  ))}
                  <button
                    role="menuitem"
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-3 text-sm text-error font-semibold hover:bg-error-subtle active:bg-error-subtle border-t border-ink/5"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <button
                  role="menuitem"
                  onClick={() => go("/login")}
                  className="w-full text-left px-4 py-3 text-sm text-ink hover:bg-surface-inverse/5 active:bg-surface-inverse/5"
                >
                  Login
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ── MOBILE BOTTOM TAB BAR (shown on every route) ── */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-[60] flex items-stretch"
        style={{
          background: "color-mix(in srgb, var(--color-background) 85%, transparent)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          borderRadius: "16px 16px 0 0",
          boxShadow: "0px -8px 24px -6px rgba(0,0,0,0.10)",
          paddingTop: "10px",
          paddingBottom: "calc(8px + env(safe-area-inset-bottom))",
        }}
      >
        {tabs.map(({ label, path, Icon, dot, fillActive }) => {
          const active = isActivePath(location.pathname, path);
          const color = active ? "var(--color-primary)" : "var(--color-body)";
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              aria-current={active ? "page" : undefined}
              className="relative flex-1 flex flex-col items-center justify-center"
              style={{ gap: "4px", color }}
            >
              <span className="relative flex items-center justify-center">
                <Icon
                  size={22}
                  strokeWidth={active ? 2.4 : 2}
                  fill={fillActive && active ? "var(--color-primary)" : "none"}
                />
                {dot && (
                  <span
                    className={`transition-all duration-300 ${cartBounced ? "scale-150 ring-2 ring-primary/40" : "scale-100"}`}
                    style={{
                      position: "absolute",
                      top: "-3px",
                      right: "-4px",
                      width: "8px",
                      height: "8px",
                      background: "var(--color-primary)",
                      borderRadius: "9999px",
                    }}
                  />
                )}
              </span>
              <span style={{ fontSize: "11px", fontWeight: active ? 600 : 500, lineHeight: 1 }}>
                {label}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
};

export default MobileNav;