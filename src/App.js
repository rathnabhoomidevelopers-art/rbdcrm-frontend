import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { HomePage } from "./HomePage";
import { LeadsTable } from "./LeadsTable";
import { FollowUpDashboard } from "./FollowUpDashboard";
import Header from "./Header";
import { Toaster } from "react-hot-toast";
import StatusDashboard from "./StatusDashboard";
import UserDashboard from "./UserDashboard";
import UserLogin from "./UserLogin";
import AdminLogin from "./AdminLogin";
import { ExtraPage } from "./ExtraPage";

function RequireAuth({ allowedRoles, children }) {
  const token = localStorage.getItem("token");
  const role = localStorage.getItem("role");

  if (!token || !role) {
    return <Navigate to="/userlogin" replace />;
  }

  if (!allowedRoles.includes(role)) {
    if (role === "admin") {
      return <Navigate to="/homepage" replace />;
    } else {
      return <Navigate to="/userdashboard" replace />;
    }
  }

  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Toaster />
      <Header />
      <Routes>
        <Route
          path="/"
          element={
            <RequireAuth allowedRoles={["admin"]}>
              <HomePage />
            </RequireAuth>
          }
        />
        <Route
          path="/homepage"
          element={
            <RequireAuth allowedRoles={["admin"]}>
              <HomePage />
            </RequireAuth>
          }
        />
        <Route
          path="/userdashboard"
          element={
            <RequireAuth allowedRoles={["admin", "user"]}>
              <UserDashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/leadstable"
          element={
            <RequireAuth allowedRoles={["admin", "user"]}>
              <LeadsTable />
            </RequireAuth>
          }
        />
        <Route
          path="/followupdashboard"
          element={
            <RequireAuth allowedRoles={["admin", "user"]}>
              <FollowUpDashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/statusdashboard"
          element={
            <RequireAuth allowedRoles={["admin", "user"]}>
              <StatusDashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/extra"
          element={
            <RequireAuth allowedRoles={["admin", "user"]}>
              <ExtraPage />
            </RequireAuth>
          }
        />
        <Route path="/userlogin" element={<UserLogin />} />
        <Route path="/adminlogin" element={<AdminLogin />} />
        <Route path="*" element={<Navigate to="/userlogin" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
