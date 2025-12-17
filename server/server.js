require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const app = express();
const connectionString = process.env.MONGO_URI || "mongodb://127.0.0.1:27017";
const mongoClient = MongoClient;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const PORT = process.env.PORT || 3000;

// These match the frontend logic - UPDATED WITH NEW STATUSES
const TRACKED_STATUSES = [
  "Visit Scheduled",
  "NR/SF",
  "RNR",
  "Details_shared",
  "Site Visited",
  "Booked",
  "Location Issue", // NEW
  "CP", // NEW
  "Budget Issue", // NEW
  "Visit Postponed", // NEW
  "Busy", // NEW
  "Closed", // NEW
];

const logRequest = (req, res, next) => {
  console.log(
    `${new Date().toLocaleString()} Request made to ${req.method} ${req.originalUrl}`
  );
  next();
};

// Configure CORS properly
const corsOptions = {
  origin: [
    'https://www.rbdcrm.com',
    'https://rbdcrm.com',
    'http://localhost:3000',
    'http://localhost:3001'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

app.post("/auth/admin-login", async (req, res) => {
  const { user_id, password } = req.body || {};
  if (!user_id || !password) {
    return res
      .status(400)
      .json({ message: "Admin ID and password are required" });
  }

  try {
    const clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const usersCol = database.collection("users");

    const user = await usersCol.findOne({ user_id: user_id });
    await clientObj.close();

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    let isMatch = false;
    if (user.password && user.password.startsWith("$2a$")) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = user.password === password;
    }

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

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

  try {
    const clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const usersCol = database.collection("users");

    const user = await usersCol.findOne({ user_name: normalizedName });
    await clientObj.close();

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    let isMatch = false;
    if (user.password && user.password.startsWith("$2a$")) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = user.password === password;
    }

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

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
  }
});

app.post("/add-user", auth(["admin"]), async (req, res) => {
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

    const clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    await database.collection("users").insertOne(user);
    await clientObj.close();

    console.log("User added successfully!..");
    return res.status(201).json({ message: "User added successfully" });
  } catch (err) {
    console.error("Add user error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

app.get("/users", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("users")
        .find({}, { projection: { password: 0 } })
        .toArray()
        .then((document) => {
          res.status(200).json(document);
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Users fetch error", err);
      return res.status(500).json({ message: "Internal Server Error" });
    });
});

app.get("/leads", auth(["admin", "user"]), async (req, res) => {
  let clientObj;
  try {
    console.log(">>> /leads called, req.user =", req.user);

    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const collection = database.collection("leads");

    let query = {};

    if (req.user.role === "user" && req.user.user_name) {
      const normalized = req.user.user_name.toString().trim().toLowerCase();
      console.log(">>> Normalized username for query:", normalized);

      query = { Assigned_to: normalized };
    }

    console.log(">>> Leads query:", JSON.stringify(query));

    const docs = await collection.find(query).toArray();
    console.log(">>> Leads returned:", docs.length);

    const normalizedDocs = docs.map((doc) => ({
      ...doc,
      lead_id: doc.lead_id || (doc._id ? doc._id.toString() : undefined),
    }));

    return res.status(200).json(normalizedDocs);
  } catch (err) {
    console.error("Error fetching leads", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) {
      await clientObj.close();
    }
  }
});

app.get("/lead/:id", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      database
        .collection("leads")
        .findOne({ lead_id: req.params.id })
        .then((document) => {
          if (!document) {
            return res.status(404).json({ message: "Lead not found" });
          }
          res.send(document);
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Error fetching lead", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.post("/add-lead", auth(["admin", "user"]), async (req, res) => {
  const assignedRaw = req.body.Assigned_to || null;
  const mobile = (req.body.mobile || "").toString().trim();

  if (!mobile) {
    return res.status(400).json({ message: "Mobile number is required" });
  }

  // Mobile validation - less strict
  let digits = mobile.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10 || !/^[6-9]\d{9}$/.test(digits)) {
    return res.status(400).json({ message: "Enter a valid 10-digit mobile number starting with 6-9" });
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
        lead_id:
          existing.lead_id || (existing._id ? existing._id.toString() : null),
      });
    }

    // Handle date for Busy status
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
      Assigned_to: assignedRaw
        ? assignedRaw.toString().trim().toLowerCase()
        : null,
      createdAt: new Date(),
      verification_call: false,
      original_assigned: null,
    };

    await leadsCol.insertOne(lead);
    console.log("Lead added successfully!..");

    // Auto-create follow-up if status is tracked
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
      console.log("Auto follow-up created for lead:", lead.lead_id);
    }

    return res.status(201).json(lead);
  } catch (err) {
    console.error("DB error on add-lead", err);
    return res.status(500).json({ message: "Internal Server Error" });
  } finally {
    if (clientObj) {
      await clientObj.close();
    }
  }
});

