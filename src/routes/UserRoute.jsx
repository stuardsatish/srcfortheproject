import { Navigate } from "react-router-dom"
import { useSelector } from "react-redux"
import Loader from "../components/Common/Loader"

const UserRoute = ({ children }) => {

  const user = useSelector((state) => state.user.user)
  const loading = useSelector((state) => state.loading.loading)

  if (loading) {
    return <Loader />
  }

  if (!user) {
    return <Navigate to="/login" />
  }

  return children
}

export default UserRoute