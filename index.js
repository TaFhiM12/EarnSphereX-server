const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const express = require("express");
const admin = require("firebase-admin");
const cors = require("cors");
const app = express();
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  "http://localhost:5173",
  "https://earnspherex.web.app",
  "http://localhost:5000",
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `${process.env.DB_URI}`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const database = client.db("EarnSphereX");
    const usersCollection = database.collection("users");
    const taskCollection = database.collection("tasks");
    const payments = database.collection("payments");
    const paymentsCollection = database.collection("payment");
    const taskSubmissionsCollection = database.collection("taskSubmissions");
    const withDrawalCollection = database.collection("withdrawals");
    const nottificationsCollection = database.collection("notifications");

    // middleware
    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "Unauthorized access" });
      }
      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "Unauthorized access" });
      }

      // verify the token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(401).send({ message: "Unauthorized access" });
      }
    };

    //admin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "admin") {
        return res.status(403).send({ message: "Forbidden" });
      }
      next();
    };

    // worker middleware
    const verifyWorker = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "worker") {
        return res.status(403).send({ message: "Forbidden" });
      }
      next();
    };

    // buyer middleware
    const verifyBuyer = async (req, res, next) => {
      const email = req.decoded.email;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "buyer") {
        return res.status(403).send({ message: "Forbidden" });
      }
      next();
    };

    app.get("/trendingTask", async (req, res) => {
      const result = await taskCollection.find().toArray();
      res.send(result);
    });

    // nottifications related APIs
    app.post("/notifications", verifyFBToken, async (req, res) => {
      try {
        const notification = req.body;
        const result = await nottificationsCollection.insertOne({
          ...notification,
          time: new Date().toISOString(),
          isRead: false,
        });
        res.send(result);
      } catch (error) {
        console.error("Error creating notification:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    app.get("/notifications/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        const notifications = await nottificationsCollection
          .find({ toEmail: email })
          .sort({ time: -1 })
          .toArray();
        res.send(notifications);
      } catch (error) {
        console.error("Error fetching notifications:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    app.patch(
      "/notifications/mark-read/:id",
      verifyFBToken,
      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await nottificationsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { isRead: true } }
          );
          res.send(result);
        } catch (error) {
          console.error("Error marking notification as read:", error);
          res.status(500).send({ error: "Internal server error" });
        }
      }
    );

    app.get(
      "/notifications/unread-count/:email",
      verifyFBToken,
      async (req, res) => {
        try {
          const email = req.params.email;
          const count = await nottificationsCollection.countDocuments({
            toEmail: email,
            isRead: false,
          });
          res.send({ count });
        } catch (error) {
          console.error("Error counting unread notifications:", error);
          res.status(500).send({ error: "Internal server error" });
        }
      }
    );

    // payments related APIs
    app.get("/pay", verifyFBToken, async (req, res) => {
      const coinPackages = await payments.find({}).toArray();
      res.send(coinPackages);
    });
    app.get("/pay/coins/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const payment = await payments.findOne({ _id: new ObjectId(id) });
      if (!payment) {
        return res.status(404).send({ message: "Payment not found" });
      }
      res.send(payment);
    });
    app.post("/pay", async (req, res) => {
      const payment = req.body;
      const result = await payments.insertOne(payment);
      res.send(result);
    });

    // payment related APIs
    app.get("/payments", verifyFBToken, verifyBuyer, async (req, res) => {
      const email = req.query.email;
      const query = email ? { email } : {};
      const paymentsList = await paymentsCollection
        .find(query)
        .sort({
          paidAt: -1,
        })
        .toArray();
      res.send(paymentsList);
    });

    app.post("/payments", verifyFBToken, verifyBuyer, async (req, res) => {
      const { paymentId, email, coins, amount, paymentMethod, transactionId } =
        req.body;

      const updateResult = await usersCollection.updateOne(
        { email },
        { $inc: { coins: coins } }
      );

      if (updateResult.modifiedCount === 0) {
        return res
          .status(404)
          .send({ success: false, message: "User not found" });
      }

      const paymentData = {
        paymentId,
        email,
        amount,
        transactionId,
        paymentMethod,
        paidAt: new Date().toISOString(),
      };

      const result = await paymentsCollection.insertOne(paymentData);

      res.send({
        success: true,
        acknowledged: result.acknowledged,
        insertedId: result.insertedId,
        modifiedCount: updateResult.modifiedCount,
      });
    });

    //user related APIs
    app.get("/users", async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const userExist = await usersCollection.findOne({ email: user.email });
      if (userExist) {
        return res.status(409).send({ message: "User already exists" });
      }
      const result = await usersCollection.insertOne(user);
      res.json(result);
    });

    // Update user last login time
    app.patch("/users/:email", verifyFBToken, async (req, res) => {
      const { email } = req.params;
      const updateData = req.body;

      try {
        const result = await usersCollection.updateOne(
          { email },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.json(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.patch("/usersprofile/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        const { name, photoURL, bio, skills } = req.body;

        const updateData = {};
        if (name) updateData.name = name;
        if (photoURL) updateData.photoURL = photoURL;
        if (bio) updateData.bio = bio;
        if (skills) updateData.skills = skills;

        const result = await usersCollection.updateOne(
          { email },
          { $set: updateData }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ message: "Profile updated successfully" });
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }
      res.send(user);
    });

    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      const userInfo = {
        role: user.role,
        coins: user.coins,
      };
      res.send(userInfo);
    });

    // app.patch("/users/:email", async (req, res) => {
    //   const email = req.params.email;
    //   const updateData = req.body;

    //   const result = await usersCollection.updateOne(
    //     { email },
    //     { $set: updateData }
    //   );
    //   if (result.modifiedCount === 0) {
    //     return res.status(404).send({ message: "User not found" });
    //   }
    //   res.send({ message: "User updated successfully" });
    // });

    app.patch("/users/coins/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const { refundAmount } = req.body;
      await usersCollection.updateOne(
        { email },
        { $inc: { coins: Number(refundAmount) } },
        { upsert: false }
      );
      await taskSubmissionsCollection.deleteMany({
        Buyer_email: email,
        status: "pending",
      });

      res.send({ message: "User coins updated successfully" });
    });

    // admin
    app.patch(
      "/users/coins/admin/:email",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const { refundAmount } = req.body;
        await usersCollection.updateOne(
          { email },
          { $inc: { coins: Number(refundAmount) } },
          { upsert: false }
        );
        await taskSubmissionsCollection.deleteMany({
          Buyer_email: email,
          status: "pending",
        });

        res.send({ message: "User coins updated successfully" });
      }
    );

    // Delete user//admin
    app.delete("/users/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await usersCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    // Update user role//admin
    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { role } = req.body;

          if (!["admin", "buyer", "worker"].includes(role)) {
            return res.status(400).send({ error: "Invalid role" });
          }
          let coins = 0;
          if (role === "worker") {
            coins = 10;
          }
          if (role === "buyer") {
            coins = 50;
          }

          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { role, coins } }
          );
          res.send(result);
        } catch (error) {
          console.error("Error updating user role:", error);
          res.status(500).send({ error: "Internal server error" });
        }
      }
    );

    //task related APIs//
    // all
    // app.get("/tasks", verifyFBToken, async (req, res) => {
    //   const tasks = await taskCollection
    //     .find()
    //     .sort({ completion_date: 1 })
    //     .toArray();
    //   res.send(tasks);
    // });

    // In your server route file (e.g., tasksRoute.js)
    app.get("/tasks", verifyFBToken, async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6; // 6 items per page
        const skip = (page - 1) * limit;

        const totalTasks = await taskCollection.countDocuments({
          required_workers: { $gt: 0 },
        });
        const tasks = await taskCollection
          .find({ required_workers: { $gt: 0 } })
          .sort({ completion_date: 1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({
          tasks,
          totalTasks,
          totalPages: Math.ceil(totalTasks / limit),
          currentPage: page,
        });
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get("/tasks/work/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const task = await taskCollection.findOne({ _id: new ObjectId(id) });
        res.send(task);
      } catch (error) {
        res.status(500).send({ error: "Internal server error" });
      }
    });

    // Get worker submissions with pagination
    // Get approved tasks for worker with pagination
    app.get(
      "/approved-tasks",
      verifyFBToken,
      verifyWorker,
      async (req, res) => {
        try {
          const { workerEmail, page = 1, limit = 10 } = req.query;
          const skip = (page - 1) * limit;

          const submissions = await taskSubmissionsCollection
            .find({
              worker_email: workerEmail,
              status: "approved",
            })
            .sort({ current_date: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .toArray();

          const total = await taskSubmissionsCollection.countDocuments({
            worker_email: workerEmail,
            status: "approved",
          });

          res.send({
            submissions,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: parseInt(page),
          });
        } catch (error) {
          console.error("Error fetching approved tasks:", error);
          res.status(500).send({ error: "Internal server error" });
        }
      }
    );
    app.get(
      "/worker-submissions",
      verifyFBToken,
      verifyWorker,
      async (req, res) => {
        try {
          const { workerEmail, page = 1, limit = 10 } = req.query;
          const skip = (page - 1) * limit;

          const submissions = await taskSubmissionsCollection
            .find({ worker_email: workerEmail })
            .sort({ current_date: -1 }) // Sort by newest first
            .skip(skip)
            .limit(parseInt(limit))
            .toArray();

          const total = await taskSubmissionsCollection.countDocuments({
            worker_email: workerEmail,
          });

          res.send({
            submissions,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: parseInt(page),
          });
        } catch (error) {
          console.error("Error fetching worker submissions:", error);
          res.status(500).send({ error: "Internal server error" });
        }
      }
    );

    app.post(
      "/task-submissions",
      verifyFBToken,
      verifyWorker,
      async (req, res) => {
        try {
          const submission = req.body;
          const result = await taskSubmissionsCollection.insertOne(submission);

          await taskCollection.updateOne(
            { _id: new ObjectId(submission.task_id) },
            { $inc: { required_workers: -1 } }
          );

          await nottificationsCollection.insertOne({
            message: `You have a new submission for ${submission.task_title} from ${submission.worker_name}`,
            toEmail: submission.Buyer_email,
            actionRoute: "/dashboard/buyer-home",
            time: new Date().toISOString(),
            isRead: false,
          });

          res.send(result);
        } catch (error) {
          res.status(500).send({ error: "Internal server error" });
        }
      }
    );

    app.post("/tasks", verifyFBToken, verifyBuyer, async (req, res) => {
      const task = req.body;
      const result = await taskCollection.insertOne(task);
      res.json(result);
    });

    app.get("/tasks/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;
      const tasks = await taskCollection
        .find({
          created_by: email,
        })
        .toArray();
      res.send(tasks);
    });

    app.delete("/tasks/:id", verifyFBToken, verifyBuyer, async (req, res) => {
      const taskId = req.params.id;
      const result = await taskCollection.deleteOne({
        _id: new ObjectId(taskId),
      });
      if (result.deletedCount === 0) {
        return res.status(404).send({ message: "Task not found" });
      }
      res.send({ message: "Task deleted successfully" });
    });
    // Admin related APIs
    app.delete(
      "/tasks/admin/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const taskId = req.params.id;
        const result = await taskCollection.deleteOne({
          _id: new ObjectId(taskId),
        });
        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Task not found" });
        }
        res.send({ message: "Task deleted successfully" });
      }
    );

    app.patch("/tasks/:id", verifyFBToken, async (req, res) => {
      const taskId = req.params.id;
      const updateData = req.body;
      delete updateData._id;
      const result = await taskCollection.updateOne(
        { _id: new ObjectId(taskId) },
        { $set: updateData }
      );
      if (result.modifiedCount === 0) {
        return res
          .status(404)
          .send({ message: "Task not found or no changes made" });
      }
      res.send({ message: "Task updated successfully", data: result });
    });

    // Get pending submissions for buyer's tasks (unchanged)

    app.get("/pending-submissions", verifyFBToken, async (req, res) => {
      try {
        const buyerEmail = req.query.buyerEmail;
        const submissions = await taskSubmissionsCollection
          .find({
            Buyer_email: buyerEmail,
            status: "pending",
          })
          .toArray();
        res.send(submissions);
      } catch (error) {
        console.error("Error fetching pending submissions:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    // admin
    app.get(
      "/pending-submissions/admin",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const buyerEmail = req.query.buyerEmail;
          const submissions = await taskSubmissionsCollection
            .find({
              Buyer_email: buyerEmail,
              status: "pending",
            })
            .toArray();
          res.send(submissions);
        } catch (error) {
          console.error("Error fetching pending submissions:", error);
          res.status(500).send({ error: "Internal server error" });
        }
      }
    );

    // Approve submission (simplified)
    app.patch(
      "/approve-submission/:id",
      verifyFBToken,
      verifyBuyer,
      async (req, res) => {
        try {
          const submissionId = req.params.id;
          const { workerEmail, payableAmount, taskId } = req.body;

          const submission = await taskSubmissionsCollection.findOne({
            _id: new ObjectId(submissionId),
          });

          // Update submission status
          await taskSubmissionsCollection.updateOne(
            { _id: new ObjectId(submissionId) },
            { $set: { status: "approved" } }
          );

          // Increase worker's coins
          await usersCollection.updateOne(
            { email: workerEmail },
            { $inc: { coins: parseInt(payableAmount) } }
          );

          await nottificationsCollection.insertOne({
            message: `You have earned ${payableAmount} coins from ${submission.Buyer_name} for completing ${submission.task_title}`,
            toEmail: workerEmail,
            actionRoute: "/dashboard/worker-home",
            time: new Date().toISOString(),
            isRead: false,
          });
          res.send({ success: true });
        } catch (error) {
          console.error("Error approving submission:", error);
          res.status(500).send({ error: "Internal server error" });
        }
      }
    );

    // Reject submission (simplified)
    app.patch(
      "/reject-submission/:id",
      verifyFBToken,
      verifyBuyer,
      async (req, res) => {
        try {
          const submissionId = req.params.id;
          const { taskId } = req.body;

          const submission = await taskSubmissionsCollection.findOne({
            _id: new ObjectId(submissionId),
          });

          // Update submission status
          await taskSubmissionsCollection.updateOne(
            { _id: new ObjectId(submissionId) },
            { $set: { status: "rejected" } }
          );

          // Increase required_workers in task
          await taskCollection.updateOne(
            { _id: new ObjectId(taskId) },
            { $inc: { required_workers: 1 } }
          );

          await nottificationsCollection.insertOne({
            message: `Your submission for ${submission.task_title} has been rejected by ${submission.Buyer_name}`,
            toEmail: submission.worker_email,
            actionRoute: "/dashboard/worker-home",
            time: new Date().toISOString(),
            isRead: false,
          });

          res.send({ success: true });
        } catch (error) {
          console.error("Error rejecting submission:", error);
          res.status(500).send({ error: "Internal server error" });
        }
      }
    );

    // withdrawal related APIs
    // Get pending withdrawal requests
    app.get(
      "/withdrawal-requests",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const requests = await withDrawalCollection
            .find({
              status: "pending",
            })
            .sort({ withdraw_date: -1 })
            .toArray();
          res.send(requests);
        } catch (error) {
          console.error("Error fetching withdrawal requests:", error);
          res.status(500).send({ error: "Internal server error" });
        }
      }
    );

    // Approve withdrawal request
    app.patch(
      "/approve-withdrawal/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const { workerEmail, withdrawalCoin } = req.body;

          const withdrawal = await withDrawalCollection.findOne({
            _id: new ObjectId(id),
          });

          // Update withdrawal status
          await withDrawalCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "approved" } }
          );

          // Deduct coins from user
          await usersCollection.updateOne(
            { email: workerEmail },
            {
              $inc: {
                coins: -parseInt(withdrawalCoin),
                earnings: parseFloat(withdrawalCoin / 20),
              },
            }
          );

          await nottificationsCollection.insertOne({
            message: `Your withdrawal request for ${withdrawalCoin} coins has been approved`,
            toEmail: workerEmail,
            actionRoute: "/dashboard/worker-home",
            time: new Date().toISOString(),
            isRead: false,
          });

          res.send({ success: true });
        } catch (error) {
          console.error("Error approving withdrawal:", error);
          res.status(500).send({ error: "Internal server error" });
        }
      }
    );

    // Create withdrawal request
    app.post("/withdrawals", verifyFBToken, verifyWorker, async (req, res) => {
      try {
        const withdrawalData = req.body;

        if (withdrawalData.withdrawal_coin < 200) {
          return res
            .status(400)
            .send({ error: "Minimum withdrawal is 200 coins (10$)" });
        }

        const result = await withDrawalCollection.insertOne({
          ...withdrawalData,
          withdraw_date: new Date().toISOString(),
          status: "pending",
        });

        await nottificationsCollection.insertOne({
          message: `Your withdrawal request for ${withdrawalData.withdrawal_coin} coins has been approved`,
          toEmail: "admin@gmail.com",
          actionRoute: "/dashboard/worker-home",
          time: new Date().toISOString(),
          isRead: false,
        });

        res.send(result);
      } catch (error) {
        console.error("Error creating withdrawal:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    //best worker related APIs
    app.get("/best-worker", async (req, res) => {
      try {
        const bestWorker = await usersCollection
          .find({ role: "worker" })
          .sort({ earnings: -1 })
          .toArray();

        res.send(bestWorker);
      } catch (error) {
        console.error("Error fetching best worker:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });

    // stripe payment intent
    app.post(
      "/create-payment-intent",
      verifyFBToken,
      verifyBuyer,
      async (req, res) => {
        const amountInCents = req.body.amountInCents;
        try {
          const { amount } = req.body;
          const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: "usd",
          });
          res.json({ clientSecret: paymentIntent.client_secret });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      }
    );

    // task count for buyer
    app.get(
      "/tasks/states/buyer/:email",
      verifyFBToken,
      verifyBuyer,
      async (req, res) => {
        const email = req.params.email;
        const count = await taskCollection.countDocuments({
          created_by: email,
        });
        const pendingCount = await taskSubmissionsCollection.countDocuments({
          Buyer_email: email,
          status: "pending",
        });

        // count approved and total payable coins
        const approvedCount = await taskSubmissionsCollection
          .aggregate([
            { $match: { Buyer_email: email, status: "approved" } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                totalPayable: { $sum: "$payable_amount" },
              },
            },
          ])
          .toArray();

        const rejectedCount = await taskSubmissionsCollection.countDocuments({
          Buyer_email: email,
          status: "rejected",
        });

        const totalrequiredWorkers = await taskCollection
          .aggregate([
            { $match: { created_by: email } },
            { $group: { _id: null, total: { $sum: "$required_workers" } } },
          ])
          .toArray();

        const totalRequiredWorkers =
          totalrequiredWorkers.length > 0 ? totalrequiredWorkers[0].total : 0;
        // total payments for buyer to pay all tasks
        const totalPayments = await taskCollection
          .aggregate([
            { $match: { created_by: email } },
            { $group: { _id: null, total: { $sum: "$total_payable" } } },
          ])
          .toArray();
        const totalAmount =
          totalPayments.length > 0 ? totalPayments[0].total : 0;

        //
        res.json({
          count,
          pendingCount,
          approvedCount: approvedCount.length > 0 ? approvedCount[0].count : 0,
          totalPayable:
            approvedCount.length > 0 ? approvedCount[0].totalPayable : 0,
          rejectedCount,
          totalRequiredWorkers,
          totalAmount,
        });
      }
    );

    app.get("/pendingTasksCount", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const count = await taskSubmissionsCollection.countDocuments({
        Buyer_email: email,
        status: "pending",
      });
      res.json({ count });
    });
    app.get(
      "/pendingTasksCount/admin",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.query.email;
        const count = await taskSubmissionsCollection.countDocuments({
          Buyer_email: email,
          status: "pending",
        });
        res.json({ count });
      }
    );

    // all state counts for worker dashboard
    app.get(
      "/tasks/states/worker/:email",
      verifyFBToken,
      verifyWorker,
      async (req, res) => {
        const email = req.params.email;
        const totalTasks = await taskSubmissionsCollection.countDocuments({
          worker_email: email,
        });
        const pendingTasks = await taskSubmissionsCollection.countDocuments({
          worker_email: email,
          status: "pending",
        });
        const approvedTasks = await taskSubmissionsCollection.countDocuments({
          worker_email: email,
          status: "approved",
        });
        const rejectedTasks = await taskSubmissionsCollection.countDocuments({
          worker_email: email,
          status: "rejected",
        });

        //sum of payable_amount of the worker where status is approved
        const totalPayable = await taskSubmissionsCollection
          .aggregate([
            { $match: { worker_email: email, status: "approved" } },
            {
              $group: {
                _id: null,
                totalPayable: { $sum: "$payable_amount" },
              },
            },
          ])
          .toArray();
        const totalPayableAmount =
          totalPayable.length > 0 ? totalPayable[0].totalPayable : 0;
        res.json({
          totalTasks,
          pendingTasks,
          approvedTasks,
          rejectedTasks,
          totalPayableAmount,
        });
      }
    );

    // admin will see the count of total worker, total buyer, total available coin(sum of all users coin ),  total payments
    app.get("/admin/stats", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const totalWorkers = await usersCollection.countDocuments({
          role: "worker",
        });
        const totalBuyers = await usersCollection.countDocuments({
          role: "buyer",
        });
        const totalAvailableCoins = await usersCollection
          .aggregate([
            { $group: { _id: null, totalCoins: { $sum: "$coins" } } },
          ])
          .toArray();
        const totalPayments = await paymentsCollection.countDocuments();

        res.json({
          totalWorkers,
          totalBuyers,
          totalAvailableCoins:
            totalAvailableCoins.length > 0
              ? totalAvailableCoins[0].totalCoins
              : 0,
          totalPayments,
        });
      } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).send({ error: "Internal server error" });
      }
    });
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("EarnSphereX Server is running");
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