/**
 * 🔧 UPDATED: /edit-lead
 * - TRUE PARTIAL UPDATE (keeps Assigned_to unless explicitly provided)
 * ✅ NEW: Transfer logic for Busy status (same as NR/SF, RNR)
 * ✅ NEW: Verification call badge when transferred
 * ✅ NEW: Tracks consecutive days of Busy status
 * ✅ NEW: Return to original assignee when verification call is completed
 */
app.put("/edit-lead/:id", auth(["admin", "user"]), async (req, res) => {
  const leadId = req.params.id;

  // Build update object only with fields that are actually present in req.body
  const update = {};

  if ("name" in req.body) update.name = req.body.name || null;
  if ("source" in req.body) update.source = req.body.source || null;
  if ("status" in req.body) update.status = req.body.status || null;
  if ("job_role" in req.body) update.job_role = req.body.job_role || null;
  if ("budget" in req.body) update.budget = req.body.budget || null;
  if ("project" in req.body) update.project = req.body.project || null;
  if ("remarks" in req.body) update.remarks = req.body.remarks || null;

  if ("dob" in req.body) {
    update.dob = req.body.dob ? new Date(req.body.dob) : null;
  }

  // Only touch Assigned_to if it is explicitly provided
  if ("Assigned_to" in req.body) {
    const assignedRaw = req.body.Assigned_to;
    update.Assigned_to = assignedRaw
      ? assignedRaw.toString().trim().toLowerCase()
      : null;
  }

  const orFilters = [];
  orFilters.push({ lead_id: leadId });

  const asNumber = Number(leadId);
  if (!Number.isNaN(asNumber)) {
    orFilters.push({ lead_id: asNumber });
  }

  if (ObjectId.isValid(leadId)) {
    orFilters.push({ _id: new ObjectId(leadId) });
  }

  console.log("edit-lead update object:", update);
  console.log("edit-lead filters:", orFilters);

  let clientObj;
  try {
    clientObj = await mongoClient.connect(connectionString);
    const database = clientObj.db("crm");
    const leadsCol = database.collection("leads");
    const followUpsCol = database.collection("follow-ups");
    const usersCol = database.collection("users");

    // First read the existing lead (needed to build correct follow-up update)
    const existingLead = await leadsCol.findOne({ $or: orFilters });

    if (!existingLead) {
      console.log("Lead not found for id:", leadId);
      return res.status(404).json({ message: "Lead not found" });
    }

    // Check if status is being changed to Busy
    const newStatus = update.status;
    const oldStatus = existingLead.status;
    const isBusyStatus = newStatus === "Busy";
    const wasBusyStatus = oldStatus === "Busy";

    // Get current user info for transfer logic
    const currentUser = req.user.user_name || "";
    
    // Initialize response data
    let responseData = { message: "Lead updated successfully" };
    let transferredTo = null;

    // --- TRANSFER LOGIC FOR BUSY STATUS ---
    if (isBusyStatus) {
      // Check for consecutive Busy status entries in follow-ups
      const followUpHistory = await followUpsCol
        .find({ 
          followup_id: existingLead.lead_id, 
          status: "Busy" 
        })
        .sort({ date: -1 })
        .limit(3)
        .toArray();

      // Count consecutive Busy statuses (including this new one)
      const consecutiveBusyCount = followUpHistory.length + 1;
      
      console.log(`Busy status count: ${consecutiveBusyCount} for lead ${existingLead.lead_id}`);

      // If this is the 3rd consecutive Busy status, transfer to another user
      if (consecutiveBusyCount >= 3) {
        // Get all users except current one
        const allUsers = await usersCol
          .find({ 
            user_name: { $ne: currentUser },
            role: "user" 
          })
          .toArray();

        if (allUsers.length > 0) {
          // Find users sorted by lead count (to distribute evenly)
          const userLeadCounts = await Promise.all(
            allUsers.map(async (user) => {
              const count = await leadsCol.countDocuments({
                Assigned_to: user.user_name,
                verification_call: { $ne: true }
              });
              return { user, count };
            })
          );

          // Sort by lead count (ascending) to give to least busy user
          userLeadCounts.sort((a, b) => a.count - b.count);
          
          const nextUser = userLeadCounts[0].user;
          transferredTo = nextUser.user_name;

          // Update lead with transfer
          update.Assigned_to = transferredTo;
          update.verification_call = true;
          update.original_assigned = existingLead.Assigned_to; // Store original assignee
          update.transfer_date = new Date();

          console.log(`Lead ${existingLead.lead_id} transferred to ${transferredTo} due to 3 consecutive Busy statuses`);
          
          // Add to response
          responseData.transferredTo = transferredTo;
          responseData.message = `Lead updated and transferred to ${transferredTo} (Verification Call)`;
        }
      } else {
        // Set date to tomorrow 9 AM for Busy status if not already set
        if (!update.dob) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(9, 0, 0, 0);
          update.dob = tomorrow;
        }
      }
    }

    // Check if this is a verification call being updated
    if (existingLead.verification_call && newStatus && newStatus !== "Busy") {
      // If verification call is completed (status changed from Busy to something else),
      // return lead to original assignee
      if (existingLead.original_assigned) {
        update.Assigned_to = existingLead.original_assigned;
        update.verification_call = false;
        update.original_assigned = null;
        
        console.log(`Lead ${existingLead.lead_id} returned to original assignee: ${existingLead.original_assigned}`);
        
        responseData.returnedTo = existingLead.original_assigned;
        responseData.message = `Lead updated and returned to ${existingLead.original_assigned}`;
      }
    }

    // Also handle NR/SF and RNR transfers (existing logic)
    if ((newStatus === "NR/SF" || newStatus === "RNR") && !existingLead.verification_call) {
      // Check for consecutive status entries in follow-ups
      const followUpHistory = await followUpsCol
        .find({ 
          followup_id: existingLead.lead_id, 
          status: newStatus 
        })
        .sort({ date: -1 })
        .limit(3)
        .toArray();

      // Count consecutive statuses (including this new one)
      const consecutiveCount = followUpHistory.length + 1;
      
      if (consecutiveCount >= 3) {
        // Get all users except current one
        const allUsers = await usersCol
          .find({ 
            user_name: { $ne: currentUser },
            role: "user" 
          })
          .toArray();

        if (allUsers.length > 0) {
          // Find users sorted by lead count
          const userLeadCounts = await Promise.all(
            allUsers.map(async (user) => {
              const count = await leadsCol.countDocuments({
                Assigned_to: user.user_name,
                verification_call: { $ne: true }
              });
              return { user, count };
            })
          );

          userLeadCounts.sort((a, b) => a.count - b.count);
          
          const nextUser = userLeadCounts[0].user;
          transferredTo = nextUser.user_name;

          // Update lead with transfer
          update.Assigned_to = transferredTo;
          update.verification_call = true;
          update.original_assigned = existingLead.Assigned_to;
          update.transfer_date = new Date();

          console.log(`Lead ${existingLead.lead_id} transferred to ${transferredTo} due to 3 consecutive ${newStatus} statuses`);
          
          // Add to response
          responseData.transferredTo = transferredTo;
          responseData.message = `Lead updated and transferred to ${transferredTo} (Verification Call)`;
        }
      }
    }

    // Update lead
    const result = await leadsCol.updateOne(
      { $or: orFilters },
      { $set: update }
    );

    console.log("edit-lead result:", result);

    // Build the new "effective" lead data after update
    const nextLead = { ...existingLead, ...update };

    // --- FOLLOW-UP SYNC LOGIC ---
    const followupId = nextLead.lead_id || existingLead.lead_id;
    const nextStatus = nextLead.status || null;
    
    const isTracked = !!(nextStatus && TRACKED_STATUSES.includes(nextStatus));

    if (!isTracked) {
      // If status is not tracked, remove follow-up if present
      await followUpsCol.deleteOne({ followup_id: followupId });
    } else {
      // If tracked, ensure follow-up exists & is updated
      const fuUpdate = {};

      // keep follow-up status/date in sync
      fuUpdate.status = nextStatus;
      fuUpdate.date = nextLead.dob ? new Date(nextLead.dob) : null;

      // Optional: keep these fields synced too (safe)
      fuUpdate.name = nextLead.name || null;
      fuUpdate.mobile = nextLead.mobile ? parseInt(nextLead.mobile, 10) : null;
      fuUpdate.source = nextLead.source || null;
      fuUpdate.job_role = nextLead.job_role || null;
      fuUpdate.budget = nextLead.budget || null;
      fuUpdate.project = nextLead.project || null;
      fuUpdate.remarks = nextLead.remarks || null;

      // Upsert follow-up (create if missing)
      await followUpsCol.updateOne(
        { followup_id: followupId },
        {
          $set: fuUpdate,
          $setOnInsert: { followup_id: followupId, createdAt: new Date() },
        },
        { upsert: true }
      );
    }

    console.log("Lead updated successfully + follow-up synced!..");
    return res.status(200).json(responseData);
  } catch (err) {
    console.error("Error updating lead", err);
    return res.status(500).json({ message: "Error updating lead" });
  } finally {
    if (clientObj) {
      await clientObj.close();
    }
  }
});

