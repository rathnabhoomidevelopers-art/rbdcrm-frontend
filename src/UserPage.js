// ✅ UPDATED UserPage: Edit option removed (button + modal + form + schema + edit state)

import { useState, useEffect } from "react";
import { PrinterIcon, RefreshCw, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiWithRetry } from "./api";

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  return `${day}-${month}-${year} ${hours}:${minutes} ${ampm}`;
}

function getStatusTextClass(status) {
  const s = (status || "").toString().trim().toLowerCase();
  switch (s) {
    case "booked":
      return "text-success fw-semibold small";
    case "site visited":
      return "text-primary fw-semibold small";
    case "visit scheduled":
    case "follow up":
      return "text-warning fw-semibold small";
    case "details_shared":
    case "details shared":
      return "text-info fw-semibold small";
    case "nr/sf":
    case "rnr":
    case "busy":
      return "text-secondary fw-semibold small";
    case "location issue":
      return "text-success fw-semibold small";
    case "cp":
      return "text-primary fw-semibold small";
    case "budget issue":
      return "text-warning fw-semibold small";
    case "visit postponed":
      return "text-info fw-semibold small";
    case "closed":
      return "text-danger fw-semibold small";
    case "invalid":
    case "not interested":
      return "text-danger fw-semibold small";
    default:
      return "text-muted small";
  }
}

const TRACKED_STATUSES = [
  "Visit Scheduled",
  "NR/SF",
  "RNR",
  "Details_shared",
  "Site Visited",
  "Booked",
  "Invalid",
  "Not Interested",
  "Location Issue",
  "CP",
  "Budget Issue",
  "Visit Postponed",
  "Closed",
  "Busy",
];

function formatStatusLabel(status) {
  if (status === "Details_shared") return "Details Shared";
  return status || "";
}

const PROJECT_OPTIONS = [
  "Northern Lights",
  "Gk hill view",
  "Novara farmland",
  "Konig villa homes",
  "Sattva lumino",
  "Godrej woods",
  "Ranka ankura",
  "Vajram vivera",
  "SLV golden towers",
];

const normalize = (value) =>
  (value || "")
    .toString()
    .trim()
    .toLowerCase();

