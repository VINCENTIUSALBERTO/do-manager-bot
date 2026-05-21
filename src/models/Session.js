import mongoose from 'mongoose';

const SessionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const Session = mongoose.model('Session', SessionSchema);
