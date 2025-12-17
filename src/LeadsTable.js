import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CircleXIcon } from "lucide-react";
import { api } from "./api";

const TRACKED_STATUSES = [
  "Visit Scheduled",
  "NR/SF",
  "RNR",
  "Details_shared",
  "Site Visited",
  "Booked",
  "Location Issue",
  "CP",
  "Budget Issue",
  "Visit Postponed",
  "Busy",
];

const AUTO_24H_STATUSES = ["NR/SF", "RNR", "Details_shared", "Site Visited", "Busy"];

const HARD_LOCK_STATUSES = ["NR/SF", "RNR", "Busy"];

const SOURCE_OPTIONS = [
  "Google Ads",
  "Meta Ads",
  "WhatsApp",
  "Facebook",
  "Instagram",
  "Website",
  "Walk-in",
  "Referral",
  "99acres",
];

const PROJECT_OPTIONS = ["Northern Lights", "Gruhakalpa", "Nandi Hill View"];

const normalizeAndValidateMobile = (raw) => {
  if (!raw) {
    return { ok: false, error: "Mobile number is required", normalized: "" };
  }

  let digits = raw.toString().replace(/\D/g, "");

  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (digits.length !== 10) {
    return {
      ok: false,
      error: "Mobile must be 10 digits after removing country/0 prefix",
      normalized: digits,
    };
  }

  if (!/^[6-9]\d{9}$/.test(digits)) {
    return {
      ok: false,
      error: "Enter a valid mobile number starting with 6-9",
      normalized: digits,
    };
  }

  return { ok: true, error: null, normalized: digits };
};