app.delete("/delete-lead/:id", auth(["admin"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("leads")
        .deleteOne({ lead_id: req.params.id })
        .then((result) => {
          if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Lead not found" });
          }
          console.log("Deleted the Lead successfully!..");
          res.status(200).json({ message: "Deleted successfully" });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Delete lead error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.post("/statuslist", auth(["admin"]), (req, res) => {
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
    Location_Issue: req.body.Location_Issue === "true", // NEW
    CP: req.body.CP === "true", // NEW
    Budget_Issue: req.body.Budget_Issue === "true", // NEW
    Visit_Postponed: req.body.Visit_Postponed === "true", // NEW
    Busy: req.body.Busy === "true", // NEW
    Closed: req.body.Closed === "true", // NEW
  };

  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("status")
        .insertOne(status)
        .then(() => {
          console.log("Updated the status!..");
          res.status(201).send();
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Status update error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.get("/status", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("status")
        .find({})
        .toArray()
        .then((document) => res.status(200).json(document))
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Status fetch error", err);
      return res.status(500).json({ message: "Database connection failed!" });
    });
});

app.post("/add-follow_up", auth(["admin", "user"]), (req, res) => {
  const id = req.body.followup_id;

  const follow_up = {
    followup_id: id,
    date: req.body.date ? new Date(req.body.date) : null,
    name: req.body.name || null,
    mobile: req.body.mobile ? parseInt(req.body.mobile) : null,
    source: req.body.source || null,
    status: req.body.status || null,
    job_role: req.body.job_role || null,
    budget: req.body.budget || null,
    project: req.body.project || null,
    remarks: req.body.remarks || null,
    createdAt: new Date(),
  };

  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");

      return database
        .collection("follow-ups")
        .insertOne(follow_up)
        .then((result) => {
          console.log("Follow-up inserted for", id);
          res.status(201).json({
            message: "Follow-up created successfully",
            insertedId: result.insertedId,
          });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("DB error in add-follow_up", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.put("/edit-follow_up/:id", auth(["admin", "user"]), (req, res) => {
  const id = req.params.id;

  const update = {
    date: req.body.date ? new Date(req.body.date) : null,
    name: req.body.name || null,
    mobile: req.body.mobile ? parseInt(req.body.mobile) : null,
    source: req.body.source || null,
    status: req.body.status || null,
    job_role: req.body.job_role || null,
    budget: req.body.budget || null,
    project: req.body.project || null,
    remarks: req.body.remarks || null,
  };

  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("follow-ups")
        .updateOne({ followup_id: id }, { $set: update })
        .then((result) => {
          if (result.matchedCount === 0) {
            return res.status(404).json({ message: "Follow-up not found" });
          }
          console.log("updated the follow up !..");
          res.status(200).json({ message: "Follow-up updated successfully" });
        })
        .catch((err) => {
          console.error("Update error", err);
          res.status(500).json({ message: "Internal Server Error" });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("DB Connect error", err);
      res.status(500).json({ message: "Database connection failed" });
    });
});

app.get("/follow-ups", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("follow-ups")
        .find({})
        .toArray()
        .then((document) => res.status(200).json(document))
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Database err", err);
      return res.status(500).json({ message: "Database connection failed" });
    });
});

app.get("/follow-up/:id", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("follow-ups")
        .findOne({ followup_id: req.params.id })
        .then((document) => {
          if (!document) {
            return res.status(404).json({ message: "Follow-up not found" });
          }
          return res.status(200).json(document);
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("DB connection error", err);
      return res.status(500).json({ message: "Database connection failed" });
    });
});

app.delete("/delete-follow_up/:id", auth(["admin"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("follow-ups")
        .deleteOne({ followup_id: req.params.id })
        .then((result) => {
          if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Follow-up not found" });
          }
          console.log("Deleted the Follow-up successfully!..");
          return res.status(200).json({ message: "Deleted successfully" });
        })
        .catch((err) => {
          console.log("Delete error", err);
          return res.status(500).json({ message: "Internal Server Error" });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("DB Connect error", err);
      return res.status(500).json({ message: "Database connection failed" });
    });
});

app.post("/site_visit", auth(["admin", "user"]), (req, res) => {
  const visit = {
    visit_id: req.body.visit_id,
    name: req.body.name,
    mobile: req.body.mobile ? parseInt(req.body.mobile) : null,
    site_visit_date: new Date(req.body.site_visit_date),
    Assigned_to: req.body.Assigned_to,
    created_by: req.body.created_by,
  };
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("site_visit")
        .insertOne(visit)
        .then(() => {
          console.log("Site visit added successfully!..");
          res.status(201).json({ message: "Site visit added successfully" });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Site visit add error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.put("/edit_site_visit/:id", auth(["admin", "user"]), (req, res) => {
  const visit = {
    visit_id: req.body.visit_id,
    name: req.body.name,
    mobile: req.body.mobile ? parseInt(req.body.mobile) : null,
    site_visit_date: new Date(req.body.site_visit_date),
    Assigned_to: req.body.Assigned_to,
    created_by: req.body.created_by,
  };
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("site_visit")
        .updateOne({ visit_id: req.params.id }, { $set: visit })
        .then((document) => {
          res.status(200).json({ message: "Site visit updated", document });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Site visit update error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.get("/site_visits", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("site_visit")
        .find({})
        .toArray()
        .then((document) => {
          res.send(document);
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Site visits fetch error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.get("/site_visits/:id", auth(["admin", "user"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("site_visit")
        .findOne({ visit_id: req.params.id })
        .then((document) => {
          if (!document) {
            return res.status(404).json({ message: "Site visit not found" });
          }
          res.send(document);
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Site visit fetch error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.delete("/delete/site_visit/:id", auth(["admin"]), (req, res) => {
  mongoClient
    .connect(connectionString)
    .then((clientObj) => {
      const database = clientObj.db("crm");
      return database
        .collection("site_visit")
        .deleteOne({ visit_id: req.params.id })
        .then((result) => {
          if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Site visit not found" });
          }
          console.log("Site visit deleted!..");
          res.status(200).json({ message: "Deleted successfully" });
        })
        .finally(() => clientObj.close());
    })
    .catch((err) => {
      console.error("Site visit delete error", err);
      res.status(500).json({ message: "Internal Server Error" });
    });
});

app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "RBD CRM backend is running",
    time: new Date().toISOString(),
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    message: 'Route not found',
    path: req.originalUrl 
  });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
  console.log(`Health check: http://127.0.0.1:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

module.exports = app;