import { useState, useEffect } from "react";
import { PrinterIcon, PencilIcon } from "lucide-react";
import { Formik, Form, Field, ErrorMessage } from "formik";
import * as yup from "yup";
import toast from "react-hot-toast";
import { api } from "./api";

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
    case "follow up":
      return "text-warning fw-semibold small";
    case "details_shared":
    case "details shared":
      return "text-info fw-semibold small";
    case "nr/sf":
    case "rnr":
      return "text-secondary fw-semibold small";
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
];

function formatStatusLabel(status) {
  if (status === "Details_shared") return "Details Shared";
  return status || "";
}

const PROJECT_OPTIONS = ["Northern Lights", "Gruhakalpa", "Nandi Hill View"];

const leadSchema = yup.object({
  lead_id: yup.string().required("Lead Id Required"),
  name: yup.string().required("Name Required").min(2, "Name too short"),
  mobile: yup
    .string()
    .required("Mobile Required")
    .matches(/^\d{10}$/, "Enter 10 digit mobile"),
  source: yup.string().required("Source Required"),
  status: yup.string().required("Status Required"),
  job_role: yup.string().required("Job role Required"),
  budget: yup.string().required("Budget Required"),
  remarks: yup.string().required("Remarks Required"),
  dob: yup.string().required("DOB Required"),
  Assigned_to: yup.string().required("Assigned To Required"),
});

const normalize = (value) =>
  (value || "")
    .toString()
    .trim()
    .toLowerCase();

