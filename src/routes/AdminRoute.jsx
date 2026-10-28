import { Navigate } from "react-router-dom"
import { useSelector } from "react-redux"
import Loader from "../components/Common/Loader"

const AdminRoute = ({ children }) => {

  const user = useSelector((state) => state.user.user)
  const loading = useSelector((state) => state.loading.loading)

  if (loading) {
    return <Loader />
  }

  // Not logged in
  if (!user) {
    return <Navigate to="/login" />
  }

  // Logged in but not admin
  if (user.role !== "admin") {
    return <Navigate to="/" />
  }

  return children
}

export default AdminRoute