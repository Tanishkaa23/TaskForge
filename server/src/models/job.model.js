import mongoose from "mongoose";

const jobSchema = new mongoose.Schema(
  {
    queueJobId: {
      type: String,
      unique: true,
      sparse:true
    },
    idempotencyKey: {
    type: String,
    sparse: true,
    unique: true,
    },
    type: {
      type: String,
      required: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      enum: ["queued", "processing", "completed", "failed"],
      default: "queued",
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    error: {
      type: String,
      default: null,
    }
  },
  { timestamps: true }
);

const jobModel = mongoose.model("Job", jobSchema);
export default jobModel