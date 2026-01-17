// UserPage.js — Pivot Summary Layout
// ✅ Rows: Source + Assigned To
// ✅ Columns: ALL Statuses (dynamic)
// ✅ Admin: click any count cell → modal opens with leads list → click lead → detail view
// ✅ Keeps your fetch, retry, export CSV, filters, error handling, styling

import { useState, useEffect, useMemo } from "react";
import { PrinterIcon, RefreshCw, AlertCircle, X } from "lucide-react";
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

const PROJECT_OPTIONS = [
  "Northern Lights",
  "Gk hill view",
  "Novara farmland",
  "Konig villa homes",
  "Sattva lumino",
  "Godrej woods",
  "Ranka ankura",
  "Vajram vivera",
  "Tata Varnam",
  "TVS Emrald",
  "Casagrand",
  "Expat wisdom tree",
  "Sumuk Square",
  "Concorde Neo",
  "SLV golden towers",
];

const normalize = (value) =>
  (value || "")
    .toString()
    .trim()
    .toLowerCase();

const toTitleCaseSmart = (value) => {
  const s = (value || "").toString().trim();
  if (!s) return "—";

  const cleaned = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();

  return cleaned
    .split(" ")
    .map((w) => {
      if (/^[A-Z0-9/.-]+$/.test(w)) return w;
      if (w.length <= 2) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
};

// stable key for row combo
const rowKeyOf = (src, assigned) => `${src}|||${assigned}`;
const splitRowKey = (k) => {
  const [source, assignedTo] = (k || "").split("|||");
  return { source: source || "—", assignedTo: assignedTo || "—" };
};

export function UserPage() {
  const [users, setUsers] = useState([]);
  const [assignedFilter, setAssignedFilter] = useState("All");
  const [projectFilter, setProjectFilter] = useState("All");
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  // ✅ Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("list"); // "list" | "detail"
  const [modalTitle, setModalTitle] = useState("");
  const [modalLeads, setModalLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);

  const role = (localStorage.getItem("role") || "").toString().trim().toLowerCase();
  const isAdmin = role !== "user"; // admin/manager etc. → can click cells

  const fetchLeads = async (showToast = true) => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiWithRetry(
        { method: "GET", url: "/leads" },
        3
      );

      const username = (localStorage.getItem("username") || "")
        .toString()
        .trim()
        .toLowerCase();

      let data = response.data || [];

      // role based filtering
      if (role === "user") {
        data = data.filter(
          (lead) =>
            (lead.Assigned_to || "").toString().trim().toLowerCase() === username
        );
      }

      setUsers(data);
      setRetryCount(0);

      if (showToast && data.length > 0) toast.success(`Loaded ${data.length} leads`);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assignedOptions = useMemo(() => {
    return [
      "All",
      ...Array.from(
        new Set(
          users
            .map((u) => (u.Assigned_to || "").trim())
            .filter((v) => v && v.length > 0)
        )
      ).sort(),
    ];
  }, [users]);

  // Filters: Assigned + Project + Date range
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (assignedFilter !== "All") {
        if (!u.Assigned_to || normalize(u.Assigned_to) !== normalize(assignedFilter))
          return false;
      }

      if (projectFilter !== "All") {
        if (!u.project || normalize(u.project) !== normalize(projectFilter)) return false;
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
  }, [users, assignedFilter, projectFilter, fromDateFilter, toDateFilter]);

  const totalLeads = users.length;
  const showingLeads = filteredUsers.length;

  // ✅ ALL statuses dynamically (columns)
  const statuses = useMemo(() => {
    const unique = Array.from(
      new Set(
        filteredUsers
          .map((u) => (u.status || "—").toString().trim() || "—")
          .filter(Boolean)
      )
    );

    return unique.sort((a, b) => {
      if (a === "—") return 1;
      if (b === "—") return -1;
      return a.localeCompare(b);
    });
  }, [filteredUsers]);

  // ✅ Row combos: Source + AssignedTo
  const rowKeys = useMemo(() => {
    const unique = Array.from(
      new Set(
        filteredUsers.map((u) => {
          const src = (u.source || "—").toString().trim() || "—";
          const asg = (u.Assigned_to || "—").toString().trim() || "—";
          return rowKeyOf(src, asg);
        })
      )
    );

    // Sort by source then assigned
    return unique.sort((a, b) => {
      const A = splitRowKey(a);
      const B = splitRowKey(b);
      if (A.source !== B.source) {
        if (A.source === "—") return 1;
        if (B.source === "—") return -1;
        return A.source.localeCompare(B.source);
      }
      if (A.assignedTo === "—") return 1;
      if (B.assignedTo === "—") return -1;
      return A.assignedTo.localeCompare(B.assignedTo);
    });
  }, [filteredUsers]);

  // Pivot Counts + keep leads per cell for modal
  const { pivot, grandTotal, rowTotal, colTotal, leadsByCell } = useMemo(() => {
    const p = {};
    const cellLeads = {}; // cellLeads[rowKey][status] = [leads...]
    for (const rk of rowKeys) {
      p[rk] = {};
      cellLeads[rk] = {};
    }

    let gTotal = 0;

    for (const u of filteredUsers) {
      const src = (u.source || "—").toString().trim() || "—";
      const asg = (u.Assigned_to || "—").toString().trim() || "—";
      const st = (u.status || "—").toString().trim() || "—";
      const rk = rowKeyOf(src, asg);

      if (!p[rk]) p[rk] = {};
      if (!cellLeads[rk]) cellLeads[rk] = {};
      p[rk][st] = (p[rk][st] || 0) + 1;

      if (!cellLeads[rk][st]) cellLeads[rk][st] = [];
      cellLeads[rk][st].push(u);

      gTotal += 1;
    }

    const rTotal = (rk) => statuses.reduce((sum, st) => sum + (p[rk]?.[st] || 0), 0);
    const cTotal = (st) => rowKeys.reduce((sum, rk) => sum + (p[rk]?.[st] || 0), 0);

    return { pivot: p, grandTotal: gTotal, rowTotal: rTotal, colTotal: cTotal, leadsByCell: cellLeads };
  }, [filteredUsers, rowKeys, statuses]);

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
    link.setAttribute("download", `leads_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${exportData.length} leads`);
  };

  const handleResetFilters = () => {
    setAssignedFilter("All");
    setProjectFilter("All");
    setFromDateFilter("");
    setToDateFilter("");
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalMode("list");
    setModalTitle("");
    setModalLeads([]);
    setSelectedLead(null);
  };

  const openCellModal = (rk, st) => {
    if (!isAdmin) return; // as per your request: admin only

    const { source, assignedTo } = splitRowKey(rk);
    const leads = leadsByCell?.[rk]?.[st] || [];

    setModalTitle(`${source} → ${toTitleCaseSmart(st)} → ${assignedTo}`);
    setModalLeads(leads);
    setModalMode("list");
    setSelectedLead(null);
    setModalOpen(true);
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
        {/* Header */}
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

        {/* Stats */}
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

        {/* Main Content */}
        {!error && (
          <>
            {/* Filters row */}
            <div className="card border-0 shadow-sm rounded-3 mb-3">
              <div className="card-body">
                <div className="d-flex flex-wrap align-items-end gap-3">
                  {/* Project */}
                  <div style={{ minWidth: 260 }}>
                    <label className="form-label fw-semibold mb-1">Project</label>
                    <select
                      className="form-select"
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

                  {/* Date range */}
                  <div>
                    <label className="form-label fw-semibold mb-1">Date</label>
                    <div className="d-flex gap-2 align-items-center">
                      <input
                        type="date"
                        className="form-control"
                        style={{ width: 170 }}
                        value={fromDateFilter}
                        onChange={(e) => setFromDateFilter(e.target.value)}
                        disabled={loading}
                      />
                      <span className="text-muted fw-semibold">to</span>
                      <input
                        type="date"
                        className="form-control"
                        style={{ width: 170 }}
                        value={toDateFilter}
                        onChange={(e) => setToDateFilter(e.target.value)}
                        disabled={loading}
                      />
                    </div>
                  </div>

                  {/* Assigned to (filter) */}
                  <div style={{ minWidth: 260 }}>
                    <label className="form-label fw-semibold mb-1">Assigned to</label>
                    <select
                      className="form-select"
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

                  {/* Reset */}
                  <div className="ms-auto d-flex gap-2">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={handleResetFilters}
                      disabled={
                        loading ||
                        (assignedFilter === "All" &&
                          projectFilter === "All" &&
                          !fromDateFilter &&
                          !toDateFilter)
                      }
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div className="text-muted small mt-2">
                  Pivot contains{" "}
                  <span className="fw-semibold">{rowKeys.length}</span> (Source × Assigned) rows and{" "}
                  <span className="fw-semibold">{statuses.length}</span> statuses.
                  {isAdmin ? (
                    <span className="ms-2">Click any number to view leads.</span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Pivot Table */}
            <div className="card border-0 shadow-sm rounded-3">
              <div className="table-responsive">
                <table
                  className="table table-bordered mb-0 align-middle text-center"
                  id="lead-print-area"
                  style={{ whiteSpace: "nowrap" }}
                >
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: 220, textAlign: "left" }}>Source</th>
                      <th style={{ width: 220, textAlign: "left" }}>Assigned To</th>
                      <th colSpan={statuses.length} className="fw-bold">
                        Status
                      </th>
                      <th style={{ width: 110 }} className="fw-bold">
                        Total
                      </th>
                    </tr>

                    <tr>
                      <th></th>
                      <th></th>
                      {statuses.map((st) => (
                        <th
                          key={st}
                          style={{ minWidth: 140 }}
                          className="fw-semibold"
                          title={toTitleCaseSmart(st)}
                        >
                          {toTitleCaseSmart(st)}
                        </th>
                      ))}
                      <th></th>
                    </tr>
                  </thead>

                  <tbody>
                    {rowKeys.map((rk) => {
                      const { source, assignedTo } = splitRowKey(rk);

                      return (
                        <tr key={rk}>
                          <td className="text-start fw-semibold">{source}</td>
                          <td className="text-start">{assignedTo}</td>

                          {statuses.map((st) => {
                            const val = pivot[rk]?.[st] || 0;

                            // clickable counts for admin
                            if (isAdmin && val > 0) {
                              return (
                                <td key={st}>
                                  <button
                                    type="button"
                                    className="btn btn-link p-0 fw-bold text-decoration-none"
                                    onClick={() => openCellModal(rk, st)}
                                    title="Click to view leads"
                                  >
                                    {String(val).padStart(2, "0")}
                                  </button>
                                </td>
                              );
                            }

                            return (
                              <td key={st} className={val ? "fw-bold" : "text-muted"}>
                                {val ? String(val).padStart(2, "0") : "—"}
                              </td>
                            );
                          })}

                          <td className="fw-bold">
                            {rowTotal(rk) ? String(rowTotal(rk)).padStart(2, "0") : "—"}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Totals row */}
                    <tr className="table-light">
                      <td className="text-start fw-bold">Total</td>
                      <td></td>
                      {statuses.map((st) => (
                        <td key={st} className="fw-bold">
                          {colTotal(st) ? String(colTotal(st)).padStart(2, "0") : "—"}
                        </td>
                      ))}
                      <td className="fw-bold">
                        {grandTotal ? String(grandTotal).padStart(2, "0") : "—"}
                      </td>
                    </tr>

                    {rowKeys.length === 0 && !loading && (
                      <tr>
                        <td colSpan={statuses.length + 3} className="text-muted py-4">
                          No leads found for selected filters.
                        </td>
                      </tr>
                    )}

                    {loading && (
                      <tr>
                        <td colSpan={statuses.length + 3} className="text-center py-4">
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
          </>
        )}
      </div>

      {/* ✅ Modal */}
      {modalOpen && (
        <>
          <div className="modal-backdrop fade show" />
          <div
            className="modal fade show d-block"
            tabIndex="-1"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => {
              // click outside closes
              if (e.target?.classList?.contains("modal")) closeModal();
            }}
          >
            <div className="modal-dialog modal-xl modal-dialog-scrollable" role="document">
              <div className="modal-content">
                <div className="modal-header">
                  <div>
                    <h5 className="modal-title mb-0">{modalTitle}</h5>
                    <div className="small text-muted">
                      {modalMode === "list"
                        ? `Leads: ${modalLeads.length}`
                        : `Lead Details`}
                    </div>
                  </div>

                  <button type="button" className="btn btn-light" onClick={closeModal} title="Close">
                    <X size={18} />
                  </button>
                </div>

                <div className="modal-body">
                  {modalMode === "list" && (
                    <>
                      {modalLeads.length === 0 ? (
                        <div className="text-muted">No leads found.</div>
                      ) : (
                        <div className="table-responsive">
                          <table className="table table-hover align-middle mb-0">
                            <thead className="table-light">
                              <tr>
                                <th style={{ width: "14%" }}>Mobile</th>
                                <th style={{ width: "20%" }}>Name</th>
                                <th style={{ width: "14%" }}>Source</th>
                                <th style={{ width: "14%" }}>Status</th>
                                <th style={{ width: "16%" }}>Project</th>
                                <th style={{ width: "14%" }}>Date &amp; Time</th>
                                <th style={{ width: "8%" }}>Assigned</th>
                              </tr>
                            </thead>
                            <tbody>
                              {modalLeads.map((lead) => (
                                <tr
                                  key={lead._id || lead.lead_id}
                                  style={{ cursor: "pointer" }}
                                  onClick={() => {
                                    setSelectedLead(lead);
                                    setModalMode("detail");
                                  }}
                                >
                                  <td className="fw-semibold text-primary">{lead.mobile || "—"}</td>
                                  <td>
                                    <div className="fw-semibold">{lead.name || "—"}</div>
                                    {lead.job_role ? (
                                      <div className="small text-muted">{lead.job_role}</div>
                                    ) : null}
                                  </td>
                                  <td className="small">{lead.source || "—"}</td>
                                  <td className="small">{toTitleCaseSmart(lead.status || "—")}</td>
                                  <td className="small">{lead.project || "—"}</td>
                                  <td className="small fw-semibold">{formatDateTime(lead.dob)}</td>
                                  <td className="small">{lead.Assigned_to || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div className="small text-muted mt-2">
                        Tip: click a lead row to view full details.
                      </div>
                    </>
                  )}

                  {modalMode === "detail" && selectedLead && (
                    <>
                      <div className="d-flex justify-content-between align-items-center mb-3">
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => {
                            setModalMode("list");
                            setSelectedLead(null);
                          }}
                        >
                          ← Back to list
                        </button>
                      </div>

                      <div className="row g-3">
                        <div className="col-12 col-md-6">
                          <div className="card border-0 shadow-sm">
                            <div className="card-body">
                              <div className="text-muted small mb-1">Lead</div>
                              <div className="fw-bold mb-2" style={{ fontSize: "1.1rem" }}>
                                {selectedLead.name || "—"}
                              </div>

                              <div className="d-flex flex-column gap-1">
                                <div><span className="text-muted">Mobile:</span> <span className="fw-semibold">{selectedLead.mobile || "—"}</span></div>
                                <div><span className="text-muted">Lead ID:</span> <span className="fw-semibold">{selectedLead.lead_id || "—"}</span></div>
                                <div><span className="text-muted">Date &amp; Time:</span> <span className="fw-semibold">{formatDateTime(selectedLead.dob)}</span></div>
                                <div><span className="text-muted">Source:</span> <span className="fw-semibold">{selectedLead.source || "—"}</span></div>
                                <div><span className="text-muted">Status:</span> <span className="fw-semibold">{toTitleCaseSmart(selectedLead.status || "—")}</span></div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="col-12 col-md-6">
                          <div className="card border-0 shadow-sm">
                            <div className="card-body">
                              <div className="text-muted small mb-1">Assignment & Project</div>
                              <div className="d-flex flex-column gap-1">
                                <div><span className="text-muted">Assigned To:</span> <span className="fw-semibold">{selectedLead.Assigned_to || "—"}</span></div>
                                <div><span className="text-muted">Project:</span> <span className="fw-semibold">{selectedLead.project || "—"}</span></div>
                                <div><span className="text-muted">Profession:</span> <span className="fw-semibold">{selectedLead.job_role || "—"}</span></div>
                                <div><span className="text-muted">Budget:</span> <span className="fw-semibold">{selectedLead.budget || "—"}</span></div>
                                <div><span className="text-muted">Verification Call:</span> <span className="fw-semibold">{selectedLead.verification_call ? "Yes" : "No"}</span></div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="col-12">
                          <div className="card border-0 shadow-sm">
                            <div className="card-body">
                              <div className="text-muted small mb-1">Remarks</div>
                              <div style={{ whiteSpace: "pre-wrap" }}>
                                {selectedLead.remarks || "—"}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={closeModal}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <style>
        {`
          .spin { animation: spin 1s linear infinite; }
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

          /* make bootstrap-like modal work even if bootstrap js not present */
          .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 1040; }
          .modal { position: fixed; inset: 0; z-index: 1050; overflow: hidden; }
          .modal-dialog { margin: 1.75rem auto; }

          
        `}
      </style>
    </div>
  );
}

export default UserPage;