const toLocalInputValue = (date) => {
  const pad = (n) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const mins = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${mins}`;
};

// NEW: tomorrow at 09:00 AM local time
const getTomorrow9AMForInput = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1); // tomorrow
  d.setHours(9, 0, 0, 0); // 09:00:00.000
  return toLocalInputValue(d);
};

const normalizeDobFromBackend = (dob) => {
  if (!dob) return "";
  if (typeof dob === "string" && dob.includes("T") && dob.length >= 16) {
    return dob.slice(0, 16);
  }
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "";
  return toLocalInputValue(d);
};

export function LeadsTable() {
  const role = localStorage.getItem("role");
  const rawUsername = (localStorage.getItem("username") || "").toString().trim();
  const usernameKey = rawUsername.toLowerCase();

  const LAST_INDEX_KEY = `crm_last_lead_index_${usernameKey || "guest"}`;

  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const [savedStates, setSavedStates] = useState({});

  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);

  const [newLead, setNewLead] = useState({
    name: "",
    mobile: "",
    source: "",
    status: "",
    job_role: "",
    budget: "",
    project: "",
    remarks: "",
    dob: "",
    Assigned_to: rawUsername || "",
  });

  const [currentIndex, setCurrentIndex] = useState(0);

  const projectOptions = PROJECT_OPTIONS;

  const getAssignedToValue = (assigned) => {
    if (assigned && assigned.toString().trim() !== "") return assigned;
    return rawUsername || "";
  };

  useEffect(() => {
    async function fetchLeads() {
      try {
        setLoading(true);
        const res = await api.get("/leads");
        let data = res.data || [];

        const sorted = [...data].sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        });

        const normalized = sorted.map((lead) => {
          let status = lead.status;
          if (status === "Follow Up" || status === "Follow-up") {
            status = "Visit Scheduled";
          }
          return {
            ...lead,
            status,
            dob: normalizeDobFromBackend(lead.dob),
          };
        });

        setLeads(normalized);

        const initialSaved = {};
        normalized.forEach((lead) => {
          if (lead.lead_id != null) {
            initialSaved[lead.lead_id] = true;
          }
        });
        setSavedStates(initialSaved);

        setCurrentIndex(0);
        localStorage.setItem(LAST_INDEX_KEY, "0");
      } catch (err) {
        console.error("Error fetching leads", {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data,
        });
        toast.error("Failed to load leads");
      } finally {
        setLoading(false);
      }
    }

    fetchLeads();
  }, [role, usernameKey, LAST_INDEX_KEY]);

  useEffect(() => {
    if (leads.length > 0) {
      localStorage.setItem(LAST_INDEX_KEY, String(currentIndex));
    }
  }, [currentIndex, leads.length, LAST_INDEX_KEY]);

  const handleFieldChange = (lead_id, field, value) => {
    setLeads((prev) =>
      prev.map((lead) => {
        if (lead.lead_id !== lead_id) return lead;

        const updated = { ...lead };

        if (field === "status") {
          updated.status = value;

          if (value === "NR/SF" || value === "RNR" || value === "Busy") {
            // auto-set to tomorrow 09:00 AM
            updated.dob = getTomorrow9AMForInput();
          } else if (value === "Visit Scheduled" || value === "Details_shared" || 
                     value === "Location Issue" || value === "CP" || 
                     value === "Budget Issue" || value === "Visit Postponed") {
            updated.dob = "";
          }
        } else if (field === "dob") {
          if (HARD_LOCK_STATUSES.includes(lead.status)) {
            return lead;
          }
          updated.dob = value || "";
        } else if (field === "Assigned_to") {
          // read-only, ignore
          return lead;
        } else {
          updated[field] = value;
        }

        return updated;
      })
    );

    setSavedStates((prev) => ({
      ...prev,
      [lead_id]: false,
    }));
  };

  const handleSave = async (lead, moveNext = true) => {
    if (!lead) return;
    setSavingId(lead.lead_id);

    let statusToSave = lead.status;
    let dobToSave = lead.dob;

    if (!statusToSave || statusToSave === "") {
      statusToSave = "Not Reachable";

      setLeads((prev) =>
        prev.map((l) =>
          l.lead_id === lead.lead_id ? { ...l, status: statusToSave } : l
        )
      );
    }

    if (
      statusToSave === "Visit Scheduled" &&
      (!dobToSave || dobToSave === "")
    ) {
      toast.error("Please select visit date & time before saving.");
      setSavingId(null);
      return;
    }

    // If status is in AUTO_24H_STATUSES and dob is empty,
    // set to tomorrow 09:00 AM
    if (
      AUTO_24H_STATUSES.includes(statusToSave) &&
      (!dobToSave || dobToSave === "")
    ) {
      dobToSave = getTomorrow9AMForInput();
    }

    const assignedToFinal = getAssignedToValue(lead.Assigned_to);

    try {
      const res = await api.put(`/edit-lead/${lead.lead_id}`, {
        name: lead.name || null,
        source: lead.source || null,
        status: statusToSave || null,
        job_role: lead.job_role || null,
        budget: lead.budget || null,
        project: lead.project || null,
        remarks: lead.remarks || null,
        dob: dobToSave || null,
        Assigned_to: assignedToFinal || null,
      });

      // Check if lead was transferred
      if (res?.data?.transferredTo) {
        toast.success(
          `Lead transferred to ${res.data.transferredTo} (Verification Call)`,
          { duration: 3500, position: "top-right" }
        );
      }

      if (TRACKED_STATUSES.includes(statusToSave)) {
        const followUpDate = dobToSave || getTomorrow9AMForInput();

        await api.post("/add-follow_up", {
          followup_id: lead.lead_id,
          date: followUpDate,
          name: lead.name || null,
          mobile: lead.mobile,
          source: lead.source || "",
          status: statusToSave || null,
          job_role: lead.job_role || null,
          budget: lead.budget || null,
          project: lead.project || null,
          remarks: lead.remarks || null,
        });
      }

      setLeads((prev) =>
        prev.map((l) =>
          l.lead_id === lead.lead_id
            ? {
                ...l,
                status: statusToSave,
                dob: dobToSave,
                Assigned_to: assignedToFinal,
                verification_call: res?.data?.transferredTo ? true : l.verification_call,
              }
            : l
        )
      );

      setSavedStates((prev) => ({
        ...prev,
        [lead.lead_id]: true,
      }));

      window.dispatchEvent(new Event("leads-updated"));
      toast.success("Lead updated successfully");

      if (moveNext && leads.length > 1) {
        setCurrentIndex((prev) =>
          prev < leads.length - 1 ? prev + 1 : prev
        );
      }
    } catch (err) {
      console.error("Error saving lead", {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });
      toast.error("Failed to save lead");
    } finally {
      setSavingId(null);
    }
  };

  const openAddLeadModal = () => {
    setNewLead({
      name: "",
      mobile: "",
      source: "",
      status: "",
      job_role: "",
      budget: "",
      project: "",
      remarks: "",
      dob: "",
      Assigned_to: rawUsername || "",
    });
    setShowAddModal(true);
  };

  const closeAddLeadModal = () => {
    setShowAddModal(false);
  };

  const openBulkModal = () => {
    setShowBulkModal(true);
  };

  const closeBulkModal = () => {
    setShowBulkModal(false);
  };

  const handleNewLeadChange = (field, value) => {
    setNewLead((prev) => {
      const updated = { ...prev };

      if (field === "status") {
        updated.status = value;

        if (value === "NR/SF" || value === "RNR" || value === "Busy") {
          // auto-set to tomorrow 09:00 AM
          updated.dob = getTomorrow9AMForInput();
        } else if (value === "Visit Scheduled" || value === "Details_shared" || 
                   value === "Location Issue" || value === "CP" || 
                   value === "Budget Issue" || value === "Visit Postponed") {
          updated.dob = "";
        }
      } else if (field === "dob") {
        if (HARD_LOCK_STATUSES.includes(prev.status)) {
          return prev;
        }
        updated.dob = value || "";
      } else if (field === "Assigned_to") {
        // read-only, ignore changes
        return prev;
      } else {
        updated[field] = value;
      }

      return updated;
    });
  };

  const handleBulkLeadsAdded = (newLeadsArray) => {
    if (!newLeadsArray || newLeadsArray.length === 0) return;

    setLeads((prev) => {
      const merged = [...newLeadsArray, ...prev];

      // keep same sort order as initial fetch: newest createdAt first
      const sorted = [...merged].sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      });

      return sorted;
    });

    setSavedStates((prev) => {
      const updated = { ...prev };
      newLeadsArray.forEach((lead) => {
        if (lead.lead_id != null) {
          updated[lead.lead_id] = true;
        }
      });
      return updated;
    });

    setCurrentIndex(0);
    localStorage.setItem(LAST_INDEX_KEY, "0");

    window.dispatchEvent(new Event("leads-updated"));
  };

  const handleAddLeadSubmit = async (e) => {
    e.preventDefault();

    const { ok, error, normalized } = normalizeAndValidateMobile(
      newLead.mobile
    );
    if (!ok) {
      toast.error(error);
      return;
    }

    const trimmedMobile = normalized;
    const existingLocal = leads.find(
      (l) => (l.mobile || "").toString().trim() === trimmedMobile
    );
    if (existingLocal) {
      toast.error(
        `This mobile already exists for lead ${
          existingLocal.name || existingLocal.lead_id
        }`
      );
      return;
    }

    try {
      let statusToSave = newLead.status || "";
      let dobToSave = newLead.dob || "";

      if (
        statusToSave === "Visit Scheduled" &&
        (!dobToSave || dobToSave === "")
      ) {
        toast.error("Please select visit date & time before saving lead.");
        return;
      }

      if (
        AUTO_24H_STATUSES.includes(statusToSave) &&
        (!dobToSave || dobToSave === "")
      ) {
        dobToSave = getTomorrow9AMForInput();
      }

      const assignedToFinal = getAssignedToValue(newLead.Assigned_to);

      const res = await api.post("/add-lead", {
        name: newLead.name || null,
        mobile: trimmedMobile,
        source: newLead.source || null,
        status: statusToSave || null,
        job_role: newLead.job_role || null,
        budget: newLead.budget || null,
        project: newLead.project || null,
        remarks: newLead.remarks || null,
        dob: dobToSave || null,
        Assigned_to: assignedToFinal || null,
      });

      const createdFromServer = res.data;

      const normalizedLead = {
        ...createdFromServer,
        status:
          createdFromServer.status === "Follow Up" ||
          createdFromServer.status === "Follow-up"
            ? "Visit Scheduled"
            : createdFromServer.status,
        dob: normalizeDobFromBackend(createdFromServer.dob),
      };

      setLeads((prev) => [normalizedLead, ...prev]);

      setSavedStates((prev) => ({
        ...prev,
        [normalizedLead.lead_id]: true,
      }));

      setCurrentIndex(0);
      localStorage.setItem(LAST_INDEX_KEY, "0");

      window.dispatchEvent(new Event("leads-updated"));

      toast.success("Lead added successfully");
      setShowAddModal(false);
    } catch (err) {
      console.error("Error adding lead", {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data,
      });

      if (err.response?.status === 409) {
        toast.error("Lead with this mobile number already exists");
      } else {
        toast.error("Failed to add lead");
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!leads.length) {
    return (
      <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-10">
        <datalist id="lead-source-options">
          {SOURCE_OPTIONS.map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>

        <div className="max-w-5xl mx-auto">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-2xl sm:text-3xl font-semibold text-slate-800 mb-2 flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-500 text-base">
                  📞
                </span>
                Lead Call Tracking
              </h3>
              <p className="text-sm text-slate-500">
                View, update and follow up your real estate leads in one place.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={openBulkModal}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 hover:shadow-md transition"
              >
                <span className="text-lg leading-none">⬆</span>
                <span>Bulk Upload</span>
              </button>
              <button
                type="button"
                onClick={openAddLeadModal}
                className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 hover:shadow-md transition"
              >
                <span className="text-lg leading-none">＋</span>
                <span>Add Lead</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-center h-64 text-gray-500 text-lg">
            No leads found.
          </div>
        </div>

        {showAddModal && (
          <AddLeadModal
            newLead={newLead}
            projectOptions={projectOptions}
            getAssignedToValue={getAssignedToValue}
            closeAddLeadModal={closeAddLeadModal}
            handleAddLeadSubmit={handleAddLeadSubmit}
            handleNewLeadChange={handleNewLeadChange}
          />
        )}

        {showBulkModal && (
          <BulkLeadUpload
            existingLeads={leads}
            onClose={closeBulkModal}
            onLeadsAdded={handleBulkLeadsAdded}
          />
        )}
      </div>
    );
  }

  let safeIndex = currentIndex;
  if (safeIndex < 0) safeIndex = 0;
  if (safeIndex > leads.length - 1) safeIndex = leads.length - 1;

  const currentLead = leads[safeIndex];
  const hasPrev = safeIndex > 0;
  const hasNext = safeIndex < leads.length - 1;

  if (!currentLead) {
    return (
      <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-10">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-sm text-slate-500">
            No current lead to display. Please reload the page.
          </p>
        </div>
      </div>
    );
  }

  const requiresVisitDate = currentLead.status === "Visit Scheduled";
  const hasDob = !!currentLead.dob;
  const hasStatus = !!(currentLead.status && currentLead.status !== "");

  const saveEnabled =
    hasStatus &&
    (!requiresVisitDate || hasDob) &&
    savingId !== currentLead.lead_id;

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4 sm:px-6 lg:px-10">
      <datalist id="lead-source-options">
        {SOURCE_OPTIONS.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>

      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-2xl sm:text-3xl font-semibold text-slate-800 mb-2 flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-500 text-base">
                📞
              </span>
              Lead Call Tracking
            </h3>
            <p className="text-sm text-slate-500">
              Work on one lead at a time. Save and automatically jump to the
              next.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openBulkModal}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 hover:shadow-md transition"
            >
              <span className="text-lg leading-none">⬆</span>
              <span>Bulk Upload</span>
            </button>
            <button
              type="button"
              onClick={openAddLeadModal}
              className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 hover:shadow-md transition"
            >
              <span className="text-lg leading-none">＋</span>
              <span>Add Lead</span>
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Total Leads:{" "}
              <span className="font-semibold text-blue-600">
                {leads.length}
              </span>
            </span>
            <span>
              Current:{" "}
              <span className="font-semibold text-emerald-600">
                {safeIndex + 1} / {leads.length}
              </span>
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-slate-50 to-slate-100">
            <div>
              <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-blue-500 text-xs">
                  {safeIndex + 1}
                </span>
                Lead Details
              </h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Lead ID:{" "}
                <span className="font-mono text-slate-700">
                  {currentLead.lead_id}
                </span>
                {currentLead.verification_call && (
                  <span className="ml-2 inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-orange-500"></span>
                    <span className="text-xs font-medium text-orange-600">Verification Call</span>
                  </span>
                )}
              </p>
            </div>
            <div className="text-right text-[11px] text-slate-500">
              <div>
                Saved:{" "}
                <span
                  className={
                    savedStates[currentLead.lead_id]
                      ? "text-emerald-600 font-semibold"
                      : "text-amber-600 font-semibold"
                  }
                >
                  {savedStates[currentLead.lead_id] ? "Yes" : "Pending"}
                </span>
              </div>
            </div>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Mobile</label>
                <input
                  type="text"
                  readOnly
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
                  value={currentLead.mobile || ""}
                />
                {currentLead.source && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Source:{" "}
                    <span className="font-medium text-slate-700">
                      {currentLead.source}
                    </span>
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-500">Name</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-blue-500"
                  value={currentLead.name || ""}
                  onChange={(e) =>
                    handleFieldChange(
                      currentLead.lead_id,
                      "name",
                      e.target.value
                    )
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Status</label>
                <select
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400/80 focus:border-amber-400"
                  value={currentLead.status || ""}
                  onChange={(e) =>
                    handleFieldChange(
                      currentLead.lead_id,
                      "status",
                      e.target.value
                    )
                  }
                >
                  <option disabled value="">
                    Select status
                  </option>
                  <option value="Details_shared">Details_shared</option>
                  <option value="NR/SF">NR/SF</option>
                  <option value="Visit Scheduled">Visit Scheduled</option>
                  <option value="RNR">RNR</option>
                  <option value="Site Visited">Site Visited</option>
                  <option value="Booked">Booked</option>
                  <option value="Invalid">Invalid</option>
                  <option value="Not Interested">Not Interested</option>
                  <option value="Location Issue">Location Issue</option>
                  <option value="CP">CP</option>
                  <option value="Budget Issue">Budget Issue</option>
                  <option value="Visit Postponed">Visit Postponed</option>
                  <option value="Closed">Closed</option>
                  <option value="Busy">Busy</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-500">
                  Call / Visit Date &amp; Time
                </label>
                <input
                  type="datetime-local"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-400/80 focus:border-emerald-400"
                  value={currentLead.dob || ""}
                  onChange={(e) =>
                    handleFieldChange(
                      currentLead.lead_id,
                      "dob",
                      e.target.value
                    )
                  }
                  disabled={HARD_LOCK_STATUSES.includes(currentLead.status)}
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  {currentLead.status === "NR/SF" ||
                  currentLead.status === "RNR" ||
                  currentLead.status === "Busy"
                    ? "Date is auto-set to tomorrow 09:00 AM and locked."
                    : "For Visit Scheduled, please select exact date & time. For other follow-up statuses, leaving this empty will auto-set to tomorrow 09:00 AM on save."}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Job Role</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-blue-500"
                  value={currentLead.job_role || ""}
                  onChange={(e) =>
                    handleFieldChange(
                      currentLead.lead_id,
                      "job_role",
                      e.target.value
                    )
                  }
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-500">Budget</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-blue-500"
                  value={currentLead.budget || ""}
                  onChange={(e) =>
                    handleFieldChange(
                      currentLead.lead_id,
                      "budget",
                      e.target.value
                    )
                  }
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-500">Source</label>
                <input
                  type="text"
                  list="lead-source-options"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-blue-500"
                  value={currentLead.source || ""}
                  onChange={(e) =>
                    handleFieldChange(
                      currentLead.lead_id,
                      "source",
                      e.target.value
                    )
                  }
                  placeholder="Select or type source"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-500">Project</label>
                <select
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-blue-500"
                  value={currentLead.project || ""}
                  onChange={(e) =>
                    handleFieldChange(
                      currentLead.lead_id,
                      "project",
                      e.target.value
                    )
                  }
                >
                  <option value="">Select project</option>
                  {projectOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-500">Assigned To</label>
                <input
                  type="text"
                  readOnly
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-800"
                  value={getAssignedToValue(currentLead.Assigned_to)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-500">
                Remarks / Notes
              </label>
              <textarea
                rows={3}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-blue-500"
                value={currentLead.remarks || ""}
                onChange={(e) =>
                  handleFieldChange(
                    currentLead.lead_id,
                    "remarks",
                    e.target.value
                  )
                }
                placeholder="Add remarks about this lead..."
              />
            </div>
          </div>

          <div className="px-5 py-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50 rounded-b-2xl">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${
                  hasPrev
                    ? "border-slate-300 text-slate-700 hover:bg-slate-100"
                    : "border-slate-200 text-slate-400 cursor-not-allowed"
                }`}
                disabled={!hasPrev}
                onClick={() => {
                  if (hasPrev) setCurrentIndex((prev) => prev - 1);
                }}
              >
                ← Previous
              </button>

              {saveEnabled && hasNext && (
                <button
                  type="button"
                  className="rounded-full px-3 py-1.5 text-xs font-medium border border-slate-300 text-slate-700 hover:bg-slate-100 transition"
                  onClick={() => {
                    if (hasNext) setCurrentIndex((prev) => prev + 1);
                  }}
                >
                  Next →
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              {!hasStatus ? (
                <span className="text-[11px] text-slate-400">
                  Select call status to enable Save
                </span>
              ) : requiresVisitDate && !hasDob ? (
                <span className="text-[11px] text-amber-600">
                  Select visit date &amp; time to enable Save
                </span>
              ) : null}

              <button
                type="button"
                className={`inline-flex items-center justify-center rounded-full px-4 py-1.5 text-xs font-semibold shadow-sm transition ${
                  !saveEnabled
                    ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                    : "bg-emerald-500 text-white hover:bg-emerald-400 hover:shadow-md"
                }`}
                disabled={!saveEnabled}
                onClick={() => handleSave(currentLead, true)}
              >
                {savingId === currentLead.lead_id
                  ? "Saving..."
                 : hasNext
                  ? "Save & Next"
                  : "Save"}
              </button>
            </div>
          </div>
        </div>

        {showAddModal && (
          <AddLeadModal
            newLead={newLead}
            projectOptions={projectOptions}
            getAssignedToValue={getAssignedToValue}
            closeAddLeadModal={closeAddLeadModal}
            handleAddLeadSubmit={handleAddLeadSubmit}
            handleNewLeadChange={handleNewLeadChange}
          />
        )}

        {showBulkModal && (
          <BulkLeadUpload
            existingLeads={leads}
            onClose={closeBulkModal}
            onLeadsAdded={handleBulkLeadsAdded}
          />
        )}
      </div>
    </div>
  );
}