export function UserPage() {
  const [users, setUsers] = useState([]);
  const [statusFilter, setStatusFilter] = useState("All");
  const [assignedFilter, setAssignedFilter] = useState("All");
  const [projectFilter, setProjectFilter] = useState("All");
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchLeads = async (showToast = true) => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiWithRetry(
        {
          method: "GET",
          url: "/leads",
        },
        3
      );

      const role = localStorage.getItem("role");
      const username = (localStorage.getItem("username") || "")
        .toString()
        .trim()
        .toLowerCase();

      let data = response.data || [];

      if (role === "user") {
        data = data.filter(
          (lead) =>
            (lead.Assigned_to || "").toString().trim().toLowerCase() === username
        );
      }

      setUsers(data);
      setRetryCount(0);

      if (showToast && data.length > 0) {
        toast.success(`Loaded ${data.length} leads`);
      }

      return data;
    } catch (err) {
      console.error("Error fetching leads in UserPage", {
        message: err.message,
        status: err.status,
        data: err.data,
        isNetworkError: err.isNetworkError,
        isCorsError: err.isCorsError,
        isTimeout: err.isTimeout,
      });

      let errorMessage = "Failed to load leads. ";

      if (err.isNetworkError) {
        errorMessage += "Please check your internet connection.";
      } else if (err.isCorsError) {
        errorMessage += "Server configuration error. Please contact administrator.";
      } else if (err.isTimeout) {
        errorMessage += "Request timed out. Please try again.";
      } else if (err.status === 401) {
        errorMessage = "Session expired. Please login again.";
        localStorage.clear();
        setTimeout(() => {
          window.location.href = "/userlogin";
        }, 1000);
      } else if (err.status === 403) {
        errorMessage = "You don't have permission to view leads.";
      } else if (err.status === 404) {
        errorMessage = "Leads endpoint not found.";
      } else if (err.status >= 500) {
        errorMessage = "Server error. Please try again later.";
      } else {
        errorMessage += err.message || "Please try again.";
      }

      setError({
        message: errorMessage,
        type: err.isNetworkError
          ? "network"
          : err.isCorsError
          ? "cors"
          : err.isTimeout
          ? "timeout"
          : "api",
        status: err.status,
      });

      if (showToast) toast.error(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1);
    fetchLeads(true);
  };

  useEffect(() => {
    let isMounted = true;

    const loadLeads = async () => {
      await fetchLeads(false);
    };

    loadLeads();

    const handleLeadsUpdated = () => {
      if (isMounted) loadLeads();
    };

    window.addEventListener("leads-updated", handleLeadsUpdated);

    return () => {
      isMounted = false;
      window.removeEventListener("leads-updated", handleLeadsUpdated);
    };
  }, []);

  const assignedOptions = [
    "All",
    ...Array.from(
      new Set(
        users
          .map((u) => (u.Assigned_to || "").trim())
          .filter((v) => v && v.length > 0)
      )
    ).sort(),
  ];

  const projectOptions = ["All", ...PROJECT_OPTIONS];

  const filteredUsers = users.filter((u) => {
    if (statusFilter !== "All") {
      const filterNorm = normalize(statusFilter);
      const statusNorm = normalize(u.status);

      if (filterNorm === "visit scheduled") {
        if (
          statusNorm !== "visit scheduled" &&
          statusNorm !== "follow up" &&
          statusNorm !== "follow-up"
        ) {
          return false;
        }
      } else {
        if (!u.status || statusNorm !== filterNorm) return false;
      }
    }

    if (assignedFilter !== "All") {
      if (!u.Assigned_to || normalize(u.Assigned_to) !== normalize(assignedFilter))
        return false;
    }

    if (projectFilter !== "All") {
      if (!u.project || normalize(u.project) !== normalize(projectFilter))
        return false;
    }

    if (fromDateFilter || toDateFilter) {
      if (!u.dob) return false;
      const leadDate = new Date(u.dob);
      if (Number.isNaN(leadDate.getTime())) return false;

      if (fromDateFilter) {
        const from = new Date(fromDateFilter);
        from.setHours(0, 0, 0, 0);
        if (leadDate < from) return false;
      }

      if (toDateFilter) {
        const to = new Date(toDateFilter);
        to.setHours(23, 59, 59, 999);
        if (leadDate > to) return false;
      }
    }

    return true;
  });

  const totalLeads = users.length;
  const showingLeads = filteredUsers.length;

  const handleExportCSV = () => {
    const exportData = filteredUsers;

    if (!exportData || exportData.length === 0) {
      toast.error("No leads to export for current filters");
      return;
    }

    const headers = [
      "Lead ID",
      "Name",
      "Mobile",
      "Source",
      "Status",
      "Profession",
      "Budget",
      "Remarks",
      "Date & Time",
      "Assigned To",
      "Project",
      "Verification Call",
    ];

    const escapeCSV = (value) => {
      if (value === null || value === undefined) return "";
      const str = String(value).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = exportData.map((user) => [
      user.lead_id,
      user.name,
      user.mobile,
      user.source,
      user.status,
      user.job_role,
      user.budget,
      user.remarks,
      formatDateTime(user.dob),
      user.Assigned_to,
      user.project || "",
      user.verification_call ? "Yes" : "No",
    ]);

    const csvLines = [
      headers.map(escapeCSV).join(","),
      ...rows.map((row) => row.map(escapeCSV).join(",")),
    ];

    const csvContent = csvLines.join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `leads_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${exportData.length} leads`);
  };

  const handleResetFilters = () => {
    setStatusFilter("All");
    setAssignedFilter("All");
    setProjectFilter("All");
    setFromDateFilter("");
    setToDateFilter("");
  };

  const renderErrorState = () => {
    if (!error) return null;

    return (
      <div className="card border-0 shadow-sm rounded-3 mb-3">
        <div className="card-body text-center py-5">
          <AlertCircle size={48} className="text-danger mb-3" />
          <h5 className="mb-2">Unable to Load Leads</h5>
          <p className="text-muted mb-4">{error.message}</p>
          <div className="d-flex justify-content-center gap-3">
            <button className="btn btn-primary" onClick={handleRetry} disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2"></span>
                  Retrying...
                </>
              ) : (
                <>
                  <RefreshCw size={16} className="me-2" />
                  Retry ({retryCount})
                </>
              )}
            </button>

            {error.type === "cors" && (
              <button
                className="btn btn-outline-secondary"
                onClick={() => {
                  toast.loading("Checking server health...");
                  api
                    .get("/health")
                    .then(() => toast.success("Server is responding"))
                    .catch(() => toast.error("Server is not responding"))
                    .finally(() => toast.dismiss());
                }}
              >
                Check Server Status
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-vh-100" style={{ backgroundColor: "#f1f3f5", padding: "16px" }}>
      <div className="container-fluid" style={{ maxWidth: "1600px", margin: "0 auto" }}>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h1 className="mb-1 fw-bold" style={{ fontSize: "2.4rem", color: "#212529" }}>
              Leads Overview
            </h1>
            <div className="text-muted small">
              {error ? "Error loading leads" : `Managing ${totalLeads} leads`}
            </div>
          </div>

          <div className="d-flex gap-2">
            <button
              className="btn btn-outline-secondary d-flex align-items-center"
              onClick={handleRetry}
              disabled={loading}
              title="Refresh leads"
            >
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>

            <button
              className="btn btn-outline-primary d-flex align-items-center"
              onClick={handleExportCSV}
              disabled={loading || filteredUsers.length === 0 || !!error}
            >
              <PrinterIcon size={16} />
              <span className="ms-2">{loading ? "Preparing..." : "Export CSV"}</span>
            </button>
          </div>
        </div>

        <div className="row g-3 mb-3">
          <div className="col-6 col-md-3">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body py-2">
                <div className="text-muted small mb-1">Total Leads</div>
                <div className="fw-bold" style={{ fontSize: "1.3rem" }}>
                  {error ? "—" : totalLeads}
                </div>
              </div>
            </div>
          </div>

          <div className="col-6 col-md-3">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body py-2">
                <div className="text-muted small mb-1">Showing</div>
                <div className="fw-bold" style={{ fontSize: "1.3rem" }}>
                  {error ? "—" : showingLeads}
                </div>
              </div>
            </div>
          </div>
        </div>

        {renderErrorState()}

        {!error && (
          <div className="card border-0 shadow-sm rounded-3">
            <div className="border-bottom bg-light" style={{ padding: "10px 16px" }}>
              <div className="row g-3 align-items-md-center">
                <div className="col-12 col-md-5">
                  <label className="form-label small mb-1 text-muted">Status</label>
                  <div className="d-flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`btn btn-sm rounded-pill px-3 py-1 ${
                        statusFilter === "All"
                          ? "btn-dark shadow-sm"
                          : "btn-outline-secondary"
                      }`}
                      onClick={() => setStatusFilter("All")}
                    >
                      All
                    </button>

                    {TRACKED_STATUSES.map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={`btn btn-sm rounded-pill px-3 py-1 ${
                          statusFilter === status
                            ? "btn-primary shadow-sm"
                            : "btn-outline-primary"
                        }`}
                        onClick={() => setStatusFilter(status)}
                      >
                        {formatStatusLabel(status)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="col-12 col-md-3">
                  <label className="form-label small mb-1 text-muted">Assigned To</label>
                  <select
                    className="form-select form-select-sm"
                    value={assignedFilter}
                    onChange={(e) => setAssignedFilter(e.target.value)}
                    disabled={loading}
                  >
                    {assignedOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-12 col-md-2">
                  <label className="form-label small mb-1 text-muted">Project</label>
                  <select
                    className="form-select form-select-sm"
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                    disabled={loading}
                  >
                    {["All", ...PROJECT_OPTIONS].map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-12 col-md-2">
                  <label className="form-label small mb-1 text-muted">Date Range</label>
                  <div className="row g-1">
                    <div className="col-12 col-sm-5">
                      <input
                        type="date"
                        className="form-control form-control-sm w-100"
                        value={fromDateFilter}
                        onChange={(e) => setFromDateFilter(e.target.value)}
                        disabled={loading}
                      />
                    </div>

                    <div className="col-12 col-sm-2 d-flex align-items-center justify-content-center">
                      <span className="small text-muted">—</span>
                    </div>

                    <div className="col-12 col-sm-5">
                      <input
                        type="date"
                        className="form-control form-control-sm w-100"
                        value={toDateFilter}
                        onChange={(e) => setToDateFilter(e.target.value)}
                        disabled={loading}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="row mt-2">
                <div className="col-12 d-flex justify-content-end">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={handleResetFilters}
                    disabled={
                      loading ||
                      (statusFilter === "All" &&
                        assignedFilter === "All" &&
                        projectFilter === "All" &&
                        !fromDateFilter &&
                        !toDateFilter)
                    }
                  >
                    Reset Filters
                  </button>
                </div>
              </div>
            </div>

            <div className="table-responsive" id="lead-print-area">
              <table className="table table-hover mb-0 align-middle">
                <thead className="table-light">
                  <tr>
                    <th style={{ width: "12%" }}>Mobile</th>
                    <th style={{ width: "18%" }}>Name</th>
                    <th style={{ width: "15%" }}>Source</th>
                    <th style={{ width: "15%" }}>Status</th>
                    <th style={{ width: "15%" }}>Project</th>
                    <th style={{ width: "15%" }}>Date &amp; Time</th>
                    <th style={{ width: "10%" }}>Assigned To</th>
                    {/* ✅ Actions column removed */}
                  </tr>
                </thead>

                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user._id || user.lead_id}>
                      <td className="fw-semibold text-primary">{user.mobile}</td>

                      <td>
                        <div className="fw-semibold">{user.name}</div>
                        {user.job_role && (
                          <div className="small text-muted">{user.job_role}</div>
                        )}
                        {user.verification_call && (
                          <div className="mt-1">
                            <span
                              className="badge rounded-pill"
                              style={{
                                backgroundColor: "#f97316",
                                color: "#fff",
                                fontSize: "0.65rem",
                              }}
                            >
                              Verification Call
                            </span>
                          </div>
                        )}
                      </td>

                      <td>
                        <span className="small text-muted">{user.source || "—"}</span>
                      </td>

                      <td>
                        <span className={getStatusTextClass(user.status)}>
                          {user.status ? formatStatusLabel(user.status) : "—"}
                        </span>
                      </td>

                      <td>
                        {user.project ? (
                          <span className="small">{user.project}</span>
                        ) : (
                          <span className="text-muted small">—</span>
                        )}
                      </td>

                      <td>
                        <div className="small fw-semibold">{formatDateTime(user.dob)}</div>
                      </td>

                      <td>
                        <span className="small text-dark">{user.Assigned_to || "—"}</span>
                      </td>
                    </tr>
                  ))}

                  {filteredUsers.length === 0 && !loading && (
                    <tr>
                      <td colSpan={7} className="text-center text-muted py-4">
                        No leads found for selected filters.
                      </td>
                    </tr>
                  )}

                  {loading && (
                    <tr>
                      <td colSpan={7} className="text-center py-4">
                        <div className="spinner-border text-primary" role="status">
                          <span className="visually-hidden">Loading...</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <style>
        {`
          .spin { animation: spin 1s linear infinite; }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
}

export default UserPage;