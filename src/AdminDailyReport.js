import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "./api";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const STATUSES = [
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
  "Busy",
  "Closed",
];

const toYYYYMMDD = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const formatDT = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
};

export default function AdminDailyReport() {
  const nav = useNavigate();
  const role = localStorage.getItem("role");

  const [date, setDate] = useState(toYYYYMMDD(new Date()));
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    if (role !== "admin") nav("/");
  }, [role, nav]);

  const fetchReport = async () => {
    try {
      setLoading(true);
      setError("");

      const tzOffsetMinutes = new Date().getTimezoneOffset(); // IST: -330
      const res = await api.get(
        `/reports/daily-status?date=${encodeURIComponent(date)}&tzOffsetMinutes=${tzOffsetMinutes}`
      );
      setRows(res.data?.rows || []);
    } catch (e) {
      console.error(e);
      setError("Failed to load report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (role === "admin") fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, role]);

  const tableData = useMemo(() => {
    return (rows || []).map((r) => {
      const by = r.byStatus || {};
      const obj = {
        User: r.user,
        Added: r.added || 0,
        "Updated Leads": r.updatedUniqueLeads || 0,
        "Total Status Changes": r.totalStatusChanges || 0,
      };

      STATUSES.forEach((s) => {
        obj[s] = by[s] || 0;
      });

      return obj;
    });
  }, [rows]);

  const fetchLeadDetails = async () => {
    const tzOffsetMinutes = new Date().getTimezoneOffset();
    const res = await api.get(
      `/reports/daily-leads?date=${encodeURIComponent(date)}&tzOffsetMinutes=${tzOffsetMinutes}`
    );
    return res.data?.rows || [];
  };

  const downloadPDF = async () => {
    try {
      setPdfLoading(true);

      // 1) fetch lead details
      const leadDetails = await fetchLeadDetails();

      const doc = new jsPDF("l", "pt", "a4"); // landscape
      doc.setFontSize(14);
      doc.text(`Daily Lead Tracking Report — ${date}`, 40, 40);

      // ===== Summary Table (existing)
      const head = [["User", "Added", "Updated Leads", "Total Changes", ...STATUSES]];
      const body = (rows || []).map((r) => {
        const by = r.byStatus || {};
        return [
          r.user,
          r.added || 0,
          r.updatedUniqueLeads || 0,
          r.totalStatusChanges || 0,
          ...STATUSES.map((s) => by[s] || 0),
        ];
      });

      autoTable(doc, {
        startY: 60,
        head,
        body,
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [13, 110, 253] },
      });

      // ===== Lead Details Table (NEW)
      doc.addPage("a4", "l");
      doc.setFontSize(14);
      doc.text(`Lead Details — ${date}`, 40, 40);

      const detailsHead = [
        [
          "User",
          "Action",
          "Changed At",
          "Mobile",
          "Name",
          "Source",
          "Project",
          "From",
          "To",
          "Current Status",
          "Assigned To",
          "Next Call (DOB)",
          "Remarks",
          "Created By",
          "Updated By",
          "Created At",
          "Updated At",
        ],
      ];

      const detailsBody = (leadDetails || []).map((x) => [
        x.user || "unknown",
        x.action || "",
        formatDT(x.changedAt),
        x.mobile || "",
        x.name || "",
        x.source || "",
        x.project || "",
        x.fromStatus || "",
        x.toStatus || "",
        x.status || "",
        x.Assigned_to || "",
        formatDT(x.dob),
        (x.remarks || "").toString(),
        x.createdBy || "",
        x.updatedBy || "",
        formatDT(x.createdAt),
        formatDT(x.updatedAt),
      ]);

      autoTable(doc, {
        startY: 60,
        head: detailsHead,
        body: detailsBody,
        styles: {
          fontSize: 7,
          cellPadding: 2,
          overflow: "linebreak",
          cellWidth: "wrap",
        },
        headStyles: { fillColor: [25, 135, 84] }, // green-ish header
        columnStyles: {
          12: { cellWidth: 220 }, // Remarks column a bit wider
        },
      });

      doc.save(`daily-report-${date}.pdf`);
    } catch (e) {
      console.error(e);
      alert("Failed to generate PDF. Check console.");
    } finally {
      setPdfLoading(false);
    }
  };

  if (role !== "admin") return null;

  return (
    <div className="container-xl py-4" style={{ maxWidth: 1500 }}>
      <div className="card border-0 shadow-sm" style={{ borderRadius: "1.2rem" }}>
        <div className="card-body">
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
            <div>
              <h4 className="mb-1 fw-semibold">Daily Lead Tracking (Admin)</h4>
              <div className="text-muted small">
                Counts are based on <b>status_history</b> → “status changed to X today”.
              </div>
            </div>

            <div className="d-flex gap-2 align-items-center">
              <input
                type="date"
                className="form-control form-control-sm"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <button className="btn btn-sm btn-outline-primary" onClick={fetchReport}>
                Refresh
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={downloadPDF}
                disabled={!rows.length || pdfLoading}
                title="Downloads summary + full lead details"
              >
                {pdfLoading ? "Generating..." : "Download PDF"}
              </button>
            </div>
          </div>

          <hr />

          {loading ? (
            <div className="text-muted small">Loading…</div>
          ) : error ? (
            <div className="text-danger small">{error}</div>
          ) : !rows.length ? (
            <div className="text-muted small">No activity for this date.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm table-hover align-middle">
                <thead className="table-light">
                  <tr className="small text-muted">
                    <th>User</th>
                    <th>Added</th>
                    <th>Updated Leads</th>
                    <th>Total Changes</th>
                    {STATUSES.map((s) => (
                      <th key={s}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((r) => (
                    <tr key={r.User}>
                      <td className="fw-semibold">{r.User}</td>
                      <td className="fw-bold text-primary">{r.Added}</td>
                      <td className="fw-bold">{r["Updated Leads"]}</td>
                      <td className="fw-bold">{r["Total Status Changes"]}</td>
                      {STATUSES.map((s) => (
                        <td key={s}>{r[s]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="text-muted small mt-2">
                PDF includes: <b>Summary counts</b> + <b>Lead Details</b> (Added + Status Change events).
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
