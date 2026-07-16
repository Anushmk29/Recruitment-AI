const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    company: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    subscriptionPlan: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionPlan", required: true },
    billingCycle: { type: String, enum: ["monthly", "yearly"], required: true },

    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },

    razorpayOrderId: { type: String, required: true, unique: true, index: true },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },

    status: { type: String, enum: ["created", "paid", "failed", "cancelled"], default: "created" },
    failureReason: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", paymentSchema);
