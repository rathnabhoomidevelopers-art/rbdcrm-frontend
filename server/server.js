// server.js
require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();

const connectionString = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const mongoClient = MongoClient;

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const PORT = process.env.PORT || 3000;

// ✅ Statuses that appear in dashboards and should create/update follow-up
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
  "Busy",
  "Closed",
];

/* =========================
   ✅ Manual CORS (Vercel-safe)
   - Always responds to OPTIONS with headers + 204
   - Prevents "No Access-Control-Allow-Origin" preflight failures
========================= */
const allowedOrigins = new Set([
  "https://www.rbdcrm.com",
  "https://rbdcrm.com",
  "http://localhost:3000",
  "http://localhost:3001",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  // allow server-to-server / Postman / curl (no origin header)
  if (!origin) return next();

  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin"); // IMPORTANT for caching/CDN
    // You are using Bearer token (localStorage), not cookies -> credentials not needed.
    // res.setHeader("Access-Control-Allow-Credentials", "true");

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With"
    );
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Simple request logger
app.use((req, res, next) => {
  console.log(
    `${new Date().toLocaleString()} Request made to ${req.method} ${req.originalUrl}`
  );
  next();
});

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function auth(allowedRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;

      if (
        Array.isArray(allowedRoles) &&
        allowedRoles.length > 0 &&
        !allowedRoles.includes(decoded.role)
      ) {
        return res.status(403).json({ message: "Forbidden" });
      }

      next();
    } catch (err) {
      console.error("JWT verify error:", err.message);
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  };
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

/* =========================
   AUTH
========================= */

app.post("/auth/admin-login", async (req, res) => {
  const { user_id, password } = req.body || {};
  if (!user_id || !password) {
    return res
      .status(400)
      .json({ message: "Admin ID and password are required" });
  }

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const usersCol = database.collection("users");

    const user = await usersCol.findOne({ user_id: user_id });

    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    let isMatch = false;
    if (user.password && user.password.startsWith("$2a$")) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = user.password === password;
    }

    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const role = user.role || "admin";
    const normalizedUserName = (user.user_name || "")
      .toString()
      .trim()
      .toLowerCase();

    const token = signToken({
      userId: user._id.toString(),
      role,
      user_name: normalizedUserName,
      user_id: user.user_id || null,
    });

    return res.json({
      token,
      role,
      user_name: normalizedUserName,
      user_id: user.user_id || null,
    });
  } catch (err) {
    console.error("Admin login error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.post("/auth/user-login", async (req, res) => {
  const { user_name, password } = req.body || {};

  const rawName = (user_name || "").toString();
  const normalizedName = rawName.trim().toLowerCase();

  if (!normalizedName || !password) {
    return res
      .status(400)
      .json({ message: "User name and password are required" });
  }

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const usersCol = database.collection("users");

    const user = await usersCol.findOne({ user_name: normalizedName });

    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    let isMatch = false;
    if (user.password && user.password.startsWith("$2a$")) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = user.password === password;
    }

    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const role = user.role || "user";
    const normalizedUserName = (user.user_name || normalizedName)
      .toString()
      .trim()
      .toLowerCase();

    const token = signToken({
      userId: user._id.toString(),
      role,
      user_name: normalizedUserName,
      user_id: user.user_id || null,
    });

    return res.json({
      token,
      role,
      user_name: normalizedUserName,
      user_id: user.user_id || null,
    });
  } catch (err) {
    console.error("User login error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/* =========================
   USERS
========================= */

app.post("/add-user", auth(["admin"]), async (req, res) => {
  let clientObj;
  try {
    const { user_id, user_name, password, email, mobile, role } = req.body;

    if (!user_id || !user_name || !password) {
      return res
        .status(400)
        .json({ message: "user_id, user_name, and password are required" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const normalizedName = user_name.toString().trim().toLowerCase();

    const user = {
      user_id,
      user_name: normalizedName,
      password: hashedPassword,
      email: email || null,
      mobile: mobile || null,
      role: role || "user",
    };

    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");

    // prevent duplicate user_name
    const existing = await database.collection("users").findOne({ user_name: normalizedName });
    if (existing) {
      return res.status(409).json({ message: "User already exists" });
    }

    await database.collection("users").insertOne(user);

    console.log("User added successfully!..");
    return res.status(201).json({ message: "User added successfully" });
  } catch (err) {
    console.error("Add user error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/users", auth(["admin", "user"]), async (req, res) => {
  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const users = await database
      .collection("users")
      .find({}, { projection: { password: 0 } })
      .toArray();

    return res.status(200).json(users);
  } catch (err) {
    console.error("Users fetch error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/* =========================
   LEADS
========================= */

app.get("/leads", auth(["admin", "user"]), async (req, res) => {
  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const collection = database.collection("leads");

    let query = {};
    if (req.user.role === "user" && req.user.user_name) {
      const normalized = req.user.user_name.toString().trim().toLowerCase();
      query = { Assigned_to: normalized };
    }

    const docs = await collection.find(query).toArray();

    const normalizedDocs = docs.map((doc) => ({
      ...doc,
      lead_id: doc.lead_id || (doc._id ? doc._id.toString() : undefined),
    }));

    return res.status(200).json(normalizedDocs);
  } catch (err) {
    console.error("Error fetching leads", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/lead/:id", auth(["admin", "user"]), async (req, res) => {
  const id = req.params.id;

  const orFilters = [{ lead_id: id }];
  if (ObjectId.isValid(id)) orFilters.push({ _id: new ObjectId(id) });

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");

    const doc = await database.collection("leads").findOne({ $or: orFilters });

    if (!doc) return res.status(404).json({ message: "Lead not found" });
    return res.status(200).json(doc);
  } catch (err) {
    console.error("Error fetching lead", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.post("/add-lead", auth(["admin", "user"]), async (req, res) => {
  const mobile = (req.body.mobile || "").toString().trim();
  if (!mobile) return res.status(400).json({ message: "Mobile number is required" });

  // Mobile normalize/validate
  let digits = mobile.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  if (digits.length !== 10 || !/^[6-9]\d{9}$/.test(digits)) {
    return res
      .status(400)
      .json({ message: "Enter a valid 10-digit mobile number starting with 6-9" });
  }

  // ✅ Fix: if normal user is adding lead and Assigned_to missing -> assign to self
  let assignedTo = req.body.Assigned_to
    ? req.body.Assigned_to.toString().trim().toLowerCase()
    : null;

  if (!assignedTo && req.user?.role === "user" && req.user?.user_name) {
    assignedTo = req.user.user_name.toString().trim().toLowerCase();
  }

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const leadsCol = database.collection("leads");
    const followUpsCol = database.collection("follow-ups");

    const existing = await leadsCol.findOne({ mobile: digits });
    if (existing) {
      return res.status(409).json({
        message: "Lead with this mobile number already exists",
        lead_id: existing.lead_id || (existing._id ? existing._id.toString() : null),
      });
    }

    // Busy default date = tomorrow 9AM
    let dob = req.body.dob ? new Date(req.body.dob) : null;
    if (req.body.status === "Busy" && !dob) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      dob = tomorrow;
    }

    const lead = {
      lead_id: new ObjectId().toHexString(),
      name: req.body.name || null,
      mobile: digits,
      source: req.body.source || null,
      status: req.body.status || null,
      job_role: req.body.job_role || null,
      budget: req.body.budget || null,
      project: req.body.project || null,
      remarks: req.body.remarks || null,
      dob: dob,
      Assigned_to: assignedTo,
      createdAt: new Date(),

      // verification transfer fields
      verification_call: false,
      original_assigned: null,
      transfer_date: null,
    };

    await leadsCol.insertOne(lead);

    // Auto-create follow-up if tracked
    if (lead.status && TRACKED_STATUSES.includes(lead.status)) {
      const followUpDate = lead.dob || new Date();
      const follow_up = {
        followup_id: lead.lead_id,
        date: followUpDate,
        name: lead.name || null,
        mobile: parseInt(lead.mobile, 10) || null,
        source: lead.source || null,
        status: lead.status || null,
        job_role: lead.job_role || null,
        budget: lead.budget || null,
        project: lead.project || null,
        remarks: lead.remarks || null,
        createdAt: new Date(),
      };
      await followUpsCol.insertOne(follow_up);
    }

    return res.status(201).json(lead);
  } catch (err) {
    console.error("DB error on add-lead", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

// ✅ BULK ADD LEADS (FAST)
app.post("/add-leads-bulk", auth(["admin", "user"]), async (req, res) => {
  const items = Array.isArray(req.body?.leads) ? req.body.leads : [];

  if (!items.length) {
    return res.status(400).json({ message: "No leads provided. Send { leads: [...] }" });
  }

  // helper: normalize/validate mobile to 10 digits
  const normalizeMobile = (raw) => {
    if (raw === undefined || raw === null) return { ok: false, digits: "", error: "Mobile missing" };

    let digits = raw.toString().replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

    if (digits.length !== 10) {
      return { ok: false, digits, error: "Mobile must be 10 digits" };
    }
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return { ok: false, digits, error: "Mobile must start with 6-9" };
    }
    return { ok: true, digits, error: null };
  };

  // assign-to rule (same as /add-lead)
  const currentUser = (req.user?.user_name || "").toString().trim().toLowerCase();
  const isUser = req.user?.role === "user";

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const leadsCol = database.collection("leads");
    const followUpsCol = database.collection("follow-ups");

    // 1) Validate + normalize + dedupe inside uploaded file
    const seenInFile = new Set();
    const valid = [];
    const invalid = [];

    for (let i = 0; i < items.length; i++) {
      const row = items[i] || {};
      const nm = normalizeMobile(row.mobile);

      if (!nm.ok) {
        invalid.push({ row: i + 1, mobile: row.mobile, reason: nm.error });
        continue;
      }

      if (seenInFile.has(nm.digits)) {
        invalid.push({ row: i + 1, mobile: nm.digits, reason: "Duplicate mobile in uploaded file" });
        continue;
      }
      seenInFile.add(nm.digits);

      // normalize Assigned_to
      let assignedTo = row.Assigned_to
        ? row.Assigned_to.toString().trim().toLowerCase()
        : null;

      if (!assignedTo && isUser && currentUser) assignedTo = currentUser;

      // Busy default dob = tomorrow 9AM (same as /add-lead)
      let dob = row.dob ? new Date(row.dob) : null;
      if (row.status === "Busy" && (!dob || Number.isNaN(dob.getTime()))) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        dob = tomorrow;
      }

      // if dob invalid -> null
      if (dob && Number.isNaN(dob.getTime())) dob = null;

      valid.push({
        lead_id: new ObjectId().toHexString(),
        name: row.name || null,
        mobile: nm.digits,
        source: row.source || null,
        status: row.status || null,
        job_role: row.job_role || null,
        budget: row.budget || null,
        project: row.project || null,
        remarks: row.remarks || null,
        dob: dob,
        Assigned_to: assignedTo,
        createdAt: new Date(),
        verification_call: false,
        original_assigned: null,
        transfer_date: null,
      });
    }

    if (!valid.length) {
      return res.status(400).json({
        message: "No valid leads to insert",
        inserted: 0,
        skippedExisting: 0,
        invalidCount: invalid.length,
        invalid,
      });
    }

    // 2) Find existing mobiles in DB (single query)
    const mobiles = valid.map((v) => v.mobile);
    const existingDocs = await leadsCol
      .find({ mobile: { $in: mobiles } }, { projection: { mobile: 1 } })
      .toArray();
    const existingSet = new Set(existingDocs.map((d) => (d.mobile || "").toString()));

    // 3) Filter out already-existing leads
    const toInsert = [];
    const skippedExisting = [];

    for (const v of valid) {
      if (existingSet.has(v.mobile)) skippedExisting.push(v.mobile);
      else toInsert.push(v);
    }

    if (!toInsert.length) {
      return res.status(200).json({
        message: "All uploaded leads already exist",
        inserted: 0,
        skippedExisting: skippedExisting.length,
        invalidCount: invalid.length,
        invalid,
      });
    }

    // 4) Insert all leads in one DB call (FAST)
    // ordered:false -> continue inserting even if one fails
    const insertRes = await leadsCol.insertMany(toInsert, { ordered: false });

    // 5) Create follow-ups in bulk (only tracked statuses)
    const followUps = toInsert
      .filter((l) => l.status && TRACKED_STATUSES.includes(l.status))
      .map((l) => ({
        followup_id: l.lead_id,
        date: l.dob || new Date(),
        name: l.name || null,
        mobile: l.mobile ? parseInt(l.mobile, 10) : null,
        source: l.source || null,
        status: l.status || null,
        job_role: l.job_role || null,
        budget: l.budget || null,
        project: l.project || null,
        remarks: l.remarks || null,
        createdAt: new Date(),
      }));

    if (followUps.length) {
      await followUpsCol.insertMany(followUps, { ordered: false });
    }

    return res.status(201).json({
      message: "Bulk upload completed",
      received: items.length,
      valid: valid.length,
      inserted: Object.keys(insertRes.insertedIds || {}).length,
      skippedExisting: skippedExisting.length,
      invalidCount: invalid.length,
      invalid, // keep this so UI can show “row no + reason”
    });
  } catch (err) {
    console.error("Bulk add error:", err);
    return res.status(500).json({ message: "Bulk upload failed" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});


/**
 * ✅ /edit-lead
 * - true partial update
 * - Busy: sets tomorrow 9AM if date not given
 * - 3 consecutive Busy/NR-SF/RNR => transfer to another user + verification_call=true
 * - when verification_call lead updated to non-Busy => return to original_assigned
 */
app.put("/edit-lead/:id", auth(["admin", "user"]), async (req, res) => {
  const leadId = req.params.id;

  const update = {};
  if ("name" in req.body) update.name = req.body.name || null;
  if ("source" in req.body) update.source = req.body.source || null;
  if ("status" in req.body) update.status = req.body.status || null;
  if ("job_role" in req.body) update.job_role = req.body.job_role || null;
  if ("budget" in req.body) update.budget = req.body.budget || null;
  if ("project" in req.body) update.project = req.body.project || null;
  if ("remarks" in req.body) update.remarks = req.body.remarks || null;

  if ("dob" in req.body) update.dob = req.body.dob ? new Date(req.body.dob) : null;

  // only update Assigned_to if explicitly provided
  if ("Assigned_to" in req.body) {
    update.Assigned_to = req.body.Assigned_to
      ? req.body.Assigned_to.toString().trim().toLowerCase()
      : null;
  }

  const orFilters = [{ lead_id: leadId }];
  if (ObjectId.isValid(leadId)) orFilters.push({ _id: new ObjectId(leadId) });

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const leadsCol = database.collection("leads");
    const followUpsCol = database.collection("follow-ups");
    const usersCol = database.collection("users");

    const existingLead = await leadsCol.findOne({ $or: orFilters });
    if (!existingLead) return res.status(404).json({ message: "Lead not found" });

    const newStatus = update.status;
    const isTrackedStatus = !!(newStatus && TRACKED_STATUSES.includes(newStatus));

    const currentUser = (req.user?.user_name || "").toString().trim().toLowerCase();

    const responseData = { message: "Lead updated successfully" };

    // Helper: choose least-loaded user excluding current user
    async function pickNextUser(excludeUserName) {
      const allUsers = await usersCol
        .find({ role: "user", user_name: { $ne: excludeUserName } })
        .toArray();

      if (!allUsers.length) return null;

      const userLeadCounts = await Promise.all(
        allUsers.map(async (user) => {
          const count = await leadsCol.countDocuments({
            Assigned_to: user.user_name,
            verification_call: { $ne: true },
          });
          return { user, count };
        })
      );

      userLeadCounts.sort((a, b) => a.count - b.count);
      return userLeadCounts[0].user;
    }

    // ✅ If status is Busy and date not provided => tomorrow 9AM
    if (newStatus === "Busy") {
      if (!("dob" in update) || !update.dob) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        update.dob = tomorrow;
      }
    }

    // ✅ Return-to-owner logic:
    // If currently verification_call=true and status is changing away from Busy -> return to original
    if (existingLead.verification_call && newStatus && newStatus !== "Busy") {
      const original = existingLead.original_assigned;
      if (original) {
        update.Assigned_to = original;
        update.verification_call = false;
        update.transfer_date = null;
        update.original_assigned = null;

        responseData.returnedTo = original;
        responseData.message = `Lead updated and returned to ${original}`;
      }
    }

    // ✅ Transfer logic for Busy / NR-SF / RNR (only if not already verification_call)
    const shouldTransferCheck =
      !existingLead.verification_call &&
      (newStatus === "Busy" || newStatus === "NR/SF" || newStatus === "RNR");

    if (shouldTransferCheck) {
      // Important: "3 days" behavior is implemented as "3 consecutive follow-ups with same status"
      // because you are saving follow-up entries per update, and sorting by date.
      const history = await followUpsCol
        .find({ followup_id: existingLead.lead_id, status: newStatus })
        .sort({ date: -1 })
        .limit(3)
        .toArray();

      const consecutiveCount = history.length + 1; // including current update

      if (consecutiveCount >= 3) {
        const nextUser = await pickNextUser(currentUser);
        if (nextUser) {
          update.Assigned_to = nextUser.user_name;
          update.verification_call = true;
          update.original_assigned = existingLead.Assigned_to || currentUser || null;
          update.transfer_date = new Date();

          responseData.transferredTo = nextUser.user_name;
          responseData.message = `Lead updated and transferred to ${nextUser.user_name} (Verification Call)`;
        }
      }
    }

    // Update lead
    await leadsCol.updateOne({ $or: orFilters }, { $set: update });

    const nextLead = { ...existingLead, ...update };
    const followupId = nextLead.lead_id || existingLead.lead_id;
    const nextStatus = nextLead.status || null;

    const isTracked = !!(nextStatus && TRACKED_STATUSES.includes(nextStatus));

    // Follow-up sync:
    if (!isTracked) {
      await followUpsCol.deleteOne({ followup_id: followupId });
    } else {
      const fuUpdate = {
        status: nextStatus,
        date: nextLead.dob ? new Date(nextLead.dob) : null,
        name: nextLead.name || null,
        mobile: nextLead.mobile ? parseInt(nextLead.mobile, 10) : null,
        source: nextLead.source || null,
        job_role: nextLead.job_role || null,
        budget: nextLead.budget || null,
        project: nextLead.project || null,
        remarks: nextLead.remarks || null,
      };

      await followUpsCol.updateOne(
        { followup_id: followupId },
        { $set: fuUpdate, $setOnInsert: { followup_id: followupId, createdAt: new Date() } },
        { upsert: true }
      );
    }

    return res.status(200).json(responseData);
  } catch (err) {
    console.error("Error updating lead", err);
    return res.status(500).json({ message: "Error updating lead" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.delete("/delete-lead/:id", auth(["admin"]), async (req, res) => {
  const id = req.params.id;
  let clientObj;

  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const leadsCol = database.collection("leads");

    const result = await leadsCol.deleteOne({ lead_id: id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Lead not found" });
    }

    return res.status(200).json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("Delete lead error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/* =========================
   STATUS SETTINGS
========================= */

app.post("/statuslist", auth(["admin"]), async (req, res) => {
  const status = {
    Details_shared: req.body.Details_shared === "true",
    RNR: req.body.RNR === "true",
    Follow_up: req.body.Follow_up === "true",
    Not_interested: req.body.Not_interested === "true",
    Site_visited: req.body.Site_visited === "true",
    Booked: req.body.Booked === "true",
    Invalid: req.body.Invalid === "true",
    NR_SF: req.body.NR_SF === "true",
    Others: req.body.Others === "true",
    Location_Issue: req.body.Location_Issue === "true",
    CP: req.body.CP === "true",
    Budget_Issue: req.body.Budget_Issue === "true",
    Visit_Postponed: req.body.Visit_Postponed === "true",
    Busy: req.body.Busy === "true",
    Closed: req.body.Closed === "true",
  };

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    await database.collection("status").insertOne(status);
    return res.status(201).send();
  } catch (err) {
    console.error("Status update error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/status", auth(["admin", "user"]), async (req, res) => {
  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const docs = await database.collection("status").find({}).toArray();
    return res.status(200).json(docs);
  } catch (err) {
    console.error("Status fetch error", err);
    return res.status(500).json({ message: "Database connection failed!" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/* =========================
   FOLLOW-UPS
========================= */

app.post("/add-follow_up", auth(["admin", "user"]), async (req, res) => {
  const id = req.body.followup_id;

  const follow_up = {
    followup_id: id,
    date: req.body.date ? new Date(req.body.date) : null,
    name: req.body.name || null,
    mobile: req.body.mobile ? parseInt(req.body.mobile, 10) : null,
    source: req.body.source || null,
    status: req.body.status || null,
    job_role: req.body.job_role || null,
    budget: req.body.budget || null,
    project: req.body.project || null,
    remarks: req.body.remarks || null,
    createdAt: new Date(),
  };

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const result = await database.collection("follow-ups").insertOne(follow_up);

    return res.status(201).json({
      message: "Follow-up created successfully",
      insertedId: result.insertedId,
    });
  } catch (err) {
    console.error("DB error in add-follow_up", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.put("/edit-follow_up/:id", auth(["admin", "user"]), async (req, res) => {
  const id = req.params.id;

  const update = {
    date: req.body.date ? new Date(req.body.date) : null,
    name: req.body.name || null,
    mobile: req.body.mobile ? parseInt(req.body.mobile, 10) : null,
    source: req.body.source || null,
    status: req.body.status || null,
    job_role: req.body.job_role || null,
    budget: req.body.budget || null,
    project: req.body.project || null,
    remarks: req.body.remarks || null,
  };

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const result = await database
      .collection("follow-ups")
      .updateOne({ followup_id: id }, { $set: update });

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Follow-up not found" });
    }

    return res.status(200).json({ message: "Follow-up updated successfully" });
  } catch (err) {
    console.error("Update follow-up error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/follow-ups", auth(["admin", "user"]), async (req, res) => {
  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const docs = await database.collection("follow-ups").find({}).toArray();
    return res.status(200).json(docs);
  } catch (err) {
    console.error("Database err", err);
    return res.status(500).json({ message: "Database connection failed" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/follow-up/:id", auth(["admin", "user"]), async (req, res) => {
  const id = req.params.id;

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const doc = await database.collection("follow-ups").findOne({ followup_id: id });

    if (!doc) return res.status(404).json({ message: "Follow-up not found" });
    return res.status(200).json(doc);
  } catch (err) {
    console.error("DB connection error", err);
    return res.status(500).json({ message: "Database connection failed" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.delete("/delete-follow_up/:id", auth(["admin"]), async (req, res) => {
  const id = req.params.id;

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");

    const result = await database.collection("follow-ups").deleteOne({ followup_id: id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Follow-up not found" });
    }

    return res.status(200).json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("Delete follow-up error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/* =========================
   SITE VISITS
========================= */

app.post("/site_visit", auth(["admin", "user"]), async (req, res) => {
  const visit = {
    visit_id: req.body.visit_id,
    name: req.body.name,
    mobile: req.body.mobile ? parseInt(req.body.mobile, 10) : null,
    site_visit_date: req.body.site_visit_date ? new Date(req.body.site_visit_date) : null,
    Assigned_to: req.body.Assigned_to,
    created_by: req.body.created_by,
  };

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    await database.collection("site_visit").insertOne(visit);
    return res.status(201).json({ message: "Site visit added successfully" });
  } catch (err) {
    console.error("Site visit add error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.put("/edit_site_visit/:id", auth(["admin", "user"]), async (req, res) => {
  const id = req.params.id;

  const visit = {
    visit_id: req.body.visit_id,
    name: req.body.name,
    mobile: req.body.mobile ? parseInt(req.body.mobile, 10) : null,
    site_visit_date: req.body.site_visit_date ? new Date(req.body.site_visit_date) : null,
    Assigned_to: req.body.Assigned_to,
    created_by: req.body.created_by,
  };

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");

    await database.collection("site_visit").updateOne({ visit_id: id }, { $set: visit });
    return res.status(200).json({ message: "Site visit updated" });
  } catch (err) {
    console.error("Site visit update error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/site_visits", auth(["admin", "user"]), async (req, res) => {
  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const docs = await database.collection("site_visit").find({}).toArray();
    return res.status(200).json(docs);
  } catch (err) {
    console.error("Site visits fetch error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.get("/site_visits/:id", auth(["admin", "user"]), async (req, res) => {
  const id = req.params.id;

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");

    const doc = await database.collection("site_visit").findOne({ visit_id: id });
    if (!doc) return res.status(404).json({ message: "Site visit not found" });

    return res.status(200).json(doc);
  } catch (err) {
    console.error("Site visit fetch error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

app.delete("/delete/site_visit/:id", auth(["admin"]), async (req, res) => {
  const id = req.params.id;

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");

    const result = await database.collection("site_visit").deleteOne({ visit_id: id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Site visit not found" });
    }

    return res.status(200).json({ message: "Deleted successfully" });
  } catch (err) {
    console.error("Site visit delete error", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) await clientObj.close();
  }
});

/* =========================
   ROOT + ERRORS
========================= */

app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "RBD CRM backend is running",
    time: new Date().toISOString(),
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    message: "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
    path: req.originalUrl,
  });
});

/**
 * ✅ IMPORTANT FOR VERCEL:
 * - Do NOT always listen in serverless.
 * - Export app and only listen when running locally.
 */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
    console.log(`Health check: http://127.0.0.1:${PORT}/health`);
  });
}

module.exports = app;