function AddLeadModal({
  newLead,
  projectOptions,
  getAssignedToValue,
  closeAddLeadModal,
  handleAddLeadSubmit,
  handleNewLeadChange,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="relative w-full max-w-xl mx-4 rounded-2xl bg-white border border-slate-200 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h5 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-blue-500 text-sm">
              ➕
            </span>
            Add New Lead
          </h5>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 text-xl leading-none"
            onClick={closeAddLeadModal}
          >
            <CircleXIcon />
          </button>
        </div>

        <form onSubmit={handleAddLeadSubmit} className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <label className="text-slate-500 text-xs">Name</label>
              <input
                type="text"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-blue-500"
                value={newLead.name}
                onChange={(e) => handleNewLeadChange("name", e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-500 text-xs">
                Mobile <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-blue-500"
                value={newLead.mobile}
                onChange={(e) => handleNewLeadChange("mobile", e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-500 text-xs">Source</label>
              <input
                type="text"
                list="lead-source-options"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-blue-500"
                value={newLead.source}
                onChange={(e) => handleNewLeadChange("source", e.target.value)}
                placeholder="Select or type source"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-500 text-xs">Status</label>
              <select
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400/80 focus:border-amber-400"
                value={newLead.status}
                onChange={(e) => handleNewLeadChange("status", e.target.value)}
              >
                <option value="">Select status</option>
                <option value="Details_shared">Details_shared</option>
                <option value="NR/SF">NR/SF</option>
                <option value="Visit Scheduled">Visit Scheduled</option>
                <option value="RNR">RNR</option>
                <option value="Site Visited">Site Visited</option>
                <option value="Booked">Booked</option>
                <option value="Invalid">Invalid</option>
                <option value="Not Interested">Not Interested</option>
                <option value="Location Issue">Location Issue</option>
                <option value="CP">CP</option>
                <option value="Budget Issue">Budget Issue</option>
                <option value="Visit Postponed">Visit Postponed</option>
                <option value="Closed">Closed</option>
                <option value="Busy">Busy</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-slate-500 text-xs">Job Role</label>
              <input
                type="text"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-blue-500"
                value={newLead.job_role}
                onChange={(e) =>
                  handleNewLeadChange("job_role", e.target.value)
                }
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-500 text-xs">Budget</label>
              <input
                type="text"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-blue-500"
                value={newLead.budget}
                onChange={(e) =>
                  handleNewLeadChange("budget", e.target.value)
                }
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-500 text-xs">Project</label>
              <select
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-blue-500"
                value={newLead.project}
                onChange={(e) => handleNewLeadChange("project", e.target.value)}
                required
              >
                <option value="">Select project</option>
                {projectOptions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-slate-500 text-xs">Assigned To</label>
              <input
                type="text"
                readOnly
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-800"
                value={getAssignedToValue(newLead.Assigned_to)}
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Auto-filled from your login and cannot be changed.
              </p>
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="text-slate-500 text-xs">
                Call Date &amp; Time
              </label>
              <input
                type="datetime-local"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-400/80 focus:border-emerald-400"
                value={newLead.dob || ""}
                onChange={(e) => handleNewLeadChange("dob", e.target.value)}
                disabled={HARD_LOCK_STATUSES.includes(newLead.status)}
              />
              <p className="text-[11px] text-slate-500 mt-1">
                For NR/SF, RNR or Busy, the date will be auto-set to tomorrow 09:00 AM
                and locked if left empty. For Visit Scheduled, please select
                exact date &amp; time.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-700">
              Remarks / Notes
            </label>
            <textarea
              rows={3}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/80 focus:border-blue-500"
              value={newLead.remarks}
              onChange={(e) =>
                handleNewLeadChange("remarks", e.target.value)
              }
              placeholder="Add remarks about this lead..."
            />
          </div>

          <div className="px-1 py-3 border-t border-slate-200 flex items-center justify-end gap-3 bg-slate-50 rounded-b-2xl">
            <button
              type="button"
              className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 hover:bg-slate-100 transition"
              onClick={closeAddLeadModal}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-full px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-sm hover:shadow-md transition"
            >
              Save Lead
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BulkLeadUpload({ existingLeads, onClose, onLeadsAdded }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [parseErrors, setParseErrors] = useState([]);
  const [uploading, setUploading] = useState(false);

  const existingMobiles = new Set(
    (existingLeads || []).map((l) => (l.mobile || "").toString().trim())
  );

  const expectedHeaders = [
    "name",
    "mobile",
    "source",
    "status",
    "job_role",
    "budget",
    "project",
    "remarks",
    "dob",
  ];

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setRows([]);
    setParseErrors([]);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text !== "string") {
        setParseErrors(["Could not read file content."]);
        return;
      }

      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (lines.length < 2) {
        setParseErrors(["File has no data rows."]);
        return;
      }

      const headerLine = lines[0];
      const headers = headerLine
        .split(",")
        .map((h) => h.trim().toLowerCase());

      const missing = expectedHeaders.filter((h) => !headers.includes(h));
      if (missing.length > 0) {
        setParseErrors([
          `Missing required columns: ${missing.join(
            ", "
          )}. Expected header: ${expectedHeaders.join(",")}`,
        ]);
        return;
      }

      const headerIndexMap = {};
      headers.forEach((h, idx) => {
        headerIndexMap[h] = idx;
      });

      const dataRows = [];
      const localErrors = [];

      lines.slice(1).forEach((line, idx) => {
        if (!line.trim()) return;
        const cols = line.split(",");
        const row = {};

        expectedHeaders.forEach((h) => {
          const colIdx = headerIndexMap[h];
          row[h] = cols[colIdx] !== undefined ? cols[colIdx].trim() : "";
        });

        const { ok, error, normalized } = normalizeAndValidateMobile(row.mobile);
        if (!ok) {
          localErrors.push(
            `Row ${idx + 2}: ${error} (value: "${row.mobile || ""}")`
          );
          return;
        }
        row.mobile = normalized;

        dataRows.push(row);
      });

      setRows(dataRows);
      setParseErrors(localErrors);
    };

    reader.readAsText(file);
  };

  const handleUpload = async () => {
    if (!rows.length) {
      toast.error("No valid rows to upload");
      return;
    }

    setUploading(true);
    const createdLeads = [];
    const errors = [];

    const rawUsername = (localStorage.getItem("username") || "")
      .toString()
      .trim()
      .toLowerCase();

    const createdMobiles = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;

      const mobile = (row.mobile || "").toString().trim();
      if (existingMobiles.has(mobile) || createdMobiles.has(mobile)) {
        errors.push(
          `Row ${rowNumber}: Mobile ${mobile} already exists in CRM or duplicated in file`
        );
        continue;
      }

      let statusToSave = (row.status || "").trim();
      let dobToSave = (row.dob || "").trim();

      if (
        statusToSave === "Visit Scheduled" &&
        (!dobToSave || dobToSave === "")
      ) {
        errors.push(
          `Row ${rowNumber}: status is "Visit Scheduled" but dob is empty`
        );
        continue;
      }

      if (
        AUTO_24H_STATUSES.includes(statusToSave) &&
        (!dobToSave || dobToSave === "")
      ) {
        dobToSave = getTomorrow9AMForInput();
      }

      const payload = {
        name: row.name || null,
        mobile,
        source: row.source || null,
        status: statusToSave || null,
        job_role: row.job_role || null,
        budget: row.budget || null,
        project: row.project || null,
        remarks: row.remarks || null,
        dob: dobToSave || null,
        Assigned_to: rawUsername || null,
      };

      try {
        const res = await api.post("/add-lead", payload);
        const createdFromServer = res.data;

        const normalizedLead = {
          ...createdFromServer,
          status:
            createdFromServer.status === "Follow Up" ||
            createdFromServer.status === "Follow-up"
              ? "Visit Scheduled"
              : createdFromServer.status,
          dob: normalizeDobFromBackend(createdFromServer.dob),
        };

        createdLeads.push(normalizedLead);
        existingMobiles.add(mobile);
        createdMobiles.add(mobile);
      } catch (err) {
        console.error("Error adding lead (bulk)", {
          rowNumber,
          message: err.message,
          status: err.response?.status,
          data: err.response?.data,
        });

        if (err.response?.status === 409) {
          errors.push(
            `Row ${rowNumber}: Lead with mobile ${mobile} already exists (409 from server)`
          );
        } else {
          errors.push(
            `Row ${rowNumber}: Failed to add lead (status ${
              err.response?.status || "?"
            })`
          );
        }
      }
    }

    setUploading(false);

    if (createdLeads.length) {
      onLeadsAdded(createdLeads);
      toast.success(
        `Imported ${createdLeads.length} leads. Skipped ${errors.length}.`
      );
    } else {
      toast.error("No leads were imported");
    }

    if (errors.length) {
      setParseErrors(errors.slice(0, 50));
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="relative w-full max-w-2xl mx-4 rounded-2xl bg-white border border-slate-200 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h5 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-sm">
              ⬆
            </span>
            Bulk Upload Leads (CSV)
          </h5>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700 text-xl leading-none"
            onClick={onClose}
          >
            <CircleXIcon />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 text-xs">
          <div className="space-y-2">
            <p className="text-slate-600">
              Upload a CSV file with the following header (exactly in this
              order):
            </p>
            <pre className="bg-slate-900 text-slate-100 text-[11px] rounded-lg px-3 py-2 overflow-x-auto">
{`name,mobile,source,status,job_role,budget,project,remarks,dob`}
            </pre>
            <ul className="list-disc list-inside text-slate-500 text-[11px] space-y-1">
              <li>
                <strong>mobile</strong> is required and must be a valid 10-digit
                Indian number (can be with +91 / 0).
              </li>
              <li>
                All other fields (<code>name, source, status, job_role, budget, project, remarks, dob</code>) are optional.
              </li>
              <li>
                For status <strong>Visit Scheduled</strong>, <strong>dob</strong> is mandatory.
              </li>
              <li>
                <strong>dob</strong> (Call / Visit Date &amp; Time) format:
                YYYY-MM-DDTHH:mm (e.g. 2025-12-05T11:30).
              </li>
              <li>
                For auto follow-up statuses (NR/SF, RNR, Details_shared, Site
                Visited, Busy), if dob is empty, it will be auto-set to tomorrow
                09:00 AM.
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <label className="text-slate-600 text-xs font-medium">
              Select CSV file
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="block w-full text-xs text-slate-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-xs file:font-medium file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
            />
            {fileName && (
              <p className="text-[11px] text-slate-500 mt-1">
                Selected file:{" "}
                <span className="font-medium text-slate-700">{fileName}</span>
              </p>
            )}
          </div>

          {rows.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 space-y-1">
              <p>
                Parsed rows:{" "}
                <span className="font-semibold text-emerald-700">
                  {rows.length}
                </span>
              </p>
              <p>
                Existing leads in CRM:{" "}
                <span className="font-semibold text-blue-700">
                  {existingLeads?.length || 0}
                </span>
              </p>
            </div>
          )}

          {parseErrors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 max-h-40 overflow-y-auto">
              <p className="font-semibold mb-1">
                Issues found ({parseErrors.length}):
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                {parseErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
              {parseErrors.length > 50 && (
                <p className="mt-1 text-[10px] text-red-500">
                  Showing first 50 errors only.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-3 bg-slate-50 rounded-b-2xl">
          <button
            type="button"
            className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 hover:bg-slate-100 transition"
            onClick={onClose}
            disabled={uploading}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`rounded-full px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition ${
              rows.length === 0 || uploading
                ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                : "bg-emerald-600 hover:bg-emerald-500 hover:shadow-md"
            }`}
            disabled={rows.length === 0 || uploading}
            onClick={handleUpload}
          >
            {uploading
              ? "Uploading..."
              : `Upload ${rows.length} Lead${
                  rows.length === 1 ? "" : "s"
                }`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LeadsTable;