export function UserPage() {
  const [users, setUsers] = useState([]);
  const [editingLead, setEditingLead] = useState(null);

  const [statusFilter, setStatusFilter] = useState("All");
  const [assignedFilter, setAssignedFilter] = useState("All");
  const [projectFilter, setProjectFilter] = useState("All");
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchLeads = async () => {
      try {
        setLoading(true);
        const res = await api.get("/leads");

        const role = localStorage.getItem("role");
        const username = (localStorage.getItem("username") || "")
          .toString()
          .trim()
          .toLowerCase();

        let data = res.data || [];

        if (role === "user") {
          data = data.filter(
            (lead) =>
              (lead.Assigned_to || "").toString().trim().toLowerCase() ===
              username
          );
        }

        if (isMounted) {
          setUsers(data);
        }
      } catch (err) {
        console.error("Error fetching leads in UserPage", {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data,
        });
        toast.error("Error fetching leads");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchLeads();

    const handleLeadsUpdated = () => {
      fetchLeads();
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
        if (!u.status || statusNorm !== filterNorm) {
          return false;
        }
      }
    }

    if (assignedFilter !== "All") {
      if (
        !u.Assigned_to ||
        normalize(u.Assigned_to) !== normalize(assignedFilter)
      ) {
        return false;
      }
    }

    if (projectFilter !== "All") {
      if (!u.project || normalize(u.project) !== normalize(projectFilter)) {
        return false;
      }
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
    ]);

    const csvLines = [
      headers.map(escapeCSV).join(","),
      ...rows.map((row) => row.map(escapeCSV).join(",")),
    ];

    const csvContent = csvLines.join("\r\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

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
  };

  const handleResetFilters = () => {
    setStatusFilter("All");
    setAssignedFilter("All");
    setProjectFilter("All");
    setFromDateFilter("");
    setToDateFilter("");
  };

  const handleOpenEdit = (lead) => {
    setEditingLead(lead || null);
  };

  return (
    <div
      className="min-vh-100"
      style={{
        backgroundColor: "#f1f3f5",
        padding: "16px",
      }}
    >
      <div
        className="container-fluid"
        style={{ maxWidth: "1600px", margin: "0 auto" }}
      >
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h1
              className="mb-1 fw-bold"
              style={{ fontSize: "2.4rem", color: "#212529" }}
            >
              Leads Overview
            </h1>
            <div className="text-muted small">
              Manage and track all your leads in one place.
            </div>
          </div>
          <button
            className="btn btn-outline-primary d-flex align-items-center"
            onClick={handleExportCSV}
            disabled={loading || filteredUsers.length === 0}
          >
            <PrinterIcon size={16} />
            <span className="ms-2">
              {loading ? "Preparing..." : "Export CSV"}
            </span>
          </button>
        </div>

        <div className="row g-3 mb-3">
          <div className="col-6 col-md-3">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body py-2">
                <div className="text-muted small mb-1">Total Leads</div>
                <div className="fw-bold" style={{ fontSize: "1.3rem" }}>
                  {totalLeads}
                </div>
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body py-2">
                <div className="text-muted small mb-1">Showing</div>
                <div className="fw-bold" style={{ fontSize: "1.3rem" }}>
                  {showingLeads}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card border-0 shadow-sm rounded-3">
          <div
            className="border-bottom bg-light"
            style={{ padding: "10px 16px" }}
          >
            <div className="row g-3 align-items-md-center">
              <div className="col-12 col-md-5">
                <label className="form-label small mb-1 text-muted">
                  Status
                </label>
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
                <label className="form-label small mb-1 text-muted">
                  Assigned To
                </label>
                <select
                  className="form-select form-select-sm"
                  value={assignedFilter}
                  onChange={(e) => setAssignedFilter(e.target.value)}
                >
                  {assignedOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-12 col-md-2">
                <label className="form-label small mb-1 text-muted">
                  Project
                </label>
                <select
                  className="form-select form-select-sm"
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                >
                  {projectOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-12 col-md-2">
                <label className="form-label small mb-1 text-muted">
                  Date Range
                </label>

                <div className="row g-1">
                  <div className="col-12 col-sm-5">
                    <input
                      type="date"
                      className="form-control form-control-sm w-100"
                      value={fromDateFilter}
                      onChange={(e) => setFromDateFilter(e.target.value)}
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
                    statusFilter === "All" &&
                    assignedFilter === "All" &&
                    projectFilter === "All" &&
                    !fromDateFilter &&
                    !toDateFilter
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
                  <th style={{ width: "6%" }} className="text-end">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user._id || user.lead_id}>
                    <td className="fw-semibold text-primary">{user.mobile}</td>
                    <td>
                      <div className="fw-semibold">{user.name}</div>
                      {user.job_role && (
                        <div className="small text-muted">
                          {user.job_role}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="small text-muted">
                        {user.source || "—"}
                      </span>
                    </td>
                    <td>
                      <span className={getStatusTextClass(user.status)}>
                        {user.status
                          ? formatStatusLabel(user.status)
                          : "—"}
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
                      <div className="small fw-semibold">
                        {formatDateTime(user.dob)}
                      </div>
                    </td>
                    <td>
                      <span className="small text-dark">
                        {user.Assigned_to || "—"}
                      </span>
                    </td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center"
                        data-bs-toggle="modal"
                        data-bs-target="#editLeadModal"
                        onClick={() => handleOpenEdit(user)}
                      >
                        <PencilIcon size={14} className="me-1" />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}

                {filteredUsers.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} className="text-center text-muted py-4">
                      No leads found for selected filters.
                    </td>
                  </tr>
                )}

                {loading && (
                  <tr>
                    <td colSpan={8} className="text-center py-4">
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

        <div
          className="modal fade"
          id="editLeadModal"
          tabIndex="-1"
          aria-labelledby="editLeadModalLabel"
          aria-hidden="true"
        >
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content shadow-sm border-0 rounded-3">
              <div className="modal-header bg-light border-bottom">
                <div>
                  <h5
                    className="modal-title fw-semibold"
                    id="editLeadModalLabel"
                  >
                    Edit Lead
                  </h5>
                  <small className="text-muted">
                    Update lead details and save changes.
                  </small>
                </div>
                <button
                  type="button"
                  className="btn-close"
                  data-bs-dismiss="modal"
                  aria-label="Close"
                ></button>
              </div>

              <div className="modal-body bg-white">
                {editingLead ? (
                  <Formik
                    enableReinitialize
                    initialValues={{
                      lead_id: editingLead.lead_id || "",
                      name: editingLead.name || "",
                      mobile: editingLead.mobile || "",
                      source: editingLead.source || "",
                      status: editingLead.status || "",
                      job_role: editingLead.job_role || "",
                      budget: editingLead.budget || "",
                      remarks: editingLead.remarks || "",
                      dob: editingLead.dob
                        ? new Date(editingLead.dob).toISOString().slice(0, 10)
                        : "",
                      Assigned_to: editingLead.Assigned_to || "",
                    }}
                    validationSchema={leadSchema}
                    onSubmit={async (values, { setSubmitting }) => {
                      try {
                        await api.put(`/edit-lead/${values.lead_id}`, values);
                        toast.success("Lead updated successfully");

                        window.dispatchEvent(new Event("leads-updated"));

                        const modalEl =
                          document.getElementById("editLeadModal");
                        if (modalEl && window.bootstrap) {
                          const modalInstance =
                            window.bootstrap.Modal.getInstance(modalEl);
                          modalInstance && modalInstance.hide();
                        }
                      } catch (err) {
                        console.error("Error updating lead", {
                          message: err.message,
                          status: err.response?.status,
                          data: err.response?.data,
                        });
                        toast.error("Failed to update lead");
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                  >
                    {({ isSubmitting }) => (
                      <Form>
                        <div className="row g-3">
                          <div className="col-md-4">
                            <label className="form-label small fw-semibold">
                              Lead ID
                            </label>
                            <Field
                              type="text"
                              name="lead_id"
                              className="form-control form-control-sm"
                              disabled
                            />
                            <ErrorMessage
                              name="lead_id"
                              component="div"
                              className="small text-danger mt-1"
                            />
                          </div>

                          <div className="col-md-8">
                            <label className="form-label small fw-semibold">
                              Name
                            </label>
                            <Field
                              type="text"
                              name="name"
                              className="form-control form-control-sm"
                            />
                            <ErrorMessage
                              name="name"
                              component="div"
                              className="small text-danger mt-1"
                            />
                          </div>

                          <div className="col-md-6">
                            <label className="form-label small fw-semibold">
                              Mobile
                            </label>
                            <Field
                              type="text"
                              name="mobile"
                              className="form-control form-control-sm"
                            />
                            <ErrorMessage
                              name="mobile"
                              component="div"
                              className="small text-danger mt-1"
                            />
                          </div>

                          <div className="col-md-6">
                            <label className="form-label small fw-semibold">
                              Source of Lead
                            </label>
                            <Field
                              as="select"
                              name="source"
                              className="form-select form-select-sm"
                            >
                              <option disabled value="">
                                Select source
                              </option>
                              <option value="Meta Ads Leads">
                                Meta Ads Leads
                              </option>
                              <option value="Google Ads Leads">
                                Google Ads Leads
                              </option>
                              <option value="News Paper">News Paper</option>
                              <option value="Walk-in">Walk-in</option>
                              <option value="Referral">Referral</option>
                              <option value="Other">Other</option>
                            </Field>
                            <ErrorMessage
                              name="source"
                              component="div"
                              className="small text-danger mt-1"
                            />
                          </div>

                          <div className="col-md-6">
                            <label className="form-label small fw-semibold">
                              Status
                            </label>
                            <Field
                              as="select"
                              name="status"
                              className="form-select form-select-sm"
                            >
                              <option disabled value="">
                                Select status
                              </option>
                              <option value="Details_shared">
                                Details_shared
                              </option>
                              <option value="NR/SF">NR/SF</option>
                              <option value="Follow Up">Follow Up</option>
                              <option value="RNR">RNR</option>
                              <option value="Site Visited">Site Visited</option>
                              <option value="Booked">Booked</option>
                              <option value="Invalid">Invalid</option>
                              <option value="Not Interested">
                                Not Interested
                              </option>
                            </Field>
                            <ErrorMessage
                              name="status"
                              component="div"
                              className="small text-danger mt-1"
                            />
                          </div>

                          <div className="col-md-6">
                            <label className="form-label small fw-semibold">
                              Work Profession
                            </label>
                            <Field
                              type="text"
                              name="job_role"
                              className="form-control form-control-sm"
                            />
                            <ErrorMessage
                              name="job_role"
                              component="div"
                              className="small text-danger mt-1"
                            />
                          </div>

                          <div className="col-md-6">
                            <label className="form-label small fw-semibold">
                              Budget
                            </label>
                            <Field
                              type="text"
                              name="budget"
                              className="form-control form-control-sm"
                            />
                            <ErrorMessage
                              name="budget"
                              component="div"
                              className="small text-danger mt-1"
                            />
                          </div>

                          <div className="col-md-6">
                            <label className="form-label small fw-semibold">
                              Date of Birth
                            </label>
                            <Field
                              type="date"
                              name="dob"
                              className="form-control form-control-sm"
                            />
                            <ErrorMessage
                              name="dob"
                              component="div"
                              className="small text-danger mt-1"
                            />
                          </div>

                          <div className="col-md-6">
                            <label className="form-label small fw-semibold">
                              Assigned To
                            </label>
                            <Field
                              type="text"
                              name="Assigned_to"
                              className="form-control form-control-sm"
                            />
                            <ErrorMessage
                              name="Assigned_to"
                              component="div"
                              className="small text-danger mt-1"
                            />
                          </div>

                          <div className="col-12">
                            <label className="form-label small fw-semibold">
                              Remarks
                            </label>
                            <Field
                              as="textarea"
                              name="remarks"
                              rows="2"
                              className="form-control form-control-sm"
                            />
                            <ErrorMessage
                              name="remarks"
                              component="div"
                              className="small text-danger mt-1"
                            />
                          </div>
                        </div>

                        <div className="mt-4 d-flex justify-content-end gap-2">
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            data-bs-dismiss="modal"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="btn btn-primary btn-sm px-4"
                            disabled={isSubmitting}
                          >
                            {isSubmitting ? "Updating..." : "Update Lead"}
                          </button>
                        </div>
                      </Form>
                    )}
                  </Formik>
                ) : (
                  <div className="text-center text-muted small">
                    No lead selected.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
export default UserPage;
