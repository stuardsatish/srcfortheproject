import AdminSidebar from "./AdminSidebar"
import { useSelector } from "react-redux"

/* ─── Brand colour tokens (matching Pelago HTML designs) ─── */
const CANVAS = "#EDE8E1"

/**
 * AdminLayout — wraps every admin page with the new Pelago-style sidebar.
 *
 * Usage in App.jsx:
 *   <AdminRoute><AdminLayout><SomePage /></AdminLayout></AdminRoute>
 *
 * The layout:
 *  - Sets a canvas background (#EDE8E1) for the entire admin shell
 *  - Renders the sticky sidebar on the left
 *  - Renders the page content in a scrollable main area on the right
 *  - Hides the floating Navbar on admin routes (done via App.jsx isAdmin check)
 */
const AdminLayout = ({ children }) => {
  const user = useSelector(state => state.user.user)
  const isAdmin = user?.role === "admin"

  // Safety: don't render the admin shell for non-admins (AdminRoute handles
  // the redirect, but this prevents a flash of the sidebar)
  if (!isAdmin) return children

  return (
    <div
      style={{
        background: CANVAS,
        minHeight: "100dvh",
        display: "flex",
        padding: "12px",
        gap: "16px",
        boxSizing: "border-box",
        fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif",
        // Override global body background for admin pages
      }}
      className="admin-layout"
    >
      {/* Left sidebar — sticky, always visible */}
      <AdminSidebar />

      {/* Main content area */}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: "0",
          overflowX: "hidden",
          // Pages handle their own internal padding
        }}
      >
        {children}
      </main>
    </div>
  )
}

export default AdminLayout